import { db, getSetting, setSetting, transaction } from './db.js';
import * as fb from './fb.js';

const PAGE_CONCURRENCY = 3;
let running = false;

export const isStatsRunning = () => running;

async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// A reel is viral when its views are N times the page's usual (median) views.
function computeViral(page) {
  const multiplier = Number(getSetting('viral_multiplier'));
  const minViews = Number(getSetting('viral_min_views'));
  const rows = db.prepare('SELECT video_id, views, published_at FROM reels WHERE page_id = ? ORDER BY published_at DESC LIMIT 60')
    .all(page.id);
  const dayAgo = Date.now() - 86_400_000;
  const update = db.prepare('UPDATE reels SET viral_score = ?, viral = ? WHERE video_id = ?');

  for (const r of rows) {
    const others = rows.filter((o) => o !== r);
    // Prefer reels older than 24h as the baseline so fresh reels don't drag the median down.
    const mature = others.filter((o) => o.published_at <= dayAgo);
    const base = median((mature.length >= 5 ? mature : others).map((o) => o.views));
    const score = base > 0 ? r.views / base : null;
    const viral = r.views >= minViews && (score == null ? r.views >= minViews * multiplier : score >= multiplier) ? 1 : 0;
    update.run(score, viral, r.video_id);
  }
}

async function refreshPage(page, since) {
  const list = await fb.listPageReels(page.id, page.access_token, Math.floor(since / 1000));
  // job_id is looked up by video_id so a reel the app posted stays linked to its source video
  // even if the worker didn't record it (e.g. it restarted mid-publish).
  const upsert = db.prepare(`
    INSERT INTO reels (video_id, page_id, caption, permalink, published_at, job_id)
    VALUES (?1, ?2, ?3, ?4, ?5, (SELECT id FROM jobs WHERE video_id = ?1 ORDER BY id DESC LIMIT 1))
    ON CONFLICT(video_id) DO UPDATE SET permalink = excluded.permalink, caption = COALESCE(reels.caption, excluded.caption),
      job_id = COALESCE(reels.job_id, excluded.job_id)
  `);
  const update = db.prepare(`
    UPDATE reels SET views = ?, reach = ?, likes = ?, comments = ?, shares = ?, avg_watch_ms = ?, stats_at = ? WHERE video_id = ?
  `);
  const history = db.prepare('INSERT INTO reel_stats (video_id, ts, views, likes, comments, shares) VALUES (?, ?, ?, ?, ?, ?)');
  const now = Date.now();
  transaction(() => {
    for (const r of list) {
      upsert.run(r.id, page.id, r.description ?? null, fb.normalizePermalink(r.permalink_url, r.id), Date.parse(r.created_time) || now);
      const s = r.stats;
      if (!s) continue;
      update.run(s.views, s.reach, s.likes, s.comments, s.shares, s.avg_watch_ms, now, r.id);
      history.run(r.id, now, s.views, s.likes, s.comments, s.shares);
    }
  });
  computeViral(page);
}

export async function refreshStats() {
  if (running) return false;
  running = true;
  try {
    const since = Date.now() - Number(getSetting('stats_days')) * 86_400_000;
    const pages = db.prepare('SELECT * FROM pages WHERE enabled = 1').all();
    console.log(`[stats] Bắt đầu cập nhật ${pages.length} page`);
    await pool(pages, PAGE_CONCURRENCY, async (page) => {
      try {
        await refreshPage(page, since);
      } catch (e) {
        console.error(`[stats] page ${page.name}: ${e.message}`);
      }
    });
    setSetting('stats_last_run', Date.now());
    console.log('[stats] Xong');
  } finally {
    running = false;
  }
  return true;
}

export function startStatsScheduler() {
  setInterval(() => {
    const last = Number(getSetting('stats_last_run') || 0);
    const interval = Number(getSetting('stats_interval_minutes')) * 60_000;
    if (!running && Date.now() - last >= interval) {
      refreshStats().catch((e) => console.error('[stats]', e));
    }
  }, 60_000);
}
