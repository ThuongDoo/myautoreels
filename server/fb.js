import fs from 'node:fs';
import https from 'node:https';
import { getSetting } from './db.js';

export class FbError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

const graphBase = () => `https://graph.facebook.com/${getSetting('graph_version')}`;

function errorMessage(e, fallback) {
  if (!e) return fallback;
  return `${e.error_user_msg || e.message} (code ${e.code}${e.error_subcode ? '/' + e.error_subcode : ''})`;
}

const REQUEST_TIMEOUT_MS = 60_000;

async function request(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new FbError(`Facebook không phản hồi sau ${REQUEST_TIMEOUT_MS / 1000}s`);
    throw new FbError(`Không kết nối được Facebook: ${e.cause?.message || e.message}`);
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok || json.error) {
    throw new FbError(errorMessage(json.error, `HTTP ${res.status}: ${text.slice(0, 200)}`), json.error);
  }
  return json;
}

function graph(method, path, params, token) {
  const url = new URL(graphBase() + path);
  const entries = Object.entries({ ...params, access_token: token })
    .filter(([, v]) => v != null)
    .map(([k, v]) => [k, String(v)]);
  if (method === 'GET') {
    for (const [k, v] of entries) url.searchParams.set(k, v);
    return request(url);
  }
  return request(url, { method, body: new URLSearchParams(entries) });
}

async function collect(first, maxPages = 20) {
  let json = first;
  const out = [...(json.data || [])];
  for (let i = 1; json.paging?.next && i < maxPages; i++) {
    json = await request(json.paging.next);
    out.push(...(json.data || []));
  }
  return out;
}

export async function listManagedPages(token) {
  const first = await graph('GET', '/me/accounts', { fields: 'id,name,access_token,picture{url}', limit: 100 }, token);
  return collect(first);
}

export function getMe(token) {
  return graph('GET', '/me', { fields: 'id,name' }, token);
}

export async function listBusinessPages(businessId, token) {
  const out = [];
  for (const edge of ['owned_pages', 'client_pages']) {
    try {
      const first = await graph('GET', `/${businessId}/${edge}`, { fields: 'id,name', limit: 100 }, token);
      out.push(...(await collect(first)).map((p) => ({ ...p, source: edge })));
    } catch (e) {
      if (edge === 'owned_pages') throw e;
    }
  }
  return out;
}

export function assignPageToUser(pageId, userId, token) {
  return graph('POST', `/${pageId}/assigned_users`, {
    user: userId,
    tasks: JSON.stringify(['MANAGE', 'CREATE_CONTENT', 'MODERATE', 'ADVERTISE', 'ANALYZE']),
  }, token);
}

// --- Page profile picture ---

const IMAGE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

// Uploads the image straight to /{page}/picture. Some Pages reject that, so on a non-permission,
// non-rate-limit error we fall back to an unpublished photo and set that as the picture.
export async function setPagePicture(pageId, token, filePath) {
  const bytes = fs.readFileSync(filePath);
  const name = filePath.split(/[\\/]/).pop();
  const type = IMAGE_MIME[name.slice(name.lastIndexOf('.')).toLowerCase()] || 'image/jpeg';
  const form = (extra = {}) => {
    const f = new FormData();
    f.append('access_token', token);
    for (const [k, v] of Object.entries(extra)) f.append(k, v);
    f.append('source', new Blob([bytes], { type }), name);
    return f;
  };
  try {
    return await request(new URL(`${graphBase()}/${pageId}/picture`), { method: 'POST', body: form() });
  } catch (e) {
    if ([4, 10, 17, 32, 190, 200, 283, 368, 613].includes(e.details?.code)) throw e;
    const photo = await request(new URL(`${graphBase()}/${pageId}/photos`), { method: 'POST', body: form({ published: 'false' }) });
    return graph('POST', `/${pageId}/picture`, { photo: photo.id }, token);
  }
}

// --- Reels publishing: start -> upload binary -> finish (PUBLISHED) ---

export function startReelUpload(pageId, token) {
  return graph('POST', `/${pageId}/video_reels`, { upload_phase: 'start' }, token);
}

export function uploadReelBinary(uploadUrl, token, filePath, size) {
  return new Promise((resolve, reject) => {
    const req = https.request(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${token}`,
        offset: '0',
        file_size: String(size),
        'Content-Type': 'application/octet-stream',
        'Content-Length': size,
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = {}; }
        if (res.statusCode >= 300 || json.error || json.success === false) {
          const msg = json.error?.message || json.debug_info?.message || `Upload HTTP ${res.statusCode}: ${data.slice(0, 200)}`;
          reject(new FbError(msg, json));
        } else {
          resolve(json);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15 * 60 * 1000, () => req.destroy(new Error('Upload timeout')));
    fs.createReadStream(filePath).on('error', reject).pipe(req);
  });
}

export function finishReel(pageId, token, videoId, description) {
  return graph('POST', `/${pageId}/video_reels`, {
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
    description: description || '',
  }, token);
}

export function getVideoStatus(videoId, token) {
  return graph('GET', `/${videoId}`, { fields: 'status,permalink_url' }, token);
}

// --- Stats ---

// Fetched as nested fields of the reel list, so one call per page returns every reel's
// numbers (instead of 2 calls per reel) — keeps us well under the app's hourly call limit.
const METRICS = ['blue_reels_play_count', 'fb_reels_total_plays', 'post_video_avg_time_watched', 'post_video_social_actions'];
const BASE_FIELDS = 'id,description,created_time,permalink_url,likes.summary(true).limit(0),comments.summary(true).limit(0)';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

function reelStats(r) {
  const insights = r.video_insights?.data || [];
  const metric = (name) => insights.find((d) => d.name === name)?.values?.[0]?.value;
  const social = metric('post_video_social_actions') || {};
  const socialGet = (key) => num(Object.entries(social).find(([k]) => k.toLowerCase() === key)?.[1]);
  return {
    views: num(metric('blue_reels_play_count') ?? metric('fb_reels_total_plays')),
    reach: 0,
    avg_watch_ms: num(metric('post_video_avg_time_watched')),
    likes: num(r.likes?.summary?.total_count),
    comments: num(r.comments?.summary?.total_count) || socialGet('comment'),
    shares: socialGet('share'),
  };
}

// Reels published since sinceSec, each with a `stats` object.
export async function listPageReels(pageId, token, sinceSec) {
  const list = (fields) => graph('GET', `/${pageId}/video_reels`, { fields, since: sinceSec, limit: 50 }, token)
    .then((first) => collect(first, 5));
  try {
    const reels = await list(`${BASE_FIELDS},video_insights.metric(${METRICS.join(',')})`);
    return reels.map((r) => ({ ...r, stats: reelStats(r) }));
  } catch (e) {
    // A metric renamed in a newer Graph version fails the whole call; still list the reels,
    // but with stats = null so existing numbers aren't overwritten with zeros.
    if (e.details?.code !== 100) throw e;
    console.error(`[stats] page ${pageId}: không đọc được insights (${e.message})`);
    return (await list(BASE_FIELDS)).map((r) => ({ ...r, stats: null }));
  }
}

export function normalizePermalink(link, videoId) {
  if (!link) return `https://www.facebook.com/reel/${videoId}`;
  return link.startsWith('/') ? `https://www.facebook.com${link}` : link;
}
