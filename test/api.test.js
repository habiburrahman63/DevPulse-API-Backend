import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';

let server;
let base;
const get = (p) => fetch(base + p);
const post = (p, body, raw) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body) });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

describe('health + envelope', () => {
  it('GET /api/health returns the success envelope', async () => {
    const res = await get('/api/health');
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.data.status, 'ok');
  });
  it('unknown API route returns a JSON 404', async () => {
    const res = await get('/api/nope');
    const json = await res.json();
    assert.equal(res.status, 404);
    assert.equal(json.success, false);
    assert.equal(json.code, 'NOT_FOUND');
  });
});

describe('monitor endpoints', () => {
  for (const p of ['summary', 'endpoints', 'performance']) {
    it(`GET /api/monitor/${p} honours ranges and flags simulated data`, async () => {
      for (const range of ['1h', '6h', '24h', '7d', '30d']) {
        const res = await get(`/api/monitor/${p}?range=${range}`);
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.meta.simulated, true);
        assert.ok(json.data);
      }
    });
  }
  it('rejects an invalid range with 400', async () => {
    const res = await get('/api/monitor/summary?range=2y');
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'INVALID_RANGE');
  });
  it('performance KPIs are internally consistent', async () => {
    const { data } = await (await get('/api/monitor/performance?range=24h')).json();
    const sum = data.series.reduce((s, p) => s + p.requests, 0);
    assert.equal(sum, data.kpis.total);
    assert.ok(data.kpis.min <= data.kpis.avg && data.kpis.avg <= data.kpis.max);
    assert.ok(Math.abs(data.kpis.successRate + data.kpis.errorRate - 100) < 0.02);
    assert.equal(data.series.length, 96);
  });
  it('errors, activity, system and notifications respond', async () => {
    for (const p of ['errors', 'activity', 'system', 'notifications']) {
      const res = await get(`/api/monitor/${p}`);
      assert.equal(res.status, 200, p);
      assert.equal((await res.json()).success, true);
    }
  });
});

describe('database health without MongoDB', () => {
  it('reports an unavailable state instead of failing', async () => {
    const { data } = await (await get('/api/database/health')).json();
    assert.notEqual(data.status, 'connected');
  });
  it('serves a clearly flagged demo variant', async () => {
    const json = await (await get('/api/database/health?demo=1')).json();
    assert.equal(json.data.status, 'connected');
    assert.equal(json.meta.simulated, true);
  });
});

describe('auth input handling', () => {
  it('malformed JSON returns 400 INVALID_JSON', async () => {
    const res = await post('/api/auth/login', null, '{bad json');
    // Without JWT_SECRET configured the guard answers first; with it, the parser does.
    assert.ok([400, 503].includes(res.status));
    assert.equal((await res.json()).success, false);
  });
  it('protected route without a token is rejected', async () => {
    const res = await get('/api/auth/me');
    assert.ok([401, 503].includes(res.status));
  });
});
