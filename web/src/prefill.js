// Hand-off from another screen to the schedule form: the page(s) and video(s) to start with.
// Kept in memory only; the schedule page takes it once when it opens.
let pending = null;

export function openScheduleWith({ pageIds, videos }) {
  pending = { pageIds, videos };
  window.location.hash = 'schedule';
}

export function takeSchedulePrefill() {
  const p = pending;
  pending = null;
  return p;
}
