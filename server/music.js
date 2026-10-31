import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db } from './db.js';

// --- Picking music and hooks for new jobs ---

// Music files are named "<code>_<title>.mp3"; old videos carry the code as the 3rd part of
// their name ("<group>_<index>_<code>.mp4"). Same rules as the web's musicCode / musicKey.
const musicCode = (fileName) => fileName.replace(/\.[^.]+$/, '').split('_')[0].trim();
const musicKey = (code) => code.toLowerCase().replace(/^([^\d]*)0+(?=\d)/, '$1');
const codeInVideoName = (name) => (name || '').replace(/\.[^.]+$/, '').split('_').map((s) => s.trim())[2] || null;

// A page doesn't get the same music (or hook) again within its last N posts.
const RECENT_PER_PAGE = 3;

export const MUSIC_PICKS = ['one', 'random', 'sequence', 'least_used', 'top_views'];

// Last use, reel count and views per file, plus each page's latest files (newest first).
// `fileOf(job)` says which of `files` a job used.
function history(files, fileOf) {
  const ids = new Set(files.map((f) => f.id));
  const usage = new Map();
  const recent = new Map();
  const rows = db.prepare(`
    SELECT j.page_id, j.drive_file_name, j.music_file_id, j.hook_file_id, j.scheduled_at, r.views
    FROM jobs j LEFT JOIN reels r ON r.job_id = j.id
    WHERE j.status != 'canceled'
    ORDER BY j.scheduled_at DESC
  `).all();
  for (const j of rows) {
    const id = fileOf(j);
    if (!ids.has(id)) continue;
    const u = usage.get(id) || { lastAt: 0, reels: 0, views: 0 };
    u.lastAt = Math.max(u.lastAt, j.scheduled_at);
    if (j.views != null) { u.reels++; u.views += j.views; }
    usage.set(id, u);
    const list = recent.get(j.page_id) || [];
    if (list.length < RECENT_PER_PAGE) recent.set(j.page_id, [...list, id]);
  }
  return { usage, recent };
}

const randomOf = (list) => list[Math.floor(Math.random() * list.length)];

// Sets entry[field] for each planned post ({ page, at }), in posting order.
// pick: 'random' | 'sequence' (by name, round robin) | 'least_used' (longest unused first)
//     | 'top_views' (weighted by views per reel).
function pickFiles(plan, pool, pick, field, { usage, recent }) {
  let cursor = 0;
  for (const entry of [...plan].sort((a, b) => a.at - b.at)) {
    const pageRecent = recent.get(entry.page.id) || [];
    const fresh = pool.filter((f) => !pageRecent.includes(f.id));
    const candidates = fresh.length ? fresh : pool;
    let file;
    if (pick === 'sequence') {
      for (let i = 0; i < pool.length && !file; i++) {
        const f = pool[(cursor + i) % pool.length];
        if (candidates.includes(f)) { file = f; cursor = (cursor + i + 1) % pool.length; }
      }
    } else if (pick === 'least_used') {
      const oldest = Math.min(...candidates.map((f) => usage.get(f.id)?.lastAt || 0));
      file = randomOf(candidates.filter((f) => (usage.get(f.id)?.lastAt || 0) === oldest));
    } else if (pick === 'top_views') {
      const weight = (f) => {
        const u = usage.get(f.id);
        return 1 + (u?.reels ? u.views / u.reels : 0);
      };
      let r = Math.random() * candidates.reduce((s, f) => s + weight(f), 0);
      file = candidates.find((f) => (r -= weight(f)) < 0) || candidates.at(-1);
    } else {
      file = randomOf(candidates);
    }
    entry[field] = file;
    recent.set(entry.page.id, [file.id, ...pageRecent].slice(0, RECENT_PER_PAGE));
    const u = usage.get(file.id) || { lastAt: 0, reels: 0, views: 0 };
    usage.set(file.id, { ...u, lastAt: Math.max(u.lastAt, entry.at) });
  }
}

// pick 'one' gives fileId to every post; the others see pickFiles.
// Jobs from before music was picked separately count through the code in their video's name.
export function assignMusic(plan, files, { pick, fileId }) {
  if (pick === 'one') {
    const file = files.find((f) => f.id === fileId);
    if (!file) throw new Error('Không tìm thấy bài nhạc đã chọn, hãy tải lại thư mục nhạc');
    for (const entry of plan) entry.music = file;
    return;
  }
  if (!files.length) throw new Error('Không có bài nhạc nào để chọn');
  const pool = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const byCode = new Map(pool.map((f) => [musicKey(musicCode(f.name)), f.id]));
  const fileOf = (j) => {
    const code = codeInVideoName(j.drive_file_name);
    return j.music_file_id || (code && byCode.get(musicKey(code)));
  };
  pickFiles(plan, pool, pick, 'music', history(pool, fileOf));
}

