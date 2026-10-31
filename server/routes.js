import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createTask, runTask } from './tasks.js';
import { DATA_DIR, db, getAllSettings, getSetting, setSetting, SETTING_KEYS, transaction } from './db.js';
import * as fb from './fb.js';
import {
  CACHE_DIR, ensureLocal, listAudioRecursive, listFilesRecursive, listFolder, listVideosRecursive, parseFolderId, releaseLocal, serviceAccountEmail, streamFile,
} from './drive.js';
import { refreshStats, isStatsRunning } from './stats.js';
import { renderCaption } from './caption.js';
import { listBackups, prepareRestore } from './backups.js';
import { spawn } from 'node:child_process';
import { assignHooks, assignMusic, buildVideo, MUSIC_PICKS } from './music.js';

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
    if (body.music_folder_id) body.music_folder_id = parseFolderId(body.music_folder_id);
    if (body.hook_folder_id) body.hook_folder_id = parseFolderId(body.hook_folder_id);
    for (const [k, v] of Object.entries(body)) if (SETTING_KEYS.includes(k)) setSetting(k, v);
    return { ok: true };
  });

  // --- Backups (made daily by scripts/backup-vps.sh) ---
  const restorePassword = () => process.env.RESTORE_PASSWORD || process.env.APP_PASSWORD || '';
  const sameSecret = (a, b) => {
    const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
    return crypto.timingSafeEqual(h(a), h(b));
  };
  let restoring = false;

  app.get('/api/backups', async () => ({
    ...(await listBackups()),
    canRestore: !!restorePassword(),
    busy: db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status IN ('uploading', 'publishing', 'processing')`).get().n,
  }));

  app.post('/api/backups/restore', async (req) => {
    const { name, password } = req.body || {};
    if (!restorePassword()) throw bad('Chưa đặt APP_PASSWORD (hoặc RESTORE_PASSWORD) trong .env nên không thể khôi phục');
    if (!sameSecret(password || '', restorePassword())) {
      await new Promise((r) => setTimeout(r, 1500));
      throw bad('Sai mật khẩu', 403);
    }
    if (restoring) throw bad('Đang khôi phục rồi, chờ chút');
    restoring = true;
    try {
      const counts = await prepareRestore(name);
      app.log.warn(`restore ${name} prepared, restarting`);
      // Under pm2 exiting is enough; started by hand, start a fresh copy first.
      setTimeout(() => {
        if (process.env.pm_id === undefined) {
          spawn(process.execPath, process.execArgv.concat(process.argv.slice(1)), { detached: true, stdio: 'ignore' }).unref();
        }
        process.exit(0);
      }, 500);
      return { ok: true, ...counts };
    } catch (e) {
      restoring = false;
      throw bad(`Không khôi phục được: ${e.message}`);
    }
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

  // --- Schedule presets: the schedule form's settings saved under a name (same name overwrites) ---
  const presetRow = (p) => ({ id: p.id, name: p.name, config: JSON.parse(p.config), updated_at: p.updated_at });
  app.get('/api/schedule-presets', async () =>
    db.prepare('SELECT * FROM schedule_presets ORDER BY name').all().map(presetRow));

  app.post('/api/schedule-presets', async (req) => {
    const name = req.body?.name?.trim();
    const config = req.body?.config;
    if (!name) throw bad('Chưa nhập tên cấu hình');
    if (!config || typeof config !== 'object') throw bad('Thiếu cấu hình');
    db.prepare(`
      INSERT INTO schedule_presets (name, config, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at
    `).run(name, JSON.stringify(config), Date.now());
    return presetRow(db.prepare('SELECT * FROM schedule_presets WHERE name = ?').get(name));
  });

  app.delete('/api/schedule-presets/:id', async (req) => {
    db.prepare('DELETE FROM schedule_presets WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  });

  // --- Pages ---
  app.get('/api/pages', async () => db.prepare(`
    SELECT p.id, p.name, p.picture, p.enabled, p.group_name, p.synced_at, p.account_id, a.name AS account_name
    FROM pages p LEFT JOIN fb_accounts a ON a.id = p.account_id
    ORDER BY p.name
  `).all());

  // Everything the page detail drawer needs beyond the reels already loaded for the chosen period.
  app.get('/api/pages/:id/summary', async (req) => {
    const page = db.prepare(`
      SELECT p.id, p.name, p.picture, p.enabled, p.group_name, a.name AS account_name
      FROM pages p LEFT JOIN fb_accounts a ON a.id = p.account_id WHERE p.id = ?
    `).get(req.params.id);
    if (!page) throw bad('Không tìm thấy page', 404);
    const totals = db.prepare(`
      SELECT COUNT(*) AS reels, COALESCE(SUM(views), 0) AS views, MIN(published_at) AS first_at, MAX(published_at) AS last_at
      FROM reels WHERE page_id = ?
    `).get(page.id);
    const jobs = db.prepare(`
      SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'uploading', 'uploaded', 'publishing', 'processing')) AS upcoming,
             COUNT(*) FILTER (WHERE status = 'failed') AS failed
      FROM jobs WHERE page_id = ?
    `).get(page.id);
    const next = db.prepare(`
      SELECT id, scheduled_at, status, drive_file_name FROM jobs
      WHERE page_id = ? AND status IN ('pending', 'uploading', 'uploaded', 'publishing', 'processing')
      ORDER BY scheduled_at LIMIT 10
    `).all(page.id);
    return { page, totals, jobs, next };
  });

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

  // How many videos in each folder (subfolders included) were already posted, for the picker.
  // Drive listings are cached briefly; posted/upcoming counts always come fresh from the DB.
  const folderCache = new Map(); // folderId -> { at, ids }
  const FOLDER_CACHE_MS = 5 * 60_000;
  app.get('/api/drive/folder-usage', async (req) => {
    const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 200);
    const fileIds = async (id) => {
      const hit = folderCache.get(id);
      if (hit && Date.now() - hit.at < FOLDER_CACHE_MS) return hit.ids;
      const list = (await listVideosRecursive(id)).map((v) => v.id);
      folderCache.set(id, { at: Date.now(), ids: list });
      return list;
    };
    const usage = db.prepare(`
      SELECT SUM(status = 'done') > 0 AS posted, SUM(status IN ${ACTIVE}) > 0 AS upcoming
      FROM jobs WHERE drive_file_id = ?
    `);
    const out = {};
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try {
          const files = await fileIds(id);
          let posted = 0;
          let upcoming = 0;
          for (const f of files) {
            const u = usage.get(f);
            if (u.posted) posted++;
            else if (u.upcoming) upcoming++;
          }
          out[id] = { total: files.length, posted, upcoming };
        } catch (e) {
          out[id] = { error: e.message };
        }
      }
    }));
    return out;
  });

  // Music files from the music folder, cached for a few minutes since the stats page polls.
  let musicCache = { key: null, at: 0, files: null };
  const musicFiles = async (fresh) => {
    const folderId = getSetting('music_folder_id');
    if (!folderId) return null;
    if (fresh || musicCache.key !== folderId || Date.now() - musicCache.at > 10 * 60_000) {
      musicCache = { key: folderId, at: Date.now(), files: await listAudioRecursive(folderId) };
    }
    return musicCache.files;
  };
  app.get('/api/music', async (req) => {
    const files = await musicFiles(req.query.fresh);
    return { configured: !!files, files: files || [] };
  });

  // Hooks (short intros played before a video: video clips, or voice-only audio) from the hook folder, cached like the music.
  let hookCache = { key: null, at: 0, files: null };
  const hookFiles = async (fresh) => {
    const folderId = getSetting('hook_folder_id');
    if (!folderId) return null;
    if (fresh || hookCache.key !== folderId || Date.now() - hookCache.at > 10 * 60_000) {
      hookCache = { key: folderId, at: Date.now(), files: await listFilesRecursive(folderId, ['audio', 'video']) };
    }
    const disabled = new Set(db.prepare('SELECT drive_file_id FROM hook_meta WHERE disabled = 1').all().map((m) => m.drive_file_id));
    return hookCache.files.map((h) => ({ ...h, disabled: disabled.has(h.id) }));
  };
  // The files picked in the schedule form ([] = all of them).
  const pickedOf = (files, ids) => (ids.length ? files.filter((f) => ids.includes(f.id)) : files);

  // Hooks with their use: posts (done / upcoming, all time) and reel views published in the last `days`.
  // `compare` sets reels with a hook against reels without one over the same days.
  app.get('/api/hooks', async (req) => {
    const files = await hookFiles(req.query.fresh);
    if (!files) return { configured: false, files: [] };
    const since = Date.now() - Number(req.query.days || 30) * 86_400_000;
    const use = new Map(db.prepare(`
      SELECT j.hook_file_id AS id,
             SUM(j.status = 'done') AS posted,
             SUM(j.status IN ('pending', 'uploading', 'uploaded', 'publishing', 'processing')) AS upcoming,
             MAX(j.published_at) AS last_posted,
             COUNT(CASE WHEN r.published_at >= ? THEN 1 END) AS reels,
             COALESCE(SUM(CASE WHEN r.published_at >= ? THEN r.views END), 0) AS views
      FROM jobs j LEFT JOIN reels r ON r.job_id = j.id
      WHERE j.hook_file_id IS NOT NULL AND j.status != 'canceled'
      GROUP BY j.hook_file_id
    `).all(since, since).map((u) => [u.id, u]));
    const compare = db.prepare(`
      SELECT j.hook_file_id IS NOT NULL AS with_hook, COUNT(*) AS reels, COALESCE(SUM(r.views), 0) AS views
      FROM reels r JOIN jobs j ON j.id = r.job_id
      WHERE r.published_at >= ?
      GROUP BY with_hook
    `).all(since);
    const side = (w) => compare.find((c) => c.with_hook === w) || { reels: 0, views: 0 };
    return {
      configured: true,
      files: files.map((h) => {
        const u = use.get(h.id) || {};
        return { ...h, posted: u.posted || 0, upcoming: u.upcoming || 0, last_posted: u.last_posted || null, reels: u.reels || 0, views: u.views || 0 };
      }),
      compare: { withHook: side(1), withoutHook: side(0) },
    };
  });

  app.put('/api/hooks/:id', async (req) => {
    db.prepare(`
      INSERT INTO hook_meta (drive_file_id, disabled) VALUES (?, ?)
      ON CONFLICT(drive_file_id) DO UPDATE SET disabled = excluded.disabled
    `).run(req.params.id, req.body?.disabled ? 1 : 0);
    return { ok: true };
  });

  app.get('/api/drive/stream/:fileId', async (req, reply) => {
    const file = await streamFile(req.params.fileId, req.headers.range);
    reply.code(file.status === 206 ? 206 : 200);
    for (const [k, v] of Object.entries(file.headers)) if (v) reply.header(k, v);
    reply.header('accept-ranges', 'bytes').header('cache-control', 'private, max-age=3600');
    return reply.send(file.body);
  });

  // --- Preview: builds one video with its hook / music the way the worker will, without posting it ---
  // Only the last few previews are kept on disk.
  const PREVIEW_KEEP = 3;
  const previews = [];
  app.post('/api/preview', async (req, reply) => {
    const b = req.body || {};
    if (!b.videoFileId) throw bad('Thiếu video');
    const mode = ['replace', 'mix'].includes(b.audioMode) ? b.audioMode : 'keep';
    const musicId = mode !== 'keep' ? b.musicFileId : null;
    const hookId = b.hookFileId || null;
    if (mode !== 'keep' && !musicId) throw bad('Chưa có bài nhạc nào để ghép');
    if (!musicId && !hookId) throw bad('Chưa chọn hook hoặc nhạc để ghép');

    const id = crypto.randomBytes(8).toString('hex');
    const out = path.join(CACHE_DIR, `preview-${id}.mp4`);
    const ids = [b.videoFileId, musicId, hookId].filter(Boolean);
    const started = Date.now();
    try {
      const [video, music, hook] = await Promise.all([b.videoFileId, musicId, hookId].map((f) => f && ensureLocal(f)));
      await buildVideo({
        video: video.path,
        music: music?.path,
        hook: hook?.path,
        hookVisual: b.hookVisual === 'own' ? 'own' : 'tail',
        out,
        mode,
        origVolume: Math.min(100, Math.max(0, Number(b.origVolume ?? 30))),
      });
    } finally {
      for (const f of ids) releaseLocal(f);
    }
    previews.push(out);
    while (previews.length > PREVIEW_KEEP) fs.rmSync(previews.shift(), { force: true });
    return { id, ms: Date.now() - started, size: fs.statSync(out).size };
  });

  app.get('/api/preview/:id', async (req, reply) => {
    if (!/^[0-9a-f]{16}$/.test(req.params.id)) throw bad('Không có bản xem thử này', 404);
    const file = path.join(CACHE_DIR, `preview-${req.params.id}.mp4`);
    if (!fs.existsSync(file)) throw bad('Bản xem thử đã bị xoá, bấm ghép lại', 404);
    const size = fs.statSync(file).size;
    reply.header('content-type', 'video/mp4').header('accept-ranges', 'bytes').header('cache-control', 'no-store');
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (!m) return reply.header('content-length', size).send(fs.createReadStream(file));
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return reply.code(416).header('content-range', `bytes */${size}`).send();
    return reply.code(206)
      .header('content-range', `bytes ${start}-${end}/${size}`)
      .header('content-length', end - start + 1)
      .send(fs.createReadStream(file, { start, end }));
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
    if (req.query.pageId) { where.push('j.page_id = ?'); args.push(req.query.pageId); }
    if (req.query.group === NO_GROUP) where.push('p.group_name IS NULL');
    else if (req.query.group) { where.push('p.group_name = ?'); args.push(req.query.group); }
    // Status counts follow the page/group filter but not the status filter itself.
    const scope = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const counts = Object.fromEntries(db.prepare(`
      SELECT j.status, COUNT(*) AS n FROM jobs j LEFT JOIN pages p ON p.id = j.page_id ${scope} GROUP BY j.status
    `).all(...args).map((r) => [r.status, r.n]));
    if (req.query.status) { where.push('j.status = ?'); args.push(req.query.status); }
    const rows = db.prepare(`
      SELECT j.id, j.page_id, p.name AS page_name, p.group_name, j.drive_file_id, j.drive_file_name, j.caption, j.scheduled_at,
             j.status, j.video_id, j.attempts, j.error, j.published_at,
             j.music_file_id, j.music_file_name, j.audio_mode, j.orig_volume, j.hook_file_id, j.hook_file_name, j.hook_visual
      FROM jobs j LEFT JOIN pages p ON p.id = j.page_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY j.scheduled_at DESC LIMIT 3000
    `).all(...args);
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
      // audioMode: 'keep' (video as is) | 'replace' | 'mix'. musicFileIds: music to pick from ([] = all).
      audioMode = 'keep', musicPick = 'random', musicFileId, musicFileIds = [], origVolume = 30,
      // hookMode: 'none' | 'random' (a random enabled hook from hookFileIds, [] = all, before each video).
      // hookVisual: 'tail' (picture = the video's last seconds, hook gives the sound) | 'own' (the hook's own picture).
      hookMode = 'none', hookFileIds = [], hookVisual = 'tail',
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
    if (audioMode !== 'keep') {
      if (!['replace', 'mix'].includes(audioMode)) throw bad('Kiểu âm thanh không hợp lệ');
      if (!MUSIC_PICKS.includes(musicPick)) throw bad('Cách chọn nhạc không hợp lệ');
      if (musicPick === 'one' && !musicFileId) throw bad('Chưa chọn bài nhạc');
    }
    if (!['none', 'random'].includes(hookMode)) throw bad('Kiểu ghép hook không hợp lệ');
    if (!['tail', 'own'].includes(hookVisual)) throw bad('Kiểu hình của hook không hợp lệ');

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

    if (audioMode !== 'keep') {
      const files = await musicFiles();
      if (!files) throw bad('Chưa cấu hình thư mục nhạc trong Cài đặt');
      try {
        assignMusic(plan, musicPick === 'one' ? files : pickedOf(files, musicFileIds), { pick: musicPick, fileId: musicFileId });
      } catch (e) {
        throw bad(e.message);
      }
    }
    if (hookMode === 'random') {
      const files = await hookFiles();
      if (!files) throw bad('Chưa cấu hình thư mục hook trong Cài đặt');
      try {
        assignHooks(plan, pickedOf(files.filter((h) => !h.disabled), hookFileIds));
      } catch (e) {
        throw bad(e.message);
      }
    }
    const volume = Math.min(100, Math.max(0, Math.round(Number(origVolume) || 0)));

    const now = Date.now();
    const insert = db.prepare(`
      INSERT INTO jobs (page_id, drive_file_id, drive_file_name, caption, scheduled_at, status, created_at, updated_at,
                        music_file_id, music_file_name, audio_mode, orig_volume, hook_file_id, hook_file_name, hook_visual)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    transaction(() => {
      for (const { page, video, at, music, hook } of plan) {
        const caption = renderCaption(captionTemplate, { filename: video.name.replace(/\.[^.]+$/, ''), page: page.name });
        insert.run(page.id, video.id, video.name, caption, at, now, now,
          music?.id ?? null, music?.name ?? null, music ? audioMode : null, music && audioMode === 'mix' ? volume : null,
          hook?.id ?? null, hook?.name ?? null, hook ? hookVisual : null);
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
    // `from`/`to` (ms, publish time) pick an exact window instead of the last `days` days.
    const since = req.query.from ? Number(req.query.from) : Date.now() - Number(req.query.days || 7) * 86_400_000;
    const { where, args } = reelFilters(req.query);
    where.unshift('r.published_at >= ?');
    args.unshift(since);
    if (req.query.to) { where.push('r.published_at < ?'); args.push(Number(req.query.to)); }
    if (req.query.viral === '1') where.push('r.viral = 1');
    return db.prepare(`
      SELECT r.*, p.name AS page_name, p.group_name,
             j.drive_file_id, j.drive_file_name, j.music_file_id, j.music_file_name, j.hook_file_id, j.hook_file_name,
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
  // `by=page` sums each page over the whole window (e.g. from=0 = its total up to `to`).
  app.get('/api/analytics/view-gains', async (req) => {
    const since = req.query.from ? Number(req.query.from) : Date.now() - Number(req.query.days || 7) * 86_400_000;
    const until = req.query.to ? Number(req.query.to) : Number.MAX_SAFE_INTEGER;
    const { where, args } = reelFilters(req.query);
    const rows = db.prepare(`
      WITH s AS (
        SELECT rs.ts, rs.views, COALESCE(rs.likes, 0) AS likes, COALESCE(rs.comments, 0) AS comments,
               COALESCE(rs.shares, 0) AS shares, r.published_at, r.page_id, p.name AS page_name, p.group_name,
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
             page_id, MAX(page_name) AS page_name, MAX(group_name) AS group_name,
             SUM(MAX(views - COALESCE(prev, 0), 0)) AS gain,
             SUM(MAX(likes - COALESCE(prev_likes, 0), 0)) AS likes,
             SUM(MAX(comments - COALESCE(prev_comments, 0), 0)) AS comments,
             SUM(MAX(shares - COALESCE(prev_shares, 0), 0)) AS shares
      FROM s
      GROUP BY hour, page_id
      HAVING hour >= ? AND hour < ? AND gain + likes + comments + shares > 0
      ORDER BY hour
    `).all(...args, since, until);
    if (req.query.by !== 'page') return rows;
    const byPage = new Map();
    for (const r of rows) {
      const p = byPage.get(r.page_id);
      if (!p) byPage.set(r.page_id, { ...r, hour: null });
      else for (const k of ['gain', 'likes', 'comments', 'shares']) p[k] += r[k];
    }
    return [...byPage.values()];
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
