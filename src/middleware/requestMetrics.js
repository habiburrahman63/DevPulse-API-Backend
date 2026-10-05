import { metricsStore } from '../services/metricsStore.js';

// Records real request timings for this server. Monitoring polls are excluded so they do not drown real traffic.
export function requestMetrics(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const url = req.originalUrl.split('?')[0];
    if (!url.startsWith('/api') || url.startsWith('/api/monitor')) return;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const route = req.route ? `${req.baseUrl}${req.route.path}` : url;
    metricsStore.record({ method: req.method, path: route, status: res.statusCode, ms });
  });
  next();
}
