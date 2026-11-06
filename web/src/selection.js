// Picked table cells, kept outside React state so a click re-renders only the cells it changes,
// not the whole table. Each cell is an object with a unique `key`.
export function createSelection() {
  let items = new Map();
  let version = 0;
  const cellListeners = new Map(); // key -> Set(fn)
  const allListeners = new Set();
  const notify = (keys) => {
    version++;
    for (const k of keys) for (const fn of cellListeners.get(k) || []) fn();
    for (const fn of allListeners) fn();
  };
  return {
    has: (key) => items.has(key),
    items: () => [...items.values()],
    version: () => version,
    // Toggles the given cells together: all on if any is off, else all off.
    toggle(cells) {
      const keys = cells.map((c) => c.key);
      const allOn = keys.every((k) => items.has(k));
      items = new Map(items);
      for (const c of cells) {
        if (allOn) items.delete(c.key);
        else items.set(c.key, c);
      }
      notify(keys);
    },
    clear() {
      const keys = [...items.keys()];
      items = new Map();
      notify(keys);
    },
    subscribeCell(key, fn) {
      if (!cellListeners.has(key)) cellListeners.set(key, new Set());
      cellListeners.get(key).add(fn);
      return () => cellListeners.get(key).delete(fn);
    },
    subscribeAll(fn) {
      allListeners.add(fn);
      return () => allListeners.delete(fn);
    },
  };
}
