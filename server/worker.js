import { db, getSetting } from './db.js';
import * as fb from './fb.js';
import fs from 'node:fs';
import { CACHE_DIR, ensureLocal, releaseLocal } from './drive.js';
import { buildVideo, mergedPath } from './music.js';

const TICK_MS = 15_000;
const MAX_ATTEMPTS = 3;
const PROCESSING_TIMEOUT_MS = 2 * 60 * 60 * 1000;
// Jobs with a hook start this much earlier: the whole video is re-encoded, which can take minutes on a small VPS.
const HOOK_LEAD_MS = 30 * 60_000;

const busy = new Set();
let activeUploads = 0;

const JOB_QUERY = `
  SELECT j.*, p.access_token, p.name AS page_name, p.enabled AS page_enabled
  FROM jobs j JOIN pages p ON p.id = j.page_id`;

function setJob(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => fields[k] ?? null), Date.now(), id);
}

function fail(job, err, retryStatus) {
  const attempts = job.attempts + 1;
  const error = String(err?.message || err).slice(0, 1000);
  console.error(`[worker] job ${job.id} (${job.page_name}) lỗi lần ${attempts}: ${error}`);
  if (attempts < MAX_ATTEMPTS) {
    setJob(job.id, { status: retryStatus, attempts, error, next_try_at: Date.now() + attempts * 2 * 60_000 });
  } else {
    setJob(job.id, { status: 'failed', attempts, error, next_try_at: null });
  }
}

async function uploadJob(job) {
  // Music and / or a hook go into a new file built for this job.
  const merged = job.music_file_id || job.hook_file_id ? mergedPath(CACHE_DIR, job.id) : null;
  try {
    let file = await ensureLocal(job.drive_file_id);
    if (merged) {
      const music = job.music_file_id && await ensureLocal(job.music_file_id);
      const hook = job.hook_file_id && await ensureLocal(job.hook_file_id);
      file = await buildVideo({
        video: file.path, music: music?.path, hook: hook?.path, hookVisual: job.hook_visual || 'own', out: merged, mode: job.audio_mode, origVolume: job.orig_volume ?? 30,
      });
    }
    const { video_id, upload_url } = await fb.startReelUpload(job.page_id, job.access_token);
    const url = upload_url || `https://rupload.facebook.com/video-upload/${getSetting('graph_version')}/${video_id}`;
    setJob(job.id, { video_id, upload_url: url });
    await fb.uploadReelBinary(url, job.access_token, file.path, file.size);
    setJob(job.id, { status: 'uploaded', error: null, next_try_at: null });
  } catch (e) {
    fail(job, e, 'pending');
  } finally {
    activeUploads--;
    busy.delete(job.id);
    releaseLocal(job.drive_file_id);
    if (merged) {
      if (job.music_file_id) releaseLocal(job.music_file_id);
      if (job.hook_file_id) releaseLocal(job.hook_file_id);
      fs.rmSync(merged, { force: true });
    }
  }
}

async function publishJob(job) {
  try {
    await fb.finishReel(job.page_id, job.access_token, job.video_id, job.caption);
    setJob(job.id, { status: 'processing', published_at: Date.now(), error: null, next_try_at: Date.now() + 30_000 });
  } catch (e) {
    fail(job, e, 'uploaded');
  } finally {
    busy.delete(job.id);
  }
}

async function checkProcessing(job) {
  try {
    const { status, permalink_url } = await fb.getVideoStatus(job.video_id, job.access_token);
    const phases = [status?.uploading_phase, status?.processing_phase, status?.publishing_phase];
    const errPhase = phases.find((p) => p?.status === 'error');

    if (status?.video_status === 'error' || errPhase) {
      const error = (errPhase?.errors || []).map((e) => e.message).join('; ') || 'Facebook báo lỗi xử lý video';
      setJob(job.id, { status: 'failed', error, next_try_at: null });
    } else if (status?.publishing_phase?.status === 'complete') {
      setJob(job.id, { status: 'done', error: null, next_try_at: null });
      db.prepare(`
        INSERT INTO reels (video_id, page_id, job_id, caption, permalink, published_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(video_id) DO UPDATE SET job_id = excluded.job_id, permalink = excluded.permalink
      `).run(job.video_id, job.page_id, job.id, job.caption, fb.normalizePermalink(permalink_url, job.video_id), job.published_at);
    } else if (Date.now() - job.published_at > PROCESSING_TIMEOUT_MS) {
      setJob(job.id, { status: 'failed', error: 'Quá 2 giờ Facebook vẫn chưa xử lý xong video', next_try_at: null });
    }
  } catch (e) {
    console.error(`[worker] kiểm tra job ${job.id}: ${e.message}`);
  } finally {
    busy.delete(job.id);
  }
}

function ready(where, ...args) {
  const now = Date.now();
  return db.prepare(`${JOB_QUERY} WHERE ${where} AND (j.next_try_at IS NULL OR j.next_try_at <= ?) ORDER BY j.scheduled_at LIMIT 100`)
    .all(...args, now)
    .filter((j) => !busy.has(j.id));
}

function tick() {
  const now = Date.now();
  const preUploadMs = Number(getSetting('preupload_minutes')) * 60_000;
  const slots = Number(getSetting('upload_concurrency')) - activeUploads;

  // Upload a few minutes early so the reel goes live exactly at scheduled_at.
  if (slots > 0) {
    const due = `j.scheduled_at - CASE WHEN j.hook_file_id IS NULL THEN 0 ELSE ${HOOK_LEAD_MS} END <= ?`;
    for (const job of ready(`j.status = 'pending' AND p.enabled = 1 AND ${due}`, now + preUploadMs).slice(0, slots)) {
      busy.add(job.id);
      activeUploads++;
      setJob(job.id, { status: 'uploading' });
      uploadJob(job);
    }
  }

  for (const job of ready(`j.status = 'uploaded' AND j.scheduled_at <= ?`, now)) {
    busy.add(job.id);
    setJob(job.id, { status: 'publishing' });
    publishJob(job);
  }

  for (const job of ready(`j.status = 'processing'`)) {
    busy.add(job.id);
    setJob(job.id, { next_try_at: now + 30_000 });
    checkProcessing(job);
  }
}

export function startWorker() {
  // Work that was in flight when the app stopped is restarted from the last safe step.
  db.exec(`
    UPDATE jobs SET status = 'pending', video_id = NULL, upload_url = NULL WHERE status = 'uploading';
    UPDATE jobs SET status = 'uploaded' WHERE status = 'publishing';
  `);
  const run = () => {
    try { tick(); } catch (e) { console.error('[worker]', e); }
  };
  run();
  setInterval(run, TICK_MS);
}
