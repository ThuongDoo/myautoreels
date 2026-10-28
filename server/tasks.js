// Background bulk operations (assign pages, change avatars...) that the UI polls for progress.

export class Canceled extends Error {}
// Stops the whole task (as opposed to failing a single item).
export class Fatal extends Error {}

// Wait times (minutes) after Facebook's anti-spam block (code 368); gives up after the last one.
const RATE_LIMIT_BACKOFF_MIN = [5, 10, 20, 30, 30, 60];
export const isRateLimited = (e) => e.details?.code === 368 || e.details?.error_subcode === 1390008;

export function createTask(extra = {}) {
  return {
    running: true, phase: 'Bắt đầu', startedAt: Date.now(), updatedAt: Date.now(), finishedAt: null,
    todo: 0, done: 0, current: null, failed: [], log: [], error: null, waitUntil: null, cancel: false,
    ...extra,
  };
}

export function runTask(task, body, { canceledText }) {
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

  // Runs fn; when Facebook blocks for going too fast, waits with growing backoff and retries the same item.
  let blocks = 0;
  const retryOnBlock = async (label, fn) => {
    for (;;) {
      if (task.cancel) throw new Canceled();
      try {
        const result = await fn();
        blocks = 0;
        return result;
      } catch (e) {
        if (!isRateLimited(e)) throw e;
        if (blocks >= RATE_LIMIT_BACKOFF_MIN.length) {
          throw new Fatal('Facebook chặn quá nhiều lần liên tiếp. Hãy đợi vài giờ (tốt nhất là ngày mai) rồi chạy lại.');
        }
        const minutes = RATE_LIMIT_BACKOFF_MIN[blocks++];
        const phase = task.phase;
        task.waitUntil = Date.now() + minutes * 60_000;
        task.phase = 'Facebook tạm chặn, đang chờ';
        log(`⏸ Facebook tạm chặn vì thao tác nhanh (368). Chờ ${minutes} phút rồi thử lại "${label}"`, 'warning');
        await sleep(minutes * 60_000);
        task.waitUntil = null;
        task.phase = phase;
      }
    }
  };

  // Records a per-item failure, but lets cancel / fatal errors stop the whole task.
  const failItem = (item, e) => {
    if (e instanceof Canceled || e instanceof Fatal) throw e;
    task.failed.push({ ...item, error: e.message });
    log(`✗ ${item.name}: ${e.message}`, 'error');
  };

  (async () => {
    try {
      await body({ log, sleep, retryOnBlock, failItem });
      task.phase = 'Hoàn tất';
    } catch (e) {
      if (e instanceof Canceled) {
        task.phase = 'Đã dừng';
        log(canceledText, 'warning');
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
  })();
  return task;
}
