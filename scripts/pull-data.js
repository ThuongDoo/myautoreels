// Copies the VPS database to this machine: npm run pull-data
// Needs VPS_SSH (e.g. root@1.2.3.4) and DISABLE_WORKER=1 in .env so this copy never posts.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

const target = process.env.VPS_SSH;
const remoteDir = process.env.VPS_APP_DIR || '/opt/autoreels';
if (!target) fail('Thiếu VPS_SSH trong .env (vd. VPS_SSH=root@1.2.3.4)');
if (process.env.DISABLE_WORKER !== '1') fail('Đặt DISABLE_WORKER=1 trong .env trước, để máy này không đăng bài trùng với VPS');

// The local app holds the database open; replacing it underneath would corrupt it.
const port = Number(process.env.PORT || 3000);
const running = await new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});
if (running) fail(`App ở máy này đang chạy (cổng ${port}), tắt đi rồi chạy lại`);

const dataDir = process.env.DATA_DIR ? path.resolve(ROOT, process.env.DATA_DIR) : path.join(ROOT, 'data');
const tmpRemote = '/tmp/autoreels-copy.db';
const tmpLocal = path.join(dataDir, 'app.db.download');
const ssh = (cmd) => execFileSync('ssh', ['-o', 'BatchMode=yes', target, cmd], { stdio: 'inherit' });

console.log(`→ Tạo bản chụp database trên ${target}`);
// VACUUM INTO gives a consistent copy while the VPS app keeps running.
ssh(`cd ${remoteDir} && rm -f ${tmpRemote} && node --disable-warning=ExperimentalWarning -e "new (require('node:sqlite').DatabaseSync)('data/app.db').exec(\\"VACUUM INTO '${tmpRemote}'\\")"`);

console.log('→ Tải về');
fs.mkdirSync(dataDir, { recursive: true });
try {
  execFileSync('scp', ['-o', 'BatchMode=yes', `${target}:${tmpRemote}`, tmpLocal], { stdio: 'inherit' });
} finally {
  ssh(`rm -f ${tmpRemote}`);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const backupDir = path.join(dataDir, 'backup');
fs.mkdirSync(backupDir, { recursive: true });
for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
  const src = path.join(dataDir, f);
  if (fs.existsSync(src)) fs.renameSync(src, path.join(backupDir, `${f}.${stamp}`));
}
fs.renameSync(tmpLocal, path.join(dataDir, 'app.db'));

const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(path.join(dataDir, 'app.db'), { readOnly: true });
const count = (sql) => db.prepare(sql).get().n;
console.log(`✔ Xong: ${count('SELECT COUNT(*) n FROM pages')} page, ${count('SELECT COUNT(*) n FROM jobs')} lịch, ${count('SELECT COUNT(*) n FROM reels')} reel`);
console.log(`  Database cũ cất ở ${backupDir}`);
db.close();
