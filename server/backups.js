import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, RESTORE_DIR } from './db.js';

const run = promisify(execFile);

// Same locations scripts/backup-vps.sh writes to.
const BACKUP_DIR = process.env.BACKUP_DIR || '/var/backups/autoreels';
const REMOTE = process.env.BACKUP_REMOTE || 'gdrive:AutoReels-backup';
const NAME_RE = /^autoreels-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.tar\.gz$/;
const ACTIVE = ['pending', 'uploading', 'uploaded', 'publishing', 'processing'];

// Local time the backup was taken, read from its file name.
const takenAt = (name) => {
  const [, y, mo, d, h, mi] = name.match(NAME_RE);
  return new Date(+y, mo - 1, +d, +h, +mi).getTime();
};

export async function listBackups() {
  const map = new Map();
  const add = (name, size, where) => {
    const b = map.get(name) || { name, at: takenAt(name), size, local: false, drive: false };
    b[where] = true;
    map.set(name, b);
  };
  if (fs.existsSync(BACKUP_DIR)) {
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      if (NAME_RE.test(f)) add(f, fs.statSync(path.join(BACKUP_DIR, f)).size, 'local');
    }
  }
  let driveError = null;
  try {
    const { stdout } = await run('rclone', ['lsjson', REMOTE, '--files-only'], { timeout: 30_000 });
    for (const f of JSON.parse(stdout)) if (NAME_RE.test(f.Name)) add(f.Name, f.Size, 'drive');
  } catch (e) {
    driveError = e.code === 'ENOENT' ? 'Máy này chưa cài rclone' : (e.stderr || e.message).trim().split('\n').pop();
  }
  return { backups: [...map.values()].sort((a, b) => b.at - a.at), driveError };
}

// Fetches and checks a backup, then leaves it in RESTORE_DIR for db.js to swap in on the next start.
export async function prepareRestore(name) {
  if (!NAME_RE.test(name || '')) throw new Error('Tên bản backup không hợp lệ');
  const tmp = path.join(DATA_DIR, 'restore-tmp');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    // The archive is extracted by bare file name inside tmp: some Windows tar builds read
    // "C:\..." as a remote host.
    const archive = path.join(tmp, name);
    const local = path.join(BACKUP_DIR, name);
    if (fs.existsSync(local)) fs.copyFileSync(local, archive);
    else await run('rclone', ['copyto', `${REMOTE}/${name}`, archive], { timeout: 10 * 60_000 });
    await run('tar', ['-xzf', name], { cwd: tmp, timeout: 5 * 60_000 });
    fs.rmSync(archive);
    fs.rmSync(path.join(tmp, 'env'), { force: true }); // keep this machine's .env

    const dbFile = path.join(tmp, 'app.db');
    if (!fs.existsSync(dbFile)) throw new Error('Bản backup không có app.db');
    const db = new DatabaseSync(dbFile);
    let counts;
    try {
      const ok = db.prepare('PRAGMA integrity_check').get();
      if (Object.values(ok)[0] !== 'ok') throw new Error('Database trong bản backup bị hỏng');
      // Jobs that were due before now may already have been posted after this backup was
      // taken; cancel them so the restored copy doesn't post them a second time.
      const now = Date.now();
      const { changes } = db.prepare(`
        UPDATE jobs SET status = 'canceled', error = 'Hủy khi khôi phục backup (có thể đã đăng rồi)', updated_at = ?
        WHERE status IN (${ACTIVE.map(() => '?').join(',')}) AND scheduled_at <= ?
      `).run(now, ...ACTIVE, now);
      const one = (sql) => Object.values(db.prepare(sql).get())[0];
      counts = {
        pages: one('SELECT COUNT(*) FROM pages'),
        jobs: one('SELECT COUNT(*) FROM jobs'),
        reels: one('SELECT COUNT(*) FROM reels'),
        canceled: Number(changes),
      };
    } finally {
      db.close();
    }
    fs.rmSync(RESTORE_DIR, { recursive: true, force: true });
    fs.renameSync(tmp, RESTORE_DIR);
    return counts;
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}
