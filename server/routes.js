import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createTask, runTask } from './tasks.js';
import { DATA_DIR, db, getAllSettings, getSetting, setSetting, SETTING_KEYS, transaction } from './db.js';
import * as fb from './fb.js';
import { listFolder, listVideosRecursive, parseFolderId, serviceAccountEmail, streamFile } from './drive.js';
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

  // --- Caption templates (saving with an existing name overwrites it) ---
  app.get('/api/caption-templates', async () =>
    db.prepare('SELECT id, name, template FROM caption_templates ORDER BY name').all());

  app.post('/api/caption-templates', async (req) => {
    const name = req.body?.name?.trim();
    const template = req.body?.template || '';
    if (!name) throw bad('Chưa nhập tên mẫu');
    if (!template.trim()) throw bad('Caption đang trống');
    db.prepare(`
      INSERT INTO caption_templates (name, template, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET template = excluded.template, updated_at = excluded.updated_at
    `).run(name, template, Date.now());
    return db.prepare('SELECT id, name, template FROM caption_templates WHERE name = ?').get(name);
  });

  app.delete('/api/caption-templates/:id', async (req) => {
    db.prepare('DELETE FROM caption_templates WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  });

  // --- Pages ---
  app.get('/api/pages', async () => db.prepare(`
    SELECT p.id, p.name, p.picture, p.enabled, p.group_name, p.synced_at, p.account_id, a.name AS account_name
    FROM pages p LEFT JOIN fb_accounts a ON a.id = p.account_id
    ORDER BY p.name
  `).all());

  // --- Facebook accounts (one per Business Manager) ---
  const getAccount = (id) => {
    if (id == null || id === '') throw bad('Chưa chọn tài khoản BM');
    const account = db.prepare('SELECT * FROM fb_accounts WHERE id = ?').get(Number(id));
    if (!account) throw bad('Không tìm thấy tài khoản BM', 404);
    return account;
  };
  const maskToken = (t) => (t ? `${t.slice(0, 6)}…${t.slice(-4)}` : '');

  async function checkToken(token) {
    try {
      return await fb.getMe(token);
    } catch (e) {
      throw bad(`Token không dùng được: ${e.message}`);
    }
  }

  app.get('/api/accounts', async () => db.prepare(`
    SELECT a.id, a.name, a.business_id, a.token, a.created_at, COUNT(p.id) AS pages
    FROM fb_accounts a LEFT JOIN pages p ON p.account_id = a.id
    GROUP BY a.id ORDER BY a.id
  `).all().map(({ token, ...a }) => ({ ...a, token_hint: maskToken(token) })));

  app.post('/api/accounts', async (req) => {
    const name = req.body?.name?.trim();
    const token = req.body?.token?.trim();
    const businessId = req.body?.business_id?.trim() || null;
    if (!name) throw bad('Nhập tên gợi nhớ cho tài khoản');
    if (!token) throw bad('Nhập System User Token');
    const me = await checkToken(token);
    const { lastInsertRowid } = db.prepare('INSERT INTO fb_accounts (name, token, business_id, created_at) VALUES (?, ?, ?, ?)')
      .run(name, token, businessId, Date.now());
    return { id: Number(lastInsertRowid), systemUser: me.name };
  });

  app.patch('/api/accounts/:id', async (req) => {
    const account = getAccount(req.params.id);
    const name = req.body?.name?.trim() || account.name;
    const businessId = req.body?.business_id !== undefined ? (req.body.business_id?.trim() || null) : account.business_id;
    const newToken = req.body?.token?.trim();
    if (newToken) await checkToken(newToken);
    db.prepare('UPDATE fb_accounts SET name = ?, business_id = ?, token = ? WHERE id = ?')
      .run(name, businessId, newToken || account.token, account.id);
    // Page tokens are derived from the System User token, so a new token needs a resync to take effect.
    if (newToken) return { ok: true, synced: (await syncAccount(getAccount(account.id))).length };
    return { ok: true };
  });

  // Removes the account and its pages; their unpublished jobs are canceled. Reel stats are kept.
  app.delete('/api/accounts/:id', async (req) => {
    const account = getAccount(req.params.id);
    let pages = 0;
    let jobs = 0;
    transaction(() => {
      jobs = Number(db.prepare(`
        UPDATE jobs SET status = 'canceled', updated_at = ?
        WHERE status IN ('pending', 'uploaded', 'failed') AND page_id IN (SELECT id FROM pages WHERE account_id = ?)
      `).run(Date.now(), account.id).changes);
      pages = Number(db.prepare('DELETE FROM pages WHERE account_id = ?').run(account.id).changes);
      db.prepare('DELETE FROM fb_accounts WHERE id = ?').run(account.id);
    });
    return { pages, jobs };
  });

  app.post('/api/accounts/:id/test', async (req) => {
    const account = getAccount(req.params.id);
    const me = await checkToken(account.token);
    const pages = await fb.listManagedPages(account.token);
    return { systemUser: me.name, pages: pages.length };
  });

  async function syncAccount(account) {
    const pages = await fb.listManagedPages(account.token);
    const stmt = db.prepare(`
      INSERT INTO pages (id, name, access_token, picture, synced_at, account_id) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, access_token = excluded.access_token,
        picture = excluded.picture, synced_at = excluded.synced_at, account_id = excluded.account_id
    `);
    const now = Date.now();
    transaction(() => {
      for (const p of pages) stmt.run(p.id, p.name, p.access_token, p.picture?.data?.url ?? null, now, account.id);
    });
    return pages;
  }

  // Syncs every account; one failing account doesn't stop the others.
  app.post('/api/pages/sync', async () => {
    const accounts = db.prepare('SELECT * FROM fb_accounts ORDER BY id').all();
    if (!accounts.length) throw bad('Chưa thêm tài khoản BM nào (Cài đặt → Tài khoản Facebook)');
    const results = [];
    for (const account of accounts) {
      try {
        results.push({ account: account.name, synced: (await syncAccount(account)).length });
      } catch (e) {
        results.push({ account: account.name, error: e.message });
      }
    }
    return { synced: results.reduce((s, r) => s + (r.synced || 0), 0), results };
  });

  // Assigns every page of the BM to the system user via API (the BM UI fails on bulk assigns).
  // Runs in the background; the UI polls /status to show progress.
  let assignTask = null;
  const ASSIGN_DELAY_MS = 4_000;

  function startAssignAll(account) {
    const { token, business_id: businessId } = account;
    const task = createTask({ account: account.name, total: 0, alreadyAssigned: 0, newlyAssigned: 0, synced: null });
    return runTask(task, async ({ log, sleep, retryOnBlock, failItem }) => {
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

      task.phase = 'Đang gán page';
      for (const page of todo) {
        task.current = page.name;
        try {
          await retryOnBlock(page.name, () => fb.assignPageToUser(page.id, me.id, token));
          task.newlyAssigned++;
          log(`✓ ${page.name}`, 'success');
        } catch (e) {
          failItem({ id: page.id, name: page.name, source: page.source }, e);
        }
        task.done++;
        await sleep(ASSIGN_DELAY_MS);
      }
      task.current = null;

      task.phase = 'Đồng bộ lại danh sách page';
      task.synced = (await syncAccount(account)).length;
      log(`Hoàn tất: app hiện có ${task.synced} page`, 'success');
    }, { canceledText: 'Đã dừng theo yêu cầu. Bấm gán lại để tiếp tục — page đã gán sẽ được bỏ qua.' });
  }

  app.post('/api/pages/assign-all/cancel', async () => {
    if (assignTask?.running) assignTask.cancel = true;
    return { ok: true };
  });

  app.post('/api/pages/assign-all', async (req) => {
    if (assignTask?.running) return assignTask;
    const account = getAccount(req.body?.accountId);
    if (!account.business_id) throw bad(`Tài khoản "${account.name}" chưa có Business ID (Cài đặt → Tài khoản Facebook)`);
    assignTask = startAssignAll(account);
    return assignTask;
  });

  app.get('/api/pages/assign-all/status', async () => assignTask || { running: false, idle: true });

  // --- Bulk avatar change ---
  // The browser uploads each image once (raw body), then starts a task with page -> image pairs.
  const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
  const AVATAR_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png' };
  fs.mkdirSync(AVATAR_DIR, { recursive: true });

  app.addContentTypeParser(/^image\//, { parseAs: 'buffer', bodyLimit: 15 * 1024 * 1024 }, (req, body, done) => done(null, body));

  app.post('/api/avatars/upload', async (req) => {
    const type = req.headers['content-type'];
    if (!AVATAR_TYPES[type]) throw bad('Chỉ hỗ trợ ảnh JPG hoặc PNG');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Ảnh rỗng');
    // Drop leftovers from runs that never started.
    const dayAgo = Date.now() - 86_400_000;
    for (const f of fs.readdirSync(AVATAR_DIR)) {
      const p = path.join(AVATAR_DIR, f);
      if (fs.statSync(p).mtimeMs < dayAgo) fs.rmSync(p, { force: true });
    }
    const id = `${crypto.randomUUID()}${AVATAR_TYPES[type]}`;
    fs.writeFileSync(path.join(AVATAR_DIR, id), req.body);
    return { id };
  });

  let avatarTask = null;

  function startAvatarChange(items, minSec, maxSec) {
    const task = createTask({ todo: items.length, changed: 0, test: items.length === 1 });
    return runTask(task, async ({ log, sleep, retryOnBlock, failItem }) => {
      log(`Đổi avatar cho ${items.length} page, mỗi page cách nhau ngẫu nhiên ${minSec}–${maxSec} giây`);
      task.phase = 'Đang đổi avatar';
      try {
        for (const { page, image, fileName } of items) {
          task.current = page.name;
          try {
            await retryOnBlock(page.name, () => fb.setPagePicture(page.id, page.access_token, path.join(AVATAR_DIR, image)));
            task.changed++;
            log(`✓ ${page.name} ← ${fileName}`, 'success');
          } catch (e) {
            const hint = [10, 200, 283].includes(e.details?.code)
              ? ' → Tạo lại System User token có tick quyền pages_manage_metadata, dán vào Cài đặt → Sửa BM (app tự đồng bộ lại page).'
              : '';
            failItem({ id: page.id, name: page.name }, new Error(e.message + hint));
          }
          task.done++;
          if (task.done < items.length) {
            const wait = minSec + Math.random() * (maxSec - minSec);
            task.nextAt = Date.now() + wait * 1000;
            await sleep(wait * 1000);
            task.nextAt = null;
          }
        }
        task.current = null;

        task.phase = 'Cập nhật avatar trong app';
        const accountIds = [...new Set(items.map((i) => i.page.account_id).filter(Boolean))];
        for (const id of accountIds) await syncAccount(getAccount(id));
        log(`Hoàn tất: đổi được ${task.changed}/${items.length} page`, 'success');
      } finally {
        for (const image of new Set(items.map((i) => i.image))) fs.rmSync(path.join(AVATAR_DIR, image), { force: true });
      }
    }, { canceledText: 'Đã dừng theo yêu cầu. Các page chưa đổi vẫn giữ avatar cũ.' });
  }

  app.post('/api/avatars/run', async (req) => {
    if (avatarTask?.running) throw bad('Đang có một lượt đổi avatar chạy, chờ xong hoặc bấm Dừng');
    const { items = [], delayMinSec = 10, delayMaxSec = 30 } = req.body || {};
    if (!items.length) throw bad('Chưa chọn page');
    const resolved = items.map(({ pageId, imageId, fileName }) => {
      const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId);
      if (!page) throw bad(`Không tìm thấy page ${pageId}`);
      if (!/^[\w-]+\.(jpg|png)$/.test(imageId) || !fs.existsSync(path.join(AVATAR_DIR, imageId))) {
        throw bad('Ảnh đã hết hạn, hãy chọn lại thư mục ảnh');
      }
      return { page, image: imageId, fileName: fileName || imageId };
    });
    const lo = Math.max(3, Number(delayMinSec) || 10);
    const hi = Math.max(lo, Number(delayMaxSec) || lo);
    avatarTask = startAvatarChange(resolved, lo, hi);
    return avatarTask;
  });

  app.post('/api/avatars/cancel', async () => {
    if (avatarTask?.running) avatarTask.cancel = true;
    return { ok: true };
  });

  app.get('/api/avatars/status', async () => avatarTask || { running: false, idle: true });

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
    const { folders, videos } = await listFolder(folderId);
    return { folderId, folders, videos: withUsage(videos) };
  });

  app.get('/api/drive/folder-videos', async (req) => {
    const folderId = parseFolderId(req.query.folderId);
    if (!folderId) throw bad('Thiếu folderId');
    return { videos: withUsage(await listVideosRecursive(folderId, req.query.name || '')) };
  });

  app.get('/api/drive/stream/:fileId', async (req, reply) => {
    const file = await streamFile(req.params.fileId, req.headers.range);
    reply.code(file.status === 206 ? 206 : 200);
    for (const [k, v] of Object.entries(file.headers)) if (v) reply.header(k, v);
    reply.header('accept-ranges', 'bytes').header('cache-control', 'private, max-age=3600');
    return reply.send(file.body);
  });

  // --- Source videos: how each Drive file has been used across pages ---
  const ACTIVE = `('pending', 'uploading', 'uploaded', 'publishing', 'processing')`;

  // Adds { posted, upcoming } to each Drive video so the picker can warn about reuse.
  function withUsage(videos) {
    if (!videos.length) return videos;
    const rows = db.prepare(`
      SELECT drive_file_id AS id, SUM(status = 'done') AS posted, SUM(status IN ${ACTIVE}) AS upcoming
      FROM jobs WHERE drive_file_id IN (${videos.map(() => '?').join(',')}) GROUP BY drive_file_id
    `).all(...videos.map((v) => v.id));
    const usage = new Map(rows.map((r) => [r.id, r]));
    return videos.map((v) => ({ ...v, posted: usage.get(v.id)?.posted || 0, upcoming: usage.get(v.id)?.upcoming || 0 }));
  }

  // --- Video groups (same shape as page groups) ---
  app.get('/api/video-groups', async () => db.prepare(`
    SELECT g.name, COUNT(m.drive_file_id) AS total
    FROM video_groups g LEFT JOIN video_meta m ON m.group_name = g.name
    GROUP BY g.name ORDER BY g.name
  `).all());

  app.post('/api/video-groups', async (req) => {
    const name = req.body?.name?.trim();
    if (!name) throw bad('Nhập tên nhóm');
    if (db.prepare('SELECT 1 FROM video_groups WHERE name = ?').get(name)) throw bad(`Nhóm "${name}" đã có`);
    db.prepare('INSERT INTO video_groups (name, created_at) VALUES (?, ?)').run(name, Date.now());
    return { name };
  });

  // Rename (merging if the new name exists), or delete when `to` is empty — videos become ungrouped.
  app.post('/api/video-groups/rename', async (req) => {
    const from = req.body?.from;
    const to = req.body?.to?.trim() || null;
    if (!from) throw bad('Thiếu tên nhóm');
    let changed = 0;
    transaction(() => {
      db.prepare('DELETE FROM video_groups WHERE name = ?').run(from);
      if (to) db.prepare('INSERT OR IGNORE INTO video_groups (name, created_at) VALUES (?, ?)').run(to, Date.now());
      changed = Number(db.prepare('UPDATE video_meta SET group_name = ? WHERE group_name = ?').run(to, from).changes);
    });
    return { changed };
  });

  app.post('/api/videos/group', async (req) => {
    const { ids = [], group_name } = req.body || {};
    const name = group_name?.trim() || null;
    transaction(() => {
      if (name) db.prepare('INSERT OR IGNORE INTO video_groups (name, created_at) VALUES (?, ?)').run(name, Date.now());
      const stmt = db.prepare(`INSERT INTO video_meta (drive_file_id, group_name) VALUES (?, ?)
                               ON CONFLICT(drive_file_id) DO UPDATE SET group_name = excluded.group_name`);
      for (const id of ids) stmt.run(id, name);
    });
    return { ok: true };
  });

  app.get('/api/videos', async () => db.prepare(`
    SELECT j.drive_file_id AS id, MAX(j.drive_file_name) AS name,
           (SELECT group_name FROM video_meta m WHERE m.drive_file_id = j.drive_file_id) AS group_name,
           SUM(j.status = 'done') AS posted,
           SUM(j.status IN ${ACTIVE}) AS upcoming,
           SUM(j.status = 'failed') AS failed,
           COUNT(DISTINCT CASE WHEN j.status = 'done' THEN j.page_id END) AS pages,
           MIN(CASE WHEN j.status = 'done' THEN j.published_at END) AS first_posted,
           MAX(j.published_at) AS last_posted,
           COALESCE(SUM(r.views), 0) AS views,
           COALESCE(SUM(r.likes + r.comments + r.shares), 0) AS interactions,
           COALESCE(MAX(r.views), 0) AS best_views,
           COALESCE(SUM(r.viral), 0) AS viral
    FROM jobs j LEFT JOIN reels r ON r.job_id = j.id
    WHERE j.status != 'canceled'
    GROUP BY j.drive_file_id
    ORDER BY views DESC, last_posted DESC
  `).all());

  app.get('/api/videos/:fileId/posts', async (req) => db.prepare(`
    SELECT j.id AS job_id, j.page_id, p.name AS page_name, p.group_name, j.status, j.scheduled_at, j.published_at,
           j.video_id, j.error, j.caption,
           r.views, r.likes, r.comments, r.shares, r.viral, r.viral_score, r.permalink
    FROM jobs j
    LEFT JOIN pages p ON p.id = j.page_id
    LEFT JOIN reels r ON r.job_id = j.id
    WHERE j.drive_file_id = ? AND j.status != 'canceled'
    ORDER BY COALESCE(j.published_at, j.scheduled_at) DESC
  `).all(req.params.fileId));

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

  // Lightweight job list for the page × day calendar; the browser buckets by day in its own timezone.
  app.get('/api/jobs/calendar', async (req) => {
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!from || !to || to <= from) throw bad('Khoảng ngày không hợp lệ');
    return db.prepare(`
      SELECT id, page_id, scheduled_at, status, drive_file_name FROM jobs
      WHERE scheduled_at >= ? AND scheduled_at < ? AND status != 'canceled'
      ORDER BY scheduled_at
    `).all(from, to);
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

    // A slot runs until the next one starts; a page that already has an active job inside
    // a slot skips it and takes its next free slot instead.
    const times = slotTimes.map(Number);
    const slotOf = (at) => {
      let lo = 0;
      let hi = times.length - 1;
      if (at < times[0]) return -1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (times[mid] <= at) lo = mid; else hi = mid - 1;
      }
      return lo;
    };
    const busy = new Map(pages.map((p) => [p.id, new Set()]));
    const existing = db.prepare(`
      SELECT page_id, scheduled_at FROM jobs
      WHERE page_id IN (${pages.map(() => '?').join(',')}) AND scheduled_at >= ? AND status NOT IN ('canceled', 'failed')
    `).all(...pages.map((p) => p.id), times[0]);
    for (const j of existing) busy.get(j.page_id).add(slotOf(j.scheduled_at));

    const cursor = new Map();
    let skipped = 0;
    const nextSlot = (pageId) => {
      let i = cursor.get(pageId) ?? 0;
      while (busy.get(pageId).has(i)) { i++; skipped++; }
      cursor.set(pageId, i + 1);
      return i;
    };

    const order = (list) => (shuffle ? shuffled(list) : list);
    const plan = [];
    if (mode === 'split') {
      order(videos).forEach((video, i) => {
        const page = pages[i % pages.length];
        plan.push({ page, video, slot: nextSlot(page.id) });
      });
    } else {
      // Separate order per page so pages don't post the same video in the same slot.
      for (const page of pages) order(videos).forEach((video) => plan.push({ page, video, slot: nextSlot(page.id) }));
    }
    const slotsNeeded = Math.max(...plan.map((p) => p.slot)) + 1;
    if (slotsNeeded > times.length) throw bad(`Cần ${slotsNeeded} khung giờ nhưng chỉ có ${times.length}`);

    const lo = Math.max(0, Math.min(gapMinSec, gapMaxSec)) * 1000;
    const hi = Math.max(gapMinSec, gapMaxSec) * 1000;
    const bySlot = Map.groupBy(plan, (p) => p.slot);
    for (const [slot, entries] of bySlot) {
      let offset = 0;
      shuffled(entries).forEach((entry, i) => {
        if (i > 0) offset += lo + Math.random() * (hi - lo);
        entry.at = times[slot] + Math.round(offset);
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
    const planned = plan.map((p) => p.at);
    return { created: plan.length, skipped, firstAt: Math.min(...planned), lastAt: Math.max(...planned) };
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
      SELECT r.*, p.name AS page_name, p.group_name,
             j.drive_file_id, j.drive_file_name,
             (SELECT COUNT(*) FROM jobs j2 WHERE j2.drive_file_id = j.drive_file_id AND j2.status = 'done') AS source_posts
      FROM reels r
      LEFT JOIN pages p ON p.id = r.page_id
      LEFT JOIN jobs j ON j.id = r.job_id
      WHERE ${where.join(' AND ')} ORDER BY r.views DESC LIMIT 3000
    `).all(...args);
  });

  // Views (`gain`) and likes / comments / shares gained per hour (UTC hour buckets; the browser groups them into local days).
  // Gain = difference between consecutive stat snapshots; a reel's first snapshot is
  // credited to its publish hour, since those views came in between publish and first fetch.
  // One row per hour × page so the chart can show which pages the views came from.
  // `from`/`to` (ms) pick an exact window instead of the last `days` days.
  app.get('/api/analytics/view-gains', async (req) => {
    const since = req.query.from ? Number(req.query.from) : Date.now() - Number(req.query.days || 7) * 86_400_000;
    const until = req.query.to ? Number(req.query.to) : Number.MAX_SAFE_INTEGER;
    const { where, args } = reelFilters(req.query);
    return db.prepare(`
      WITH s AS (
        SELECT rs.ts, rs.views, COALESCE(rs.likes, 0) AS likes, COALESCE(rs.comments, 0) AS comments,
               COALESCE(rs.shares, 0) AS shares, r.published_at, r.page_id, p.name AS page_name,
               LAG(rs.views) OVER w AS prev,
               LAG(COALESCE(rs.likes, 0)) OVER w AS prev_likes,
               LAG(COALESCE(rs.comments, 0)) OVER w AS prev_comments,
               LAG(COALESCE(rs.shares, 0)) OVER w AS prev_shares
        FROM reel_stats rs
        JOIN reels r ON r.video_id = rs.video_id
        LEFT JOIN pages p ON p.id = r.page_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        WINDOW w AS (PARTITION BY rs.video_id ORDER BY rs.ts)
      )
      SELECT (CASE WHEN prev IS NULL THEN published_at ELSE ts END) / 3600000 * 3600000 AS hour,
             page_id, MAX(page_name) AS page_name,
             SUM(MAX(views - COALESCE(prev, 0), 0)) AS gain,
             SUM(MAX(likes - COALESCE(prev_likes, 0), 0)) AS likes,
             SUM(MAX(comments - COALESCE(prev_comments, 0), 0)) AS comments,
             SUM(MAX(shares - COALESCE(prev_shares, 0), 0)) AS shares
      FROM s
      GROUP BY hour, page_id
      HAVING hour >= ? AND hour < ? AND gain + likes + comments + shares > 0
      ORDER BY hour
    `).all(...args, since, until);
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
