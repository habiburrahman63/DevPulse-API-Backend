/**
 * Simulated monitoring data for the DevPulse demo environment.
 *
 * Everything here is generated, never measured. Values are deterministic per
 * time bucket (seeded PRNG), so charts stay stable between polls while the
 * live activity feed still appears to move forward in real time.
 */

const RANGES = {
  '1h': { minutes: 60, points: 60 },
  '6h': { minutes: 360, points: 72 },
  '24h': { minutes: 1440, points: 96 },
  '7d': { minutes: 10080, points: 84 },
  '30d': { minutes: 43200, points: 90 },
};
export const RANGE_KEYS = Object.keys(RANGES);
export const isValidRange = (r) => Object.hasOwn(RANGES, r);

// ---------- seeded randomness ----------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

// ---------- endpoint catalog ----------
const SCALE = 1.37;
const CATALOG = [
  { method: 'GET', path: '/api/categories', base: 82, rpm: 4.1, err: 0.002, success: 200, errors: [500] },
  { method: 'GET', path: '/api/products', base: 96, rpm: 6.9, err: 0.004, success: 200, errors: [404, 500] },
  { method: 'GET', path: '/api/users', base: 112, rpm: 3.3, err: 0.008, success: 200, errors: [401, 500] },
  { method: 'GET', path: '/api/users/:id', base: 104, rpm: 2.4, err: 0.008, success: 200, errors: [404, 401] },
  { method: 'GET', path: '/api/orders', base: 204, rpm: 2.0, err: 0.006, success: 200, errors: [401, 403] },
  { method: 'GET', path: '/api/analytics', base: 431, rpm: 0.8, err: 0.02, success: 200, errors: [500, 403] },
  { method: 'GET', path: '/api/health', base: 18, rpm: 1.5, err: 0, success: 200, errors: [] },
  { method: 'POST', path: '/api/auth/login', base: 183, rpm: 3.8, err: 0.03, success: 200, errors: [401, 400] },
  { method: 'POST', path: '/api/auth/register', base: 241, rpm: 1.1, err: 0.03, success: 201, errors: [400, 409] },
  { method: 'POST', path: '/api/products', base: 276, rpm: 0.7, err: 0.09, success: 201, errors: [500, 400] },
  { method: 'POST', path: '/api/orders', base: 482, rpm: 1.6, err: 0.02, success: 201, errors: [400, 500] },
  { method: 'POST', path: '/api/upload', base: 398, rpm: 0.6, err: 0.04, success: 201, errors: [400, 403] },
  { method: 'PUT', path: '/api/users/:id', base: 168, rpm: 0.9, err: 0.02, success: 200, errors: [404, 403] },
  { method: 'DELETE', path: '/api/products/:id', base: 134, rpm: 0.5, err: 0.015, success: 200, errors: [403, 404] },
].map((e) => ({ ...e, rpm: e.rpm * SCALE }));

const TOTAL_RPM = CATALOG.reduce((s, e) => s + e.rpm, 0);
const BASE_ERR = CATALOG.reduce((s, e) => s + e.rpm * e.err, 0) / TOTAL_RPM;
const BASE_LAT = CATALOG.reduce((s, e) => s + e.rpm * e.base, 0) / TOTAL_RPM;

// ---------- endpoints ----------
export function getEndpoints(range) {
  const { minutes } = RANGES[range];
  const now = Date.now();
  const slot = Math.floor(now / 15000);
  return CATALOG.map((e) => {
    const r = rng(hash(`${e.method}${e.path}${range}`));
    const live = rng(hash(`${e.method}${e.path}${slot}`));
    const requests = Math.round(e.rpm * minutes * (0.92 + r() * 0.16));
    const errors = Math.round(requests * e.err * (0.8 + r() * 0.4));
    const avg = e.base * (0.95 + r() * 0.1) * (0.97 + live() * 0.06);
    const failing = e.errors.length > 0 && live() < Math.min(0.5, e.err * 5);
    const status = failing ? e.errors[Math.floor(live() * e.errors.length)] : e.success;
    return {
      id: `${e.method}:${e.path}`,
      method: e.method,
      path: e.path,
      status,
      responseTime: round(avg, 0),
      p95: round(avg * (1.7 + r() * 0.5), 0),
      lastChecked: new Date(now - Math.floor(3 + live() * 40) * 1000).toISOString(),
      requests,
      errors,
      successRate: round(100 - (errors / requests) * 100, 2),
      success: status < 400,
    };
  });
}