// A random hook per post, avoiding the page's last few hooks.
export function assignHooks(plan, files) {
  if (!files.length) throw new Error('Không có hook nào để ghép (thư mục trống hoặc đã tắt hết)');
  pickFiles(plan, files, 'random', 'hook', history(files, (j) => j.hook_file_id));
}

// --- Building the video that gets uploaded ---

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const FADE_OUT_SEC = 1.5;
// Every audio part is brought to this format so the parts can be joined.
const AUDIO_FMT = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', (e) => reject(e.code === 'ENOENT'
      ? new Error(`Chưa cài ${cmd} trên máy chủ (cần để ghép nhạc / hook vào video)`)
      : e));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} lỗi: ${err.trim().split('\n').slice(-3).join(' | ')}`))));
  });
}

// Duration, whether there is sound, and the picture's size as shown (rotation applied) and frame rate.
async function probe(file) {
  const out = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,pix_fmt,sample_aspect_ratio,width,height,r_frame_rate,duration:stream_tags=rotate:stream_side_data=rotation:stream_disposition=attached_pic',
    '-of', 'json', file,
  ]);
  const info = JSON.parse(out);
  // Cover art in an mp3 is a video stream too, flagged attached_pic; it isn't a picture to show.
  const v = (info.streams || []).find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic) || {};
  const rotation = Number(v.tags?.rotate || v.side_data_list?.find((d) => d.rotation != null)?.rotation || 0);
  const turned = Math.abs(rotation) % 180 === 90;
  return {
    duration: Number(v.duration) || Number(info.format?.duration) || 0,
    hasAudio: (info.streams || []).some((s) => s.codec_type === 'audio'),
    hasVideo: !!v.codec_type,
    width: turned ? v.height : v.width,
    height: turned ? v.width : v.height,
    fps: v.r_frame_rate && v.r_frame_rate !== '0/0' ? v.r_frame_rate : '30',
    // A plain H.264 picture (no rotation, square pixels) can be copied after a hook encoded to match it.
    joinable: v.codec_name === 'h264' && v.pix_fmt === 'yuv420p' && !rotation
      && ['1:1', '0:1', undefined].includes(v.sample_aspect_ratio),
  };
}

// Re-encodes use every CPU core, so they run one at a time: running several at once only slows each down.
let encoding = Promise.resolve();
function oneAtATime(fn) {
  const p = encoding.then(fn, fn);
  encoding = p.catch(() => {});
  return p;
}

const silence = (sec) => `anullsrc=r=44100:cl=stereo,atrim=duration=${sec.toFixed(3)}`;
// The hook's sound (or silence), labelled [ha], exactly `sec` long.
const hookAudio = (h, hookIn, sec) => (h.hasAudio
  ? `[${hookIn}:a]${AUDIO_FMT},apad,atrim=duration=${sec.toFixed(3)}[ha]`
  : `${silence(sec)}[ha]`);

// Fast way to put a hook first: only the hook's few seconds of picture are encoded, matching the
// video, and the video's own picture is copied after them. Both parts are joined as MPEG-TS, which
// carries each part's H.264 settings with it.
async function joinHook({ video, main, hook, h, hookVisual, inputs, filters, hookIn, out }) {
  const { width: W, height: H } = main;
  const fps = main.fps.split('/').map(Number).reduce((a, b) => a / b);
  const frames = Math.max(1, Math.round(h.duration * fps));
  const sec = frames / fps;
  const hold = `tpad=stop_mode=clone:stop_duration=${(h.duration + 1).toFixed(3)}`;
  const picture = hookVisual === 'tail' || !h.hasVideo
    ? ['-sseof', `-${Math.min(h.duration, main.duration).toFixed(3)}`, '-i', video,
      '-vf', `fps=${main.fps},${hold},format=yuv420p`]
    : ['-i', hook,
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${main.fps},${hold},format=yuv420p`];
  const intro = `${out}.intro.ts`;
  const body = `${out}.body.ts`;
  const list = `${out}.list.txt`;
  const tmp = `${out}.part.mp4`;
  const quote = (f) => `'${path.basename(f).replace(/'/g, "'\\''")}'`;
  try {
    await oneAtATime(() => run(FFMPEG, [
      '-y', '-v', 'error', ...picture, '-an', '-frames:v', String(frames),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-f', 'mpegts', intro,
    ]));
    await run(FFMPEG, ['-y', '-v', 'error', '-i', video, '-map', '0:v:0', '-c', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'mpegts', body]);
    fs.writeFileSync(list, `file ${quote(intro)}\nduration ${sec.toFixed(6)}\nfile ${quote(body)}\n`);
    const joinedIn = inputs.filter((a) => a === '-i').length;
    await run(FFMPEG, [
      '-y', '-v', 'error',
      ...inputs, '-f', 'concat', '-safe', '0', '-i', list,
      '-filter_complex', [...filters, hookAudio(h, hookIn, sec), '[ha][ma]concat=n=2:v=0:a=1[a]'].join(';'),
      '-map', `${joinedIn}:v:0`, '-map', '[a]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      tmp,
    ]);
    fs.renameSync(tmp, out);
  } finally {
    for (const f of [intro, body, list, tmp]) fs.rmSync(f, { force: true });
  }
  return { path: out, size: fs.statSync(out).size };
}

