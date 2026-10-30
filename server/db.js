import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(import.meta.dirname, '..', 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

// A restore (see backups.js) leaves the backup here; it is swapped in before the database opens.
// The current data is kept in data/backup/before-restore-<time>/.
export const RESTORE_DIR = path.join(DATA_DIR, 'restore-pending');
if (fs.existsSync(path.join(RESTORE_DIR, 'app.db'))) {
  const keep = path.join(DATA_DIR, 'backup', `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(keep, { recursive: true });
  for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
    if (fs.existsSync(path.join(DATA_DIR, f))) fs.renameSync(path.join(DATA_DIR, f), path.join(keep, f));
  }
  if (fs.existsSync(path.join(RESTORE_DIR, 'avatars'))) {
    if (fs.existsSync(path.join(DATA_DIR, 'avatars'))) fs.renameSync(path.join(DATA_DIR, 'avatars'), path.join(keep, 'avatars'));
    fs.renameSync(path.join(RESTORE_DIR, 'avatars'), path.join(DATA_DIR, 'avatars'));
  }
  fs.renameSync(path.join(RESTORE_DIR, 'app.db'), path.join(DATA_DIR, 'app.db'));
  fs.rmSync(RESTORE_DIR, { recursive: true, force: true });
  console.warn(`♻️  Đã khôi phục backup, dữ liệu cũ cất ở ${keep}`);
}

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    name TEXT,
    access_token TEXT,
    picture TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    group_name TEXT,
    synced_at INTEGER
  );

  -- status: pending -> uploading -> uploaded -> publishing -> processing -> done | failed | canceled
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id TEXT NOT NULL,
    drive_file_id TEXT NOT NULL,
    drive_file_name TEXT,
    caption TEXT,
    scheduled_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    video_id TEXT,
    upload_url TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_try_at INTEGER,
    error TEXT,
    published_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, scheduled_at);

  CREATE TABLE IF NOT EXISTS reels (
    video_id TEXT PRIMARY KEY,
    page_id TEXT,
    job_id INTEGER,
    caption TEXT,
    permalink TEXT,
    published_at INTEGER,
    views INTEGER NOT NULL DEFAULT 0,
    reach INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0,
    avg_watch_ms INTEGER NOT NULL DEFAULT 0,
    viral_score REAL,
    viral INTEGER NOT NULL DEFAULT 0,
    stats_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_reels_page ON reels(page_id, published_at);

  CREATE TABLE IF NOT EXISTS reel_stats (
    video_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    views INTEGER,
    likes INTEGER,
    comments INTEGER,
    shares INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_reel_stats ON reel_stats(video_id, ts);

  -- Groups exist on their own so they can be created before any page is assigned.
  CREATE TABLE IF NOT EXISTS page_groups (
    name TEXT PRIMARY KEY,
    created_at INTEGER
  );
  INSERT OR IGNORE INTO page_groups (name, created_at)
    SELECT DISTINCT group_name, 0 FROM pages WHERE group_name IS NOT NULL;

  -- One row per Business Manager: its System User token and Business ID.
  CREATE TABLE IF NOT EXISTS fb_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    token TEXT NOT NULL,
    business_id TEXT,
    created_at INTEGER
  );

  -- Groups for source videos (Drive files), separate from page groups. One group per video.
  CREATE TABLE IF NOT EXISTS video_groups (
    name TEXT PRIMARY KEY,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS video_meta (
    drive_file_id TEXT PRIMARY KEY,
    group_name TEXT
  );

  CREATE TABLE IF NOT EXISTS caption_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    template TEXT NOT NULL,
    updated_at INTEGER
  );
`);

if (!db.prepare('PRAGMA table_info(pages)').all().some((c) => c.name === 'account_id')) {
  db.exec('ALTER TABLE pages ADD COLUMN account_id INTEGER');
}

// One-time move of the old single-account settings (fb_token / business_id) into fb_accounts.
{
  const legacyToken = db.prepare("SELECT value FROM settings WHERE key = 'fb_token'").get()?.value;
  if (legacyToken && !db.prepare('SELECT 1 FROM fb_accounts').get()) {
    const businessId = db.prepare("SELECT value FROM settings WHERE key = 'business_id'").get()?.value || null;
    const { lastInsertRowid } = db.prepare('INSERT INTO fb_accounts (name, token, business_id, created_at) VALUES (?, ?, ?, ?)')
      .run('BM 1', legacyToken, businessId, Date.now());
    db.prepare('UPDATE pages SET account_id = ? WHERE account_id IS NULL').run(lastInsertRowid);
  }
  db.exec("DELETE FROM settings WHERE key IN ('fb_token', 'business_id')");
}

const DEFAULTS = {
  graph_version: 'v23.0',
  google_sa_json: '',
  drive_folder_id: '',
  music_folder_id: '',
  time_slots: '07:00,11:00,20:00',
  upload_concurrency: '4',
  preupload_minutes: '10',
  stats_interval_minutes: '120',
  stats_days: '7',
  viral_multiplier: '3',
  viral_min_views: '1000',
};
export const SETTING_KEYS = Object.keys(DEFAULTS);

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULTS[key];
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? null : String(value));
}

export function getAllSettings() {
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, getSetting(k)]));
}

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
