import { useCallback, useEffect, useState } from 'react';

async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || res.statusText);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  put: (url, body) => request('PUT', url, body ?? {}),
  patch: (url, body) => request('PATCH', url, body ?? {}),
  del: (url) => request('DELETE', url),
};

export function useApi(url, { refreshMs } = {}) {
  const [data, setData] = useState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async ({ silent } = {}) => {
    if (!url) return;
    if (!silent) setLoading(true);
    try {
      setData(await api.get(url));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!refreshMs) return undefined;
    const t = setInterval(() => reload({ silent: true }), refreshMs);
    return () => clearInterval(t);
  }, [reload, refreshMs]);

  return { data, loading, error, reload };
}

const GROUP_COLORS = ['magenta', 'volcano', 'orange', 'gold', 'green', 'cyan', 'blue', 'geekblue', 'purple', 'lime'];

// Same group name always gets the same tag color.
export function groupColor(name) {
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

export const fmtNum =(n) => (n == null ? '-' : Number(n).toLocaleString('vi-VN'));
export const fmtSize = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(1)} MB`);
export const fmtSec = (ms) => (ms ? `${(ms / 1000).toFixed(1)}s` : '-');

// Video files are named "<group>_<number>_<music code>...", e.g. "comnha_015_N23.mp4".
export function parseVideoName(name) {
  const parts = (name || '').replace(/\.[^.]+$/, '').split('_').map((s) => s.trim());
  return {
    group: parts[0] || null,
    index: parts.length > 1 ? parts[1] : null,
    music: parts.length > 2 && parts[2] ? parts[2] : null,
  };
}

// Music files are named "<code>_<title>.mp3", e.g. "C1_Chỉ có đàn tỳ bà....mp3" → "C1".
export const musicCode = (fileName) => fileName.replace(/\.[^.]+$/, '').split('_')[0].trim();

export function musicFileFor(code, files) {
  const c = code.toLowerCase();
  return files.find((f) => musicCode(f.name).toLowerCase() === c);
}