// Writes `out` from the video plus, optionally:
// - music (mode 'replace' = music only, 'mix' = original sound kept at origVolume %): looped or cut to
//   the video's length, fading out at its end;
// - a hook played before the video with its own sound (the music never covers the hook). Its picture is
//   the hook's own (hookVisual 'own') or, with 'tail' or when the hook is sound only, the last seconds
//   of the video itself, as long as the hook: e.g. the finished drawing under "hướng dẫn vẽ tranh cho bé…".
// Without a hook the picture is copied as is; with one only the hook part is encoded when the video
// allows it (joinHook), else the whole picture is re-encoded to the video's size and frame rate.
export async function buildVideo({ video, music, hook, hookVisual = 'own', out, mode, origVolume = 30 }) {
  const main = await probe(video);
  if (!main.duration) throw new Error('Không đọc được thời lượng video');
  const D = main.duration.toFixed(3);
  const inputs = ['-i', video];
  let next = 1;
  let musicIn;
  let hookIn;
  if (music) { inputs.push('-stream_loop', '-1', '-i', music); musicIn = next++; }
  if (hook) { inputs.push('-i', hook); hookIn = next++; }

  // The main part's sound, labelled [ma], exactly as long as the video.
  const fade = `afade=t=out:st=${Math.max(0, main.duration - FADE_OUT_SEC).toFixed(2)}:d=${FADE_OUT_SEC}`;
  const orig = `[0:a]${AUDIO_FMT},apad,atrim=duration=${D}`;
  let filters;
  if (!music) filters = [main.hasAudio ? `${orig}[ma]` : `${silence(main.duration)}[ma]`];
  else if (mode === 'mix' && main.hasAudio) {
    filters = [
      `${orig},volume=${origVolume / 100}[o]`,
      `[${musicIn}:a]${AUDIO_FMT},atrim=duration=${D}[m]`,
      `[m][o]amix=inputs=2:duration=first:normalize=0,${fade}[ma]`,
    ];
  } else filters = [`[${musicIn}:a]${AUDIO_FMT},atrim=duration=${D},${fade}[ma]`];

  let maps;
  let videoCodec;
  if (hook) {
    const h = await probe(hook);
    if (!h.duration) throw new Error('Không đọc được thời lượng hook');
    if (main.joinable && !process.env.HOOK_FULL_ENCODE) {
      try {
        return await joinHook({ video, main, hook, h, hookVisual, inputs, filters, hookIn, out });
      } catch (e) {
        console.warn(`[music] nối nhanh hook không được, mã hoá lại cả video: ${e.message}`);
      }
    }
    const { width: W, height: H, fps } = main;
    const same = `setsar=1,fps=${fps},format=yuv420p`;
    if (hookVisual === 'tail' || !h.hasVideo) {
      // The video's ending, played first; a hook longer than the video holds the last frame.
      const len = Math.min(h.duration, main.duration);
      filters.push(
        '[0:v]split=2[tail][body]',
        `[tail]trim=start=${(main.duration - len).toFixed(3)},setpts=PTS-STARTPTS,${same},tpad=stop_mode=clone:stop_duration=${(h.duration - len).toFixed(3)}[hv]`,
        `[body]${same}[mv]`,
      );
    } else {
      filters.push(
        `[${hookIn}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,${same}[hv]`,
        `[0:v]${same}[mv]`,
      );
    }
    filters.push(
      hookAudio(h, hookIn, h.duration),
      '[hv][ha][mv][ma]concat=n=2:v=1:a=1[v][a]',
    );
    maps = ['-map', '[v]', '-map', '[a]'];
    videoCodec = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
  } else {
    maps = ['-map', '0:v:0', '-map', '[ma]'];
    videoCodec = ['-c:v', 'copy'];
  }

  const tmp = `${out}.part.mp4`;
  try {
    await (hook ? oneAtATime : (fn) => fn())(() => run(FFMPEG, [
      '-y', '-v', 'error',
      ...inputs,
      '-filter_complex', filters.join(';'),
      ...maps,
      ...videoCodec, '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      tmp,
    ]));
    fs.renameSync(tmp, out);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return { path: out, size: fs.statSync(out).size };
}

export const mergedPath = (dir, jobId) => path.join(dir, `job-${jobId}.mp4`);