// ---------- time series ----------
function buildSeries(range) {
  const { minutes, points } = RANGES[range];
  const stepMin = minutes / points;
  const stepMs = stepMin * 60000;
  const end = Math.floor(Date.now() / stepMs) * stepMs;
  return Array.from({ length: points }, (_, i) => {
    const t = end - (points - 1 - i) * stepMs;
    const r = rng(hash(`${range}:${t}`));
    const d = new Date(t);
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    const diurnal = 0.78 + 0.22 * Math.sin(((hour - 6) / 24) * Math.PI * 2);
    const load = diurnal * (0.9 + r() * 0.2);
    const requests = Math.max(1, Math.round(TOTAL_RPM * stepMin * load));
    const spike = r() > 0.96 ? 1.8 + r() : 1;
    const avg = BASE_LAT * (0.9 + r() * 0.2) * (1 + (load - 0.8) * 0.2) * spike;
    const errRate = BASE_ERR * (0.55 + r() * 0.9) * (r() > 0.97 ? 3 : 1);
    // Probabilistic rounding keeps small buckets from collapsing to zero errors.
    const expected = requests * errRate;
    const errors = Math.floor(expected) + (r() < expected % 1 ? 1 : 0);
    return {
      t,
      avg: round(avg),
      min: round(avg * (0.26 + r() * 0.1)),
      max: round(avg * (2.8 + r() * 1.8) * spike),
      p95: round(avg * (1.9 + r() * 0.4)),
      requests,
      errors,
      success: requests - errors,
      successRate: round(100 - (errors / requests) * 100, 2),
    };
  });
}

const STATUS_LABELS = {
  200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 500: 'Server Error',
};

function statusDistribution(total, errors) {
  const ok = total - errors;
  const split = [
    [200, ok * 0.91], [201, ok * 0.09],
    [401, errors * 0.3], [400, errors * 0.22], [404, errors * 0.18], [500, errors * 0.2], [403, errors * 0.1],
  ].map(([code, n]) => ({ code, label: STATUS_LABELS[code], count: Math.round(n) }));
  return split.map((s) => ({ ...s, percent: round((s.count / total) * 100, 2) }));
}

export function getPerformance(range) {
  const series = buildSeries(range);
  const { minutes } = RANGES[range];
  const total = series.reduce((s, p) => s + p.requests, 0);
  const errors = series.reduce((s, p) => s + p.errors, 0);
  const weighted = (key) => series.reduce((s, p) => s + p[key] * p.requests, 0) / total;
  const rpm = total / minutes;
  const endpoints = getEndpoints(range).map((e) => ({ method: e.method, path: e.path, avg: e.responseTime, requests: e.requests }));
  const sorted = [...endpoints].sort((a, b) => a.avg - b.avg);
  return {
    range,
    kpis: {
      avg: round(weighted('avg')),
      min: Math.min(...series.map((p) => p.min)),
      max: Math.max(...series.map((p) => p.max)),
      p95: round(weighted('p95')),
      rpm: round(rpm, 1),
      rps: round(rpm / 60, 2),
      total,
      errors,
      successRate: round(100 - (errors / total) * 100, 2),
      errorRate: round((errors / total) * 100, 2),
    },
    series,
    statusDistribution: statusDistribution(total, errors),
    ranking: { fastest: sorted.slice(0, 5), slowest: sorted.slice(-5).reverse() },
  };
}

