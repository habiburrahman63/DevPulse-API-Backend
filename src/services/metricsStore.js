const MAX_ENTRIES = 500;
const entries = [];
let seq = 0;
let total = 0;
let errors = 0;

export const metricsStore = {
  record({ method, path, status, ms }) {
    entries.push({ id: `live-${++seq}`, ts: Date.now(), method, path, status, ms: Math.round(ms * 10) / 10 });
    if (entries.length > MAX_ENTRIES) entries.shift();
    total += 1;
    if (status >= 400) errors += 1;
  },
  recent(limit = 20) {
    return entries.slice(-limit).reverse();
  },
  snapshot() {
    const window = entries.slice(-100);
    const avg = window.length ? window.reduce((sum, e) => sum + e.ms, 0) / window.length : null;
    return {
      requests: total,
      errors,
      avgMs: avg === null ? null : Math.round(avg * 10) / 10,
      uptimeSec: Math.round(process.uptime()),
    };
  },
};
