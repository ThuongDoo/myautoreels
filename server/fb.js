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

export async function listPageReels(pageId, token, sinceSec) {
  const first = await graph('GET', `/${pageId}/video_reels`, {
    fields: 'id,description,created_time,permalink_url',
    since: sinceSec,
    limit: 50,
  }, token);
  return collect(first, 5);
}

const METRICS = [
  'blue_reels_play_count',
  'fb_reels_total_plays',
  'post_impressions_unique',
  'post_video_avg_time_watched',
  'post_video_social_actions',
];
// Metric names change between Graph versions; if the combined call fails we
// probe each one once and remember which ones this API version accepts.
let workingMetrics = null;

async function fetchInsights(videoId, token) {
  if (workingMetrics) {
    if (!workingMetrics.length) return [];
    return (await graph('GET', `/${videoId}/video_insights`, { metric: workingMetrics.join(',') }, token)).data || [];
  }
  try {
    const data = (await graph('GET', `/${videoId}/video_insights`, { metric: METRICS.join(',') }, token)).data || [];
    workingMetrics = METRICS;
    return data;
  } catch {
    const ok = [];
    const out = [];
    for (const metric of METRICS) {
      try {
        out.push(...((await graph('GET', `/${videoId}/video_insights`, { metric }, token)).data || []));
        ok.push(metric);
      } catch { /* unsupported metric */ }
    }
    workingMetrics = ok;
    return out;
  }
}

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

export async function getReelStats(videoId, token) {
  const insights = await fetchInsights(videoId, token);
  const metric = (name) => insights.find((d) => d.name === name)?.values?.[0]?.value;

  const social = metric('post_video_social_actions') || {};
  const socialGet = (key) => num(Object.entries(social).find(([k]) => k.toLowerCase() === key)?.[1]);

  let likes = 0;
  let comments = socialGet('comment');
  try {
    const v = await graph('GET', `/${videoId}`, {
      fields: 'likes.summary(true).limit(0),comments.summary(true).limit(0)',
    }, token);
    likes = num(v.likes?.summary?.total_count);
    comments = num(v.comments?.summary?.total_count) || comments;
  } catch { /* fields not available for this video */ }

  return {
    views: num(metric('blue_reels_play_count') ?? metric('fb_reels_total_plays')),
    reach: num(metric('post_impressions_unique')),
    avg_watch_ms: num(metric('post_video_avg_time_watched')),
    likes,
    comments,
    shares: socialGet('share'),
  };
}

export function normalizePermalink(link, videoId) {
  if (!link) return `https://www.facebook.com/reel/${videoId}`;
  return link.startsWith('/') ? `https://www.facebook.com${link}` : link;
}