export function getSummary(range) {
  const perf = getPerformance(range);
  const r = rng(hash(`delta:${range}`));
  const tail = (key, n = 24) => perf.series.slice(-n).map((p) => p[key]);
  return {
    range,
    kpis: perf.kpis,
    changes: {
      latency: round(-(6 + r() * 9), 1),
      requests: round(2 + r() * 9, 1),
      rpm: round(2 + r() * 9, 1),
      successRate: round(0.1 + r() * 0.4, 2),
      errorRate: round(-(4 + r() * 12), 1),
    },
    sparklines: {
      latency: tail('avg'),
      requests: tail('requests'),
      successRate: tail('successRate'),
      errorRate: perf.series.slice(-24).map((p) => round((p.errors / p.requests) * 100, 2)),
    },
    trace: tail('avg', 48),
    activeEndpoints: { active: CATALOG.length, total: CATALOG.length },
    uptime: { percent: 99.98, windowDays: 30 },
  };
}

// ---------- errors ----------
const ERROR_GROUPS = [
  { id: 'err_01', status: 500, method: 'POST', path: '/api/products', type: 'InternalServerError', message: "Cannot read properties of undefined (reading 'price')", count: 14, lastSeenSec: 212, cause: 'A required nested field is missing from the request body and is dereferenced without a guard.', fix: 'Validate the payload with a schema before it reaches the controller and return 422 for incomplete bodies.' },
  { id: 'err_02', status: 401, method: 'POST', path: '/api/auth/login', type: 'AuthenticationError', message: 'Invalid email or password', count: 63, lastSeenSec: 41, cause: 'Failed credential checks. Often normal, but a sudden rise can indicate credential stuffing.', fix: 'Keep the per-IP rate limit enabled and alert when the failure ratio exceeds its baseline.' },
  { id: 'err_03', status: 404, method: 'GET', path: '/api/users/:id', type: 'NotFoundError', message: 'User not found', count: 31, lastSeenSec: 540, cause: 'Clients request identifiers of users that were deleted or never existed.', fix: 'Check for stale links or cached ids in the client. The 404 itself is the correct response.' },
  { id: 'err_04', status: 500, method: 'GET', path: '/api/analytics', type: 'MongoServerError', message: 'Aggregation exceeded the memory limit of 100MB', count: 9, lastSeenSec: 1860, cause: 'A $group stage runs over an unbounded collection without an index-backed $match first.', fix: 'Add a $match on an indexed date field before $group, or enable allowDiskUse for this pipeline.' },
  { id: 'err_05', status: 400, method: 'POST', path: '/api/auth/register', type: 'ValidationError', message: 'email must be a valid email address', count: 22, lastSeenSec: 960, cause: 'Clients submit malformed email values.', fix: 'Add inline email validation in the form so the request is never sent with an invalid value.' },
  { id: 'err_06', status: 403, method: 'DELETE', path: '/api/products/:id', type: 'ForbiddenError', message: 'Admin role required', count: 11, lastSeenSec: 3300, cause: 'Non-admin accounts attempt a destructive action.', fix: 'Hide the control for non-admin roles. Keep the server-side role check as the real guard.' },
  { id: 'err_07', status: 500, method: 'POST', path: '/api/orders', type: 'MongoServerError', message: 'WriteConflict: transaction aborted, please retry', count: 6, lastSeenSec: 7200, cause: 'Two concurrent orders update the same stock document inside a transaction.', fix: 'Wrap the transaction in a bounded retry for TransientTransactionError labels.' },
  { id: 'err_08', status: 401, method: 'GET', path: '/api/orders', type: 'TokenExpiredError', message: 'jwt expired', count: 27, lastSeenSec: 380, cause: 'Sessions outlive the access token lifetime and the client does not refresh it.', fix: 'Redirect to sign-in on TOKEN_EXPIRED, or add a refresh-token flow.' },
  { id: 'err_09', status: 400, method: 'POST', path: '/api/upload', type: 'UnsupportedMediaType', message: 'File type not allowed', count: 8, lastSeenSec: 5400, cause: 'Uploads outside the allowed MIME list are rejected.', fix: 'Show the accepted file types in the upload control before the user selects a file.' },
  { id: 'err_10', status: 500, method: 'GET', path: '/api/users', type: 'TimeoutError', message: 'Request timed out after 5000ms', count: 3, lastSeenSec: 9800, cause: 'An unindexed regex search on the users collection blocks under load.', fix: 'Add a text or prefix index and paginate the listing.' },
];

