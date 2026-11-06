// Hand-off from another screen to the schedule form: the page(s) and video(s) to start with,
// and optionally the exact [{ pageId, videoId }] pairs to schedule, or the [{ pageId, day }]
// calendar cells to post in.
// Kept in memory only; the schedule page takes it once when it opens.
let pending = null;

export function openScheduleWith({ pageIds, videos = [], pairs, cells }) {
  pending = { pageIds, videos, pairs, cells };
  window.location.hash = 'schedule';
}

export function takeSchedulePrefill() {
  const p = pending;
  pending = null;
  return p;
}
