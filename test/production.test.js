// Production smoke test: boots the app the way `npm start` does and verifies the static
// serving, SPA fallback and cache headers a deployed instance depends on.
// Requires `npm run build` first; it skips itself when client/dist is absent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const built = fs.existsSync(distDir);

process.env.JWT_SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';
process.env.MONGODB_URI = '';
process.env.NODE_ENV = 'production';
// A fixed, non-local origin so the CORS allow-list is exercised with a realistic value.
const CLIENT_ORIGIN = 'https://dev-pulse-api-sepia.vercel.app';
process.env.CLIENT_ORIGIN = `http://localhost:5173, ${CLIENT_ORIGIN}`;

const { createApp } = await import('../src/app.js');

let server;
let base;
// The second argument carries fetch options (e.g. an Origin header) for the CORS tests.
const get = (p, init) => fetch(base + p, init);

describe('production static serving', { skip: built ? false : 'run `npm run build` first' }, () => {
  before(async () => {
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it('keeps the API reachable', async () => {
    const res = await get('/api/health');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).success, true);
  });

  it('serves the SPA shell at the root', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.match(await res.text(), /<div id="root">/);
  });

  it('falls back to the shell for deep links so client routing works on refresh', async () => {
    for (const route of ['/monitor', '/settings', '/does-not-exist']) {
      const res = await get(route);
      assert.equal(res.status, 200, route);
      assert.match(await res.text(), /<div id="root">/, route);
    }
  });

  it('caches hashed assets immutably', async () => {
    const html = await (await get('/')).text();
    const src = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    assert.ok(src, 'index.html does not reference a hashed asset');
    const res = await get(src);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') || '', /immutable/);
  });

  it('never caches index.html', async () => {
    const res = await get('/');
    assert.match(res.headers.get('cache-control') || '', /no-cache/);
  });

  it('still returns a JSON 404 for unknown API routes', async () => {
    const res = await get('/api/nope');
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'NOT_FOUND');
  });

  it('sends the expected security headers', async () => {
    const res = await get('/api/health');
    assert.ok(res.headers.get('content-security-policy'), 'missing CSP');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

describe('CORS', { skip: built ? false : 'run `npm run build` first' }, () => {
  before(async () => {
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it('allows the configured client origin', async () => {
    const res = await get('/api/health', { headers: { Origin: CLIENT_ORIGIN } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), CLIENT_ORIGIN);
  });

  it('matches regardless of trailing slash and letter case', async () => {
    // A pasted value like "https://app.vercel.app/" must still match the browser's origin.
    // The response echoes whatever the browser sent, so compare case-insensitively.
    const res = await get('/api/health', { headers: { Origin: `${CLIENT_ORIGIN.toUpperCase()}/` } });
    const allowed = res.headers.get('access-control-allow-origin');
    assert.ok(allowed, 'no allow-origin header was sent');
    assert.equal(allowed.replace(/\/+$/, '').toLowerCase(), CLIENT_ORIGIN);
  });

  it('does not send an allow-origin header for an unknown origin', async () => {
    const res = await get('/api/health', { headers: { Origin: 'https://evil.example.com' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('answers preflight for an allowed origin', async () => {
    const res = await get('/api/auth/login', {
      method: 'OPTIONS',
      headers: { Origin: CLIENT_ORIGIN, 'Access-Control-Request-Method': 'POST' },
    });
    assert.ok(res.status === 204 || res.status === 200);
    assert.equal(res.headers.get('access-control-allow-origin'), CLIENT_ORIGIN);
  });

  it('vary header is set so caches do not serve the wrong origin', async () => {
    const res = await get('/api/health', { headers: { Origin: CLIENT_ORIGIN } });
    assert.match(res.headers.get('vary') || '', /Origin/i);
  });

  it('still serves non-browser clients that send no Origin', async () => {
    const res = await get('/api/health');
    assert.equal(res.status, 200);
  });
});

// These cover the deployed case: an API whose CLIENT_ORIGIN was never set in the host's
// dashboard must not blank the dashboard. Each case re-imports env.js with a fresh cache
// because the allow-list is computed once at module load.
async function loadEnv(overrides) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // A cache-busting query makes Node re-evaluate the module and its dotenv import.
  const mod = await import(`../src/config/env.js?t=${Math.random()}`);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return mod;
}

describe('CORS allow-list resolution', () => {
  it('accepts any origin when CLIENT_ORIGIN and public URLs are all unset', async () => {
    const mod = await loadEnv({ CLIENT_ORIGIN: undefined, PUBLIC_URL: undefined, RENDER_EXTERNAL_URL: undefined });
    assert.deepEqual(mod.env.clientOrigins, []);
    assert.equal(mod.env.clientOriginsUnconfigured, true);
    assert.equal(mod.isOriginAllowed('https://dev-pulse-api-sepia.vercel.app'), true);
  });

  it('derives an origin from PUBLIC_URL for single-service deploys', async () => {
    const mod = await loadEnv({ CLIENT_ORIGIN: undefined, PUBLIC_URL: 'https://api.example.com', RENDER_EXTERNAL_URL: undefined });
    assert.ok(mod.env.clientOrigins.includes('https://api.example.com'));
    assert.equal(mod.isOriginAllowed('https://api.example.com'), true);
    assert.equal(mod.env.clientOriginsUnconfigured, false);
  });

  it('derives an origin from RENDER_EXTERNAL_URL, ignoring any path', async () => {
    const mod = await loadEnv({ CLIENT_ORIGIN: undefined, PUBLIC_URL: undefined, RENDER_EXTERNAL_URL: 'https://svc.onrender.com/some/path' });
    assert.deepEqual(mod.env.clientOrigins, ['https://svc.onrender.com']);
  });

  it('stays strict as soon as CLIENT_ORIGIN is configured', async () => {
    const mod = await loadEnv({ CLIENT_ORIGIN: 'https://frontend.example.com', PUBLIC_URL: 'https://api.example.com', RENDER_EXTERNAL_URL: undefined });
    assert.equal(mod.isOriginAllowed('https://frontend.example.com'), true);
    assert.equal(mod.isOriginAllowed('https://other.example.com'), false);
  });

  it('treats "*" as allow-all', async () => {
    const mod = await loadEnv({ CLIENT_ORIGIN: '*', PUBLIC_URL: undefined, RENDER_EXTERNAL_URL: undefined });
    assert.equal(mod.isOriginAllowed('https://anything.example.com'), true);
  });

  it('ignores an unparseable public URL instead of crashing', async () => {
    const mod = await loadEnv({ CLIENT_ORIGIN: undefined, PUBLIC_URL: 'not-a-url', RENDER_EXTERNAL_URL: undefined });
    assert.deepEqual(mod.env.clientOrigins, []);
  });
});