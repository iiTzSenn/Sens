// localStorage that never throws: a private window or blocked storage reads
// the fallback and drops the write.

export function stored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (ignored) {
    return fallback;
  }
}

export function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (ignored) {}
}
