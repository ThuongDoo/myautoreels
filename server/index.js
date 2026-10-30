import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

const ROOT = path.resolve(import.meta.dirname, '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

// Imported after .env is loaded because db.js reads DATA_DIR at import time.
const { registerRoutes } = await import('./routes.js');
const { startWorker } = await import('./worker.js');
const { startStatsScheduler } = await import('./stats.js');

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'warn' } });

const password = process.env.APP_PASSWORD;
if (password) {
  app.addHook('onRequest', async (req, reply) => {
    const [, encoded] = (req.headers.authorization || '').split(' ');
    const pass = encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : null;
    if (pass !== password) {
      reply.header('WWW-Authenticate', 'Basic realm="AutoReels"').code(401).send('Unauthorized');
      return reply;
    }
  });
}

const dist = path.join(ROOT, 'web', 'dist');
const hasDist = fs.existsSync(dist);
if (hasDist) await app.register(fastifyStatic, { root: dist });
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api') || !hasDist) return reply.code(404).send({ message: 'Not found' });
  return reply.sendFile('index.html');
});

registerRoutes(app);

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (!password && !['127.0.0.1', 'localhost'].includes(host)) {
  console.warn('⚠️  HOST đang mở ra ngoài mà chưa đặt APP_PASSWORD trong .env — ai cũng truy cập được!');
}
// Retry briefly: after a restore the old process may still be releasing the port.
for (let attempt = 1; ; attempt++) {
  try {
    await app.listen({ host, port });
    break;
  } catch (e) {
    if (e.code !== 'EADDRINUSE' || attempt >= 20) throw e;
    await new Promise((r) => setTimeout(r, 500));
  }
}
console.log(`AutoReels chạy tại http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);

// DISABLE_WORKER=1 (e.g. a local copy of the VPS data) never posts reels and skips the
// automatic stats refresh, so two machines don't publish twice.
if (process.env.DISABLE_WORKER === '1') {
  console.warn('⏸  DISABLE_WORKER=1: không đăng bài, không tự cập nhật số liệu');
} else {
  startWorker();
  startStatsScheduler();
}
