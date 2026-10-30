import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { drive as createDrive, auth } from '@googleapis/drive';
import { db, getSetting, DATA_DIR } from './db.js';

const CACHE_DIR = path.join(DATA_DIR, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// The Drive client returns a web ReadableStream for responseType 'stream'.
const toNodeStream = (s) => (typeof s?.getReader === 'function' ? Readable.fromWeb(s) : s);
const header = (res, name) => (typeof res.headers?.get === 'function' ? res.headers.get(name) : res.headers?.[name]);

let cached = { key: null, client: null };

function client() {
  const raw = getSetting('google_sa_json');
  if (!raw) throw new Error('Chưa cấu hình Service Account Google Drive trong Cài đặt');
  if (cached.key !== raw) {
    const credentials = JSON.parse(raw);
    const googleAuth = new auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
    cached = { key: raw, client: createDrive({ version: 'v3', auth: googleAuth }) };
  }
  return cached.client;
}

export function serviceAccountEmail() {
  try {
    return JSON.parse(getSetting('google_sa_json')).client_email || null;
  } catch {
    return null;
  }
}

// Accepts a raw folder ID or a full Drive folder link.
export function parseFolderId(input) {
  if (!input) return null;
  const m = String(input).match(/folders\/([\w-]+)/) || String(input).match(/[?&]id=([\w-]+)/);
  return m ? m[1] : String(input).trim();
}

// `kinds` are the MIME prefixes of the files to return, e.g. ['video'] or ['audio', 'video'].
export async function listFolder(folderId, kinds = ['video']) {
  const d = client();
  const items = [];
  const mime = kinds.map((k) => `mimeType contains '${k}/'`).join(' or ');
  let pageToken;
  do {
    const { data } = await d.files.list({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and (mimeType = '${FOLDER_MIME}' or ${mime})`,
      fields: 'nextPageToken, files(id,name,mimeType,size,createdTime,videoMediaMetadata(durationMillis,width,height))',
      orderBy: 'folder,name',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    items.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return {
    folders: items.filter((f) => f.mimeType === FOLDER_MIME).map((f) => ({ id: f.id, name: f.name })),
    videos: items.filter((f) => f.mimeType !== FOLDER_MIME).map((f) => ({
      id: f.id,
      name: f.name,
      size: Number(f.size || 0),
      createdTime: f.createdTime,
      durationMs: Number(f.videoMediaMetadata?.durationMillis || 0),
      width: f.videoMediaMetadata?.width,
      height: f.videoMediaMetadata?.height,
    })),
  };
}

const MAX_DEPTH = 6;

// All videos inside a folder and its subfolders; each video carries its folder path.
export async function listVideosRecursive(folderId, folderName = '', depth = 0) {
  const { folders, videos } = await listFolder(folderId);
  const out = videos.map((v) => ({ ...v, folder: folderName }));
  if (depth < MAX_DEPTH) {
    for (const f of folders) {
      out.push(...await listVideosRecursive(f.id, folderName ? `${folderName}/${f.name}` : f.name, depth + 1));
    }
  }
  return out;
}

// All music files inside the music folder and its subfolders. Some music is kept as .mp4,
// so video files count too; the browser's <audio> player plays their sound track.
export async function listAudioRecursive(folderId, folderName = '', depth = 0) {
  const { folders, videos } = await listFolder(folderId, ['audio', 'video']);
  const out = videos.map(({ id, name, size }) => ({ id, name, size, folder: folderName }));
  if (depth < MAX_DEPTH) {
    for (const f of folders) {
      out.push(...await listAudioRecursive(f.id, folderName ? `${folderName}/${f.name}` : f.name, depth + 1));
    }
  }
  return out;
}

// One download per Drive file even when many jobs (pages) need it at once.
const inflight = new Map();

export function ensureLocal(fileId) {
  if (!inflight.has(fileId)) {
    inflight.set(fileId, download(fileId).finally(() => inflight.delete(fileId)));
  }
  return inflight.get(fileId);
}

async function download(fileId) {
  const d = client();
  const { data: meta } = await d.files.get({ fileId, fields: 'size', supportsAllDrives: true });
  const size = Number(meta.size);
  const dest = path.join(CACHE_DIR, fileId);
  if (fs.existsSync(dest) && fs.statSync(dest).size === size) return { path: dest, size };

  const tmp = `${dest}.part`;
  const res = await d.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
  await pipeline(toNodeStream(res.data), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  return { path: dest, size: fs.statSync(dest).size };
}

// Streams a Drive video to the browser, passing Range through so the player can seek.
export async function streamFile(fileId, range) {
  const d = client();
  const { data: meta } = await d.files.get({ fileId, fields: 'mimeType', supportsAllDrives: true });
  const res = await d.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream', headers: range ? { Range: range } : {} },
  );
  return {
    status: res.status,
    headers: {
      'content-type': header(res, 'content-type') || meta.mimeType || 'video/mp4',
      'content-length': header(res, 'content-length'),
      'content-range': header(res, 'content-range'),
    },
    body: toNodeStream(res.data),
  };
}

// Delete the cached file once no job needs it within the next hour.
export function releaseLocal(fileId) {
  const soon = Date.now() + 60 * 60 * 1000;
  const { n } = db.prepare(`
    SELECT COUNT(*) AS n FROM jobs
    WHERE drive_file_id = ? AND (status = 'uploading' OR (status = 'pending' AND scheduled_at <= ?))
  `).get(fileId, soon);
  if (n > 0 || inflight.has(fileId)) return;
  try {
    fs.rmSync(path.join(CACHE_DIR, fileId), { force: true });
  } catch { /* still open by another upload on Windows; cleaned up next time */ }
}
