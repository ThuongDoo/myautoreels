import { db, getAllSettings, getSetting, setSetting, SETTING_KEYS, transaction } from './db.js';
import * as fb from './fb.js';
import { listFolder, listVideosRecursive, parseFolderId, serviceAccountEmail } from './drive.js';
import { refreshStats, isStatsRunning } from './stats.js';
import { notify } from './telegram.js';
import { renderCaption } from './caption.js';

function bad(message, statusCode = 400) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

const EDITABLE = ['pending', 'uploaded', 'failed', 'canceled'];
const NO_GROUP = '__none__';

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function registerRoutes(app) {
  // --- Settings ---
  app.get('/api/settings', async () => ({ ...getAllSettings(), service_account_email: serviceAccountEmail() }));

  app.put('/api/settings', async (req) => {
    const body = req.body || {};
    if (body.google_sa_json) {
      try {
        if (!JSON.parse(body.google_sa_json).client_email) throw new Error();
      } catch {
        throw bad('Service Account JSON không hợp lệ');
      }
    }
    if (body.drive_folder_id) body.drive_folder_id = parseFolderId(body.drive_folder_id);
    for (const [k, v] of Object.entries(body)) if (SETTING_KEYS.includes(k)) setSetting(k, v);
    return { ok: true };
  });

  app.post('/api/telegram/test', async () => {
    await notify('✅ AutoReels đã kết nối Telegram', { throwOnError: true });
    return { ok: true };
  });

  // --- Pages ---
  app.get('/api/pages', async () =>
    db.prepare('SELECT id, name, picture, enabled, group_name, synced_at FROM pages ORDER BY name').all());

  const fbToken = () => {
    const token = getSetting('fb_token');
    if (!token) throw bad('Chưa nhập System User Token trong Cài đặt');
    return token;
  };

  async function syncPages() {
    const pages = await fb.listManagedPages(fbToken());
    const stmt = db.prepare(`
      INSERT INTO pages (id, name, access_token, picture, synced_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, access_token = excluded.access_token,
        picture = excluded.picture, synced_at = excluded.synced_at
    `);
    const now = Date.now();
    transaction(() => {
      for (const p of pages) stmt.run(p.id, p.name, p.access_token, p.picture?.data?.url ?? null, now);
    });
    return pages;
  }

  app.post('/api/pages/sync', async () => ({ synced: (await syncPages()).length }));

  // Assigns every page of the BM to the system user via API (the BM UI fails on bulk assigns).
  // Runs in the background; the UI polls /status to show progress.
  let assignTask = null;

  const ASSIGN_DELAY_MS = 4_000;
  // Wait times (minutes) after Facebook's anti-spam block (code 368); gives up after the last one.
  const RATE_LIMIT_BACKOFF_MIN = [5, 10, 20, 30, 30, 60];
  const isRateLimited = (e) => e.details?.code === 368 || e.details?.error_subcode === 1390008;

  class Canceled extends Error {}

  async function runAssignAll(task, token, businessId) {
    const log = (text, type = 'info') => {
      task.log.push({ ts: Date.now(), text, type });
      task.updatedAt = Date.now();
    };
    const sleep = async (ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (task.cancel) throw new Canceled();
        await new Promise((r) => setTimeout(r, Math.min(1000, until - Date.now())));
      }
    };
    try {
      task.phase = 'Lấy thông tin System User';
      const me = await fb.getMe(token);
      log(`System User: ${me.name} (${me.id})`);

      task.phase = 'Lấy danh sách page của BM';
      const all = await fb.listBusinessPages(businessId, token);
      log(`BM có ${all.length} page`);

      task.phase = 'Kiểm tra page đã gán';
      const assigned = new Set((await fb.listManagedPages(token)).map((p) => p.id));
      const todo = all.filter((p) => !assigned.has(p.id));
      Object.assign(task, { total: all.length, alreadyAssigned: assigned.size, todo: todo.length });
      log(`Đã gán sẵn ${assigned.size}, cần gán thêm ${todo.length}`);

      let blocks = 0;
      for (const page of todo) {
        task.current = page.name;
        for (;;) {
          if (task.cancel) throw new Canceled();
          task.phase = 'Đang gán page';
          try {
            await fb.assignPageToUser(page.id, me.id, token);
            task.newlyAssigned++;
            blocks = 0;
            log(`✓ ${page.name}`, 'success');
          } catch (e) {
            if (isRateLimited(e)) {
              if (blocks >= RATE_LIMIT_BACKOFF_MIN.length) {
                throw new Error('Facebook chặn quá nhiều lần liên tiếp. Hãy đợi vài giờ (tốt nhất là ngày mai) rồi bấm gán lại — page đã gán sẽ được bỏ qua.');
              }
              const minutes = RATE_LIMIT_BACKOFF_MIN[blocks++];
              task.waitUntil = Date.now() + minutes * 60_000;
              task.phase = 'Facebook tạm chặn, đang chờ';
              log(`⏸ Facebook tạm chặn vì thao tác nhanh (368). Chờ ${minutes} phút rồi thử lại "${page.name}"`, 'warning');
              await sleep(minutes * 60_000);
              task.waitUntil = null;
              continue;
            }
            task.failed.push({ id: page.id, name: page.name, source: page.source, error: e.message });
            log(`✗ ${page.name}: ${e.message}`, 'error');
          }
          break;
        }
        task.done++;
        await sleep(ASSIGN_DELAY_MS);
      }
      task.current = null;

      task.phase = 'Đồng bộ lại danh sách page';
      task.synced = (await syncPages()).length;
      log(`Hoàn tất: app hiện có ${task.synced} page`, 'success');
      task.phase = 'Hoàn tất';
    } catch (e) {
      if (e instanceof Canceled) {
        task.phase = 'Đã dừng';
        log('Đã dừng theo yêu cầu. Bấm gán lại để tiếp tục — page đã gán sẽ được bỏ qua.', 'warning');
      } else {
        task.error = e.message;
        task.phase = 'Lỗi';
        log(`Dừng vì lỗi: ${e.message}`, 'error');
      }
    } finally {
      task.running = false;
      task.waitUntil = null;
      task.current = null;
      task.finishedAt = Date.now();
    }
  }

  app.post('/api/pages/assign-all/cancel', async () => {
    if (assignTask?.running) assignTask.cancel = true;
    return { ok: true };
  });

  app.post('/api/pages/assign-all', async () => {
    if (assignTask?.running) return assignTask;
    const token = fbToken();
    const businessId = getSetting('business_id');
    if (!businessId) throw bad('Chưa nhập Business ID trong Cài đặt');

    assignTask = {
      running: true, phase: 'Bắt đầu', startedAt: Date.now(), updatedAt: Date.now(), finishedAt: null,
      total: 0, alreadyAssigned: 0, todo: 0, done: 0, newlyAssigned: 0, synced: null,
      current: null, failed: [], log: [], error: null, waitUntil: null, cancel: false,
    };
    runAssignAll(assignTask, token, businessId);
    return assignTask;
  });

  app.get('/api/pages/assign-all/status', async () => assignTask || { running: false, idle: true });

  // --- Page groups ---
  app.get('/api/groups', async () => db.prepare(`
    SELECT g.name, COUNT(p.id) AS total, COALESCE(SUM(p.enabled), 0) AS enabled
    FROM page_groups g LEFT JOIN pages p ON p.group_name = g.name
    GROUP BY g.name ORDER BY g.name
  `).all());

  app.post('/api/groups', async (req) => {
    const name = req.body?.name?.trim();
    if (!name) throw bad('Nhập tên nhóm');
    if (db.prepare('SELECT 1 FROM page_groups WHERE name = ?').get(name)) throw bad(`Nhóm "${name}" đã có`);
    db.prepare('INSERT INTO page_groups (name, created_at) VALUES (?, ?)').run(name, Date.now());
    return { name };
  });

  // Rename a group (merging if the new name exists), or delete it when `to` is empty — pages become ungrouped.
  app.post('/api/groups/rename', async (req) => {
    const from = req.body?.from;
    const to = req.body?.to?.trim() || null;
    if (!from) throw bad('Thiếu tên nhóm');
    let changed = 0;
    transaction(() => {
      db.prepare('DELETE FROM page_groups WHERE name = ?').run(from);
      if (to) db.prepare('INSERT OR IGNORE INTO page_groups (name, created_at) VALUES (?, ?)').run(to, Date.now());
      changed = Number(db.prepare('UPDATE pages SET group_name = ? WHERE group_name = ?').run(to, from).changes);
    });
    return { changed };
  });

  app.post('/api/pages/update', async (req) => {
    const { ids = [], enabled, group_name } = req.body || {};
    transaction(() => {
      if (group_name) db.prepare('INSERT OR IGNORE INTO page_groups (name, created_at) VALUES (?, ?)').run(group_name, Date.now());
      for (const id of ids) {
        if (enabled !== undefined) db.prepare('UPDATE pages SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
        if (group_name !== undefined) db.prepare('UPDATE pages SET group_name = ? WHERE id = ?').run(group_name || null, id);
      }
    });
    return { ok: true };
  });

  // --- Google Drive ---
  app.get('/api/drive/list', async (req) => {
    const folderId = parseFolderId(req.query.folderId || getSetting('drive_folder_id'));
    if (!folderId) throw bad('Chưa nhập thư mục Google Drive (Cài đặt → Google Drive)');
    return { folderId, ...(await listFolder(folderId)) };
  });

  app.get('/api/drive/folder-videos', async (req) => {
    const folderId = parseFolderId(req.query.folderId);
    if (!folderId) throw bad('Thiếu folderId');
    return { videos: await listVideosRecursive(folderId, req.query.name || '') };
  });

  // --- Jobs ---
  app.get('/api/jobs', async (req) => {
    const where = [];
    const args = [];
    if (req.query.status) { where.push('j.status = ?'); args.push(req.query.status); }
    if (req.query.pageId) { where.push('j.page_id = ?'); args.push(req.query.pageId); }
    const rows = db.prepare(`
      SELECT j.id, j.page_id, p.name AS page_name, j.drive_file_id, j.drive_file_name, j.caption, j.scheduled_at,
             j.status, j.video_id, j.attempts, j.error, j.published_at
      FROM jobs j LEFT JOIN pages p ON p.id = j.page_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY j.scheduled_at DESC LIMIT 3000
    `).all(...args);
    const counts = Object.fromEntries(
      db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all().map((r) => [r.status, r.n]));
    return { rows, counts };
  });

  // slotTimes: posting times (ms) computed by the browser in the user's timezone — either
  // fixed daily slots (7h, 11h, 20h...) or evenly spaced. Each page posts one video per slot;
  // within a slot pages go one after another with a random gap of gapMinSec..gapMaxSec.
  app.post('/api/jobs/bulk', async (req) => {
    const {
      videos = [], pageIds = [], mode = 'all', slotTimes = [], gapMinSec = 30, gapMaxSec = 120, shuffle = false, captionTemplate = '',
    } = req.body || {};
    if (!videos.length) throw bad('Chưa chọn video');
    if (!pageIds.length) throw bad('Chưa chọn page');
    if (!slotTimes.length) throw bad('Chưa có khung giờ đăng');

    const pages = pageIds.map((id) => db.prepare('SELECT id, name FROM pages WHERE id = ?').get(id)).filter(Boolean);
    if (!pages.length) throw bad('Không tìm thấy page nào, hãy đồng bộ lại');

    const order = (list) => (shuffle ? shuffled(list) : list);
    const plan = [];
    if (mode === 'split') {
      order(videos).forEach((video, i) => plan.push({ page: pages[i % pages.length], video, slot: Math.floor(i / pages.length) }));
    } else {
      // Separate order per page so pages don't post the same video in the same slot.
      for (const page of pages) order(videos).forEach((video, slot) => plan.push({ page, video, slot }));
    }
    const slotsNeeded = Math.max(...plan.map((p) => p.slot)) + 1;
    if (slotsNeeded > slotTimes.length) throw bad(`Cần ${slotsNeeded} khung giờ nhưng chỉ có ${slotTimes.length}`);

    const lo = Math.max(0, Math.min(gapMinSec, gapMaxSec)) * 1000;
    const hi = Math.max(gapMinSec, gapMaxSec) * 1000;
    const bySlot = Map.groupBy(plan, (p) => p.slot);
    for (const [slot, entries] of bySlot) {
      let offset = 0;
      shuffled(entries).forEach((entry, i) => {
        if (i > 0) offset += lo + Math.random() * (hi - lo);
        entry.at = Number(slotTimes[slot]) + Math.round(offset);
      });
    }

    const now = Date.now();
    const insert = db.prepare(`
      INSERT INTO jobs (page_id, drive_file_id, drive_file_name, caption, scheduled_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `);
    transaction(() => {
      for (const { page, video, at } of plan) {
        const caption = renderCaption(captionTemplate, { filename: video.name.replace(/\.[^.]+$/, ''), page: page.name });
        insert.run(page.id, video.id, video.name, caption, at, now, now);
      }
    });
    const times = plan.map((p) => p.at);
    return { created: plan.length, firstAt: Math.min(...times), lastAt: Math.max(...times) };
  });

  app.patch('/api/jobs/:id', async (req) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) throw bad('Không tìm thấy job', 404);
    if (!EDITABLE.includes(job.status)) throw bad('Job đang được xử lý, không sửa được');
    const { caption = job.caption, scheduled_at = job.scheduled_at } = req.body || {};
    db.prepare('UPDATE jobs SET caption = ?, scheduled_at = ?, updated_at = ? WHERE id = ?')
      .run(caption, Number(scheduled_at), Date.now(), job.id);
    return { ok: true };
  });

  app.post('/api/jobs/action', async (req) => {
    const { ids = [], action } = req.body || {};
    const now = Date.now();
    const statements = {
      cancel: db.prepare(`UPDATE jobs SET status = 'canceled', updated_at = ? WHERE id = ? AND status IN ('pending', 'uploaded', 'failed')`),
      retry: db.prepare(`UPDATE jobs SET status = 'pending', attempts = 0, error = NULL, next_try_at = NULL, video_id = NULL,
                         upload_url = NULL, published_at = NULL, updated_at = ? WHERE id = ? AND status IN ('failed', 'canceled')`),
      publish_now: db.prepare(`UPDATE jobs SET scheduled_at = ?, next_try_at = NULL WHERE id = ? AND status IN ('pending', 'uploaded')`),
      delete: db.prepare(`DELETE FROM jobs WHERE ? > 0 AND id = ? AND status IN ('pending', 'failed', 'canceled', 'done')`),
    };
    const stmt = statements[action];
    if (!stmt) throw bad('Thao tác không hợp lệ');
    let changed = 0;
    transaction(() => {
      for (const id of ids) changed += Number(stmt.run(now, id).changes);
    });
    return { changed };
  });

  // --- Reels & stats ---
  // Page / group filters shared by the reels list and the charts.
  function reelFilters(query) {
    const where = [];
    const args = [];
    if (query.pageId) { where.push('r.page_id = ?'); args.push(query.pageId); }
    if (query.group === NO_GROUP) where.push('p.group_name IS NULL');
    else if (query.group) { where.push('p.group_name = ?'); args.push(query.group); }
    return { where, args };
  }

  app.get('/api/reels', async (req) => {
    const since = Date.now() - Number(req.query.days || 7) * 86_400_000;
    const { where, args } = reelFilters(req.query);
    where.unshift('r.published_at >= ?');
    args.unshift(since);
    if (req.query.viral === '1') where.push('r.viral = 1');
    return db.prepare(`
      SELECT r.*, p.name AS page_name, p.group_name FROM reels r LEFT JOIN pages p ON p.id = r.page_id
      WHERE ${where.join(' AND ')} ORDER BY r.views DESC LIMIT 3000
    `).all(...args);
  });

  // Views gained per hour (UTC hour buckets; the browser groups them into local days).
  // Gain = difference between consecutive stat snapshots; a reel's first snapshot is
  // credited to its publish hour, since those views came in between publish and first fetch.
  app.get('/api/analytics/view-gains', async (req) => {
    const since = Date.now() - Number(req.query.days || 7) * 86_400_000;
    const { where, args } = reelFilters(req.query);
    return db.prepare(`
      WITH s AS (
        SELECT rs.ts, rs.views, r.published_at,
               LAG(rs.views) OVER (PARTITION BY rs.video_id ORDER BY rs.ts) AS prev
        FROM reel_stats rs
        JOIN reels r ON r.video_id = rs.video_id
        LEFT JOIN pages p ON p.id = r.page_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      )
      SELECT (CASE WHEN prev IS NULL THEN published_at ELSE ts END) / 3600000 * 3600000 AS hour,
             SUM(MAX(views - COALESCE(prev, 0), 0)) AS gain
      FROM s
      GROUP BY hour
      HAVING hour >= ?
      ORDER BY hour
    `).all(...args, since);
  });

  app.get('/api/reels/:id/history', async (req) =>
    db.prepare('SELECT ts, views, likes, comments, shares FROM reel_stats WHERE video_id = ? ORDER BY ts').all(req.params.id));

  app.post('/api/stats/refresh', async () => {
    const started = !isStatsRunning();
    if (started) refreshStats().catch((e) => app.log.error(e));
    return { started };
  });

  app.get('/api/overview', async () => {
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const weekAgo = Date.now() - 7 * 86_400_000;
    const one = (sql, ...a) => Object.values(db.prepare(sql).get(...a))[0] ?? 0;
    return {
      pages: one('SELECT COUNT(*) FROM pages WHERE enabled = 1'),
      upcoming: one(`SELECT COUNT(*) FROM jobs WHERE status IN ('pending', 'uploading', 'uploaded', 'publishing', 'processing')`),
      doneToday: one(`SELECT COUNT(*) FROM jobs WHERE status = 'done' AND published_at >= ?`, startOfDay),
      failed: one(`SELECT COUNT(*) FROM jobs WHERE status = 'failed'`),
      views7d: one('SELECT COALESCE(SUM(views), 0) FROM reels WHERE published_at >= ?', weekAgo),
      viral7d: one('SELECT COUNT(*) FROM reels WHERE viral = 1 AND published_at >= ?', weekAgo),
      statsLastRun: Number(getSetting('stats_last_run') || 0) || null,
      statsRunning: isStatsRunning(),
    };
  });
}
