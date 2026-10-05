import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

// Must be set before the app (and env config) is imported.
process.env.JWT_SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';
process.env.MONGODB_URI = '';

const { default: jwt } = await import('jsonwebtoken');
const { createApp } = await import('../src/app.js');
const SECRET = process.env.JWT_SECRET;

let server;
let base;
const call = (method, path, { body, raw, token } = {}) =>
  fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

describe('auth with JWT configured but no database', () => {
  it('rejects invalid JSON with 400 INVALID_JSON', async () => {
    const res = await call('POST', '/api/auth/login', { raw: '{oops' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'INVALID_JSON');
  });
  it('rejects bad input with 422 and field details', async () => {
    const res = await call('POST', '/api/auth/register', { body: { name: 'A', email: 'nope', password: 'short' } });
    const json = await res.json();
    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(json.details).sort(), ['email', 'name', 'password']);
  });
  it('rejects non-string credentials (NoSQL injection shape)', async () => {
    const res = await call('POST', '/api/auth/login', { body: { email: { $gt: '' }, password: { $gt: '' } } });
    assert.equal(res.status, 422);
  });
  it('valid input with the database down returns 503 DATABASE_UNAVAILABLE', async () => {
    const res = await call('POST', '/api/auth/login', { body: { email: 'dev@example.com', password: 'password123' } });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'DATABASE_UNAVAILABLE');
  });
});

describe('token verification', () => {
  it('requires a bearer token', async () => {
    const res = await call('GET', '/api/auth/me');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'AUTH_REQUIRED');
  });
  it('rejects a token signed with the wrong secret', async () => {
    const token = jwt.sign({ userId: '1', role: 'admin' }, 'x'.repeat(40), { algorithm: 'HS256' });
    const res = await call('GET', '/api/auth/me', { token });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
  });
  it('rejects an expired token with TOKEN_EXPIRED', async () => {
    const token = jwt.sign({ userId: '1', role: 'user' }, SECRET, { algorithm: 'HS256', expiresIn: -10 });
    const res = await call('GET', '/api/auth/me', { token });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_EXPIRED');
  });
  it('rejects an unsigned alg:none token', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: '1', role: 'admin' })}.`;
    const res = await call('GET', '/api/auth/me', { token });
    assert.equal(res.status, 401);
  });
  it('accepts a valid token (then reports the database as unavailable)', async () => {
    const token = jwt.sign({ userId: '1', role: 'user' }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
    const res = await call('GET', '/api/auth/me', { token });
    assert.equal(res.status, 503);
  });
});
