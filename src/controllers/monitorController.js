import { dbState, isDbConnected } from '../config/db.js';
import { env } from '../config/env.js';
import {
  getDemoActivity, getEndpoints, getErrorGroups, getIncidents, getPerformance, getSummary,
} from '../services/demoData.js';
import { metricsStore } from '../services/metricsStore.js';
import { ok } from '../utils/response.js';

const SIMULATED = { simulated: true, label: 'Demo environment' };

const databaseService = () => {
  const connected = isDbConnected();
  const detail = {
    connected: 'MongoDB connection is healthy',
    connecting: 'Connecting to MongoDB',
    not_configured: 'MONGODB_URI is not set',
    disconnected: dbState.lastError || 'MongoDB is unreachable',
  }[dbState.status] ?? 'Unknown state';
  return { id: 'database', name: 'Database', status: connected ? 'operational' : dbState.status === 'disconnected' ? 'offline' : 'degraded', detail, simulated: false };
};

const authService = () => ({
  id: 'auth',
  name: 'Authentication',
  status: env.authConfigured ? 'operational' : 'degraded',
  detail: env.authConfigured ? 'JWT signing key configured (HS256)' : 'JWT_SECRET is missing or too short',
  simulated: false,
});

function buildServices() {
  const live = metricsStore.snapshot();
  const now = new Date().toISOString();
  return [
    {
      id: 'api', name: 'API Server', status: 'operational',
      detail: `Node ${process.version}, up ${Math.floor(live.uptimeSec / 60)} min`,
      latencyMs: live.avgMs, simulated: false,
    },
    databaseService(),
    authService(),
    { id: 'storage', name: 'Storage', status: 'operational', detail: 'Object storage reachable', latencyMs: 38, simulated: true },
    { id: 'external', name: 'External Services', status: 'degraded', detail: 'Email provider responding slowly', latencyMs: 912, simulated: true },
  ].map((s) => ({ latencyMs: null, ...s, checkedAt: now }));
}

const overall = (services) =>
  services.some((s) => s.status === 'offline') ? 'outage' : services.some((s) => s.status === 'degraded') ? 'degraded' : 'operational';

export function summary(req, res) {
  const data = getSummary(req.range);
  const live = metricsStore.snapshot();
  const { kpis } = data;
  const apiHealth = kpis.errorRate < 2 && kpis.avg < 400 ? 'healthy' : kpis.errorRate < 5 ? 'degraded' : 'unhealthy';
  return ok(res, {
    ...data,
    health: {
      api: apiHealth,
      database: isDbConnected() ? 'connected' : dbState.status,
      auth: env.authConfigured ? 'operational' : 'not_configured',
    },
    live,
  }, { ...SIMULATED, liveFields: ['health.database', 'health.auth', 'live'] });
}

export const endpoints = (req, res) => ok(res, getEndpoints(req.range), SIMULATED);
export const performance = (req, res) => ok(res, getPerformance(req.range), SIMULATED);
export const errors = (_req, res) => ok(res, getErrorGroups(), { ...SIMULATED, window: '24h' });

export function activity(_req, res) {
  const events = [...metricsStore.recent(25).map((e) => ({ ...e, source: 'live' })), ...getDemoActivity(40)]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 50);
  return ok(res, events, { ...SIMULATED, note: 'Entries tagged "live" are real requests to this server.' });
}

export function system(_req, res) {
  const services = buildServices();
  return ok(res, { overall: overall(services), services, incidents: getIncidents() }, { simulated: true, label: 'Storage, external services and incidents are simulated' });
}

export function notifications(_req, res) {
  const items = [];
  buildServices()
    .filter((s) => s.status !== 'operational')
    .forEach((s) => items.push({
      id: `svc-${s.id}`, level: s.status === 'offline' ? 'error' : 'warning',
      title: `${s.name} is ${s.status}`, body: s.detail, link: '/system', time: s.checkedAt,
    }));
  getErrorGroups()
    .filter((g) => g.status >= 500)
    .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
    .slice(0, 2)
    .forEach((g) => items.push({
      id: g.id, level: 'error', title: `${g.status} on ${g.method} ${g.path}`,
      body: `${g.count} occurrences in 24h: ${g.message}`, link: '/errors', time: g.lastSeen,
    }));
  items.push({
    id: 'demo', level: 'info', title: 'You are viewing a demo environment',
    body: 'Traffic metrics are simulated. Database, auth and API health are measured live.', link: '/settings', time: new Date().toISOString(),
  });
  return ok(res, items, SIMULATED);
}