export function getErrorGroups() {
  const now = Date.now();
  return ERROR_GROUPS.map((g) => {
    const r = rng(hash(g.id));
    const hourly = Array.from({ length: 12 }, () => Math.round((g.count / 12) * (0.2 + r() * 1.8)));
    const firstSeenSec = 86400 - Math.floor(r() * 3600);
    return {
      id: g.id,
      status: g.status,
      method: g.method,
      path: g.path,
      type: g.type,
      message: g.message,
      count: g.count,
      perHour: round(g.count / 24, 1),
      firstSeen: new Date(now - firstSeenSec * 1000).toISOString(),
      lastSeen: new Date(now - g.lastSeenSec * 1000).toISOString(),
      hourly,
      probableCause: g.cause,
      suggestedFix: g.fix,
      sampleRequestId: `req_${hash(g.id).toString(16).padStart(8, '0')}`,
    };
  });
}

// ---------- activity ----------
const SLOT_MS = 1500;
export function getDemoActivity(limit = 40) {
  const nowSlot = Math.floor(Date.now() / SLOT_MS);
  const events = [];
  for (let k = 0; k < 120 && events.length < limit; k += 1) {
    const slot = nowSlot - k;
    const r = rng(hash(`act:${slot}`));
    if (r() > 0.62) continue;
    let pick = r() * TOTAL_RPM;
    const ep = CATALOG.find((e) => (pick -= e.rpm) <= 0) ?? CATALOG[0];
    const failed = ep.errors.length > 0 && r() < ep.err * 4;
    const status = failed ? ep.errors[Math.floor(r() * ep.errors.length)] : ep.success;
    events.push({
      id: `demo-${slot}`,
      ts: slot * SLOT_MS + Math.floor(r() * SLOT_MS),
      method: ep.method,
      path: ep.path,
      status,
      ms: round(ep.base * (0.7 + r() * 0.9) * (status >= 500 ? 1.8 : 1)),
      source: 'demo',
    });
  }
  return events;
}

// ---------- database + system (demo variants) ----------
export function getDemoDatabase() {
  const names = ['users', 'posts', 'comments', 'likes', 'follows', 'messages', 'notifications', 'media', 'tags', 'sessions', 'reports', 'audit_logs'];
  const docs = [12840, 48210, 96350, 214800, 31020, 77430, 152900, 18420, 640, 5210, 380, 61700];
  return {
    status: 'connected',
    configured: true,
    name: 'social_space',
    latencyMs: 24,
    serverStatus: 'ok',
    version: '7.0.14',
    collections: names.length,
    documents: docs.reduce((a, b) => a + b, 0),
    indexes: 41,
    dataSizeBytes: 612 * 1024 * 1024,
    storageSizeBytes: 388 * 1024 * 1024,
    connectionUptimeSec: 3 * 86400 + 5 * 3600 + 1280,
    lastConnectedAt: new Date(Date.now() - (3 * 86400 + 5 * 3600 + 1280) * 1000).toISOString(),
    lastFailureAt: new Date(Date.now() - 9 * 86400).toISOString(),
    lastError: 'MongoNetworkError: connection 3 to cluster closed (simulated)',
    collectionList: names.map((name, i) => ({ name, documents: docs[i] })),
  };
}

export function getIncidents() {
  const now = Date.now();
  const h = 3600 * 1000;
  return [
    { id: 'inc_1', title: 'Elevated latency on email provider', status: 'monitoring', severity: 'degraded', startedAt: new Date(now - 2.5 * h).toISOString(), resolvedAt: null },
    { id: 'inc_2', title: 'Brief MongoDB failover', status: 'resolved', severity: 'degraded', startedAt: new Date(now - 9 * 24 * h).toISOString(), resolvedAt: new Date(now - 9 * 24 * h + 4 * 60000).toISOString() },
    { id: 'inc_3', title: 'Upload service returned 503s', status: 'resolved', severity: 'offline', startedAt: new Date(now - 16 * 24 * h).toISOString(), resolvedAt: new Date(now - 16 * 24 * h + 18 * 60000).toISOString() },
  ];
}
