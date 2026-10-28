import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { drive as createDrive, auth } from '@googleapis/drive';
import { db, getSetting, DATA_DIR } from './db.js';

const CACHE_DIR = path.join(DATA_DIR, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const FOLDER_MIME = 'application/vnd.google-apps.folder';

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

export async function listFolder(folderId) {
  const d = client();
  const items = [];
  let pageToken;
  do {
    const { data } = await d.files.list({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and (mimeType = '${FOLDER_MIME}' or mimeType contains 'video/')`,
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
  await pipeline(res.data, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  return { path: dest, size: fs.statSync(dest).size };
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
