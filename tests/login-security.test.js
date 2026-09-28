import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import createAuthRoutes from '../src/routes/auth.routes.js';

test('gateway rechaza refresh, algoritmo distinto y claims modernos incorrectos', async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'security-test-only';
  const { authenticateJWT } = await import('../src/middlewares/auth.middleware.js?security-test');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { valid: true, user: { id: 'user' } } }) });
  try {
    const run = async token => {
      let status = 200; let accepted = false;
      const res = { status(code) { status = code; return this; }, json() {} };
      await authenticateJWT({ headers: { authorization: `Bearer ${token}` }, path: '/private', method: 'GET' }, res, () => { accepted = true; });
      return { status, accepted };
    };
    const claims = { id: 'user', sid: 'session', token_use: 'access', iss: 'ruwark-login', aud: 'ruwark-services' };
    assert.equal((await run(jwt.sign(claims, process.env.JWT_SECRET))).accepted, true);
    for (const token of [jwt.sign({ ...claims, token_use: 'refresh' }, process.env.JWT_SECRET), jwt.sign({ ...claims, aud: 'other' }, process.env.JWT_SECRET), jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS384' })]) assert.deepEqual(await run(token), { status: 401, accepted: false });
  } finally { globalThis.fetch = originalFetch; if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; }
});

test('proxy de login no refleja origen arbitrario ni hereda CORS permisivo del upstream', async t => {
  const upstream = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true' });
    res.end('{"success":true}');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${upstream.address().port}`;
  const app = express();
  app.use((req, res, next) => { if (req.headers.origin === 'http://localhost:3001') res.setHeader('Access-Control-Allow-Origin', req.headers.origin); next(); });
  app.use(createAuthRoutes({ LOGIN: { baseUrl }, AUTH: { baseUrl } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => Promise.all([server, upstream].map(s => new Promise(resolve => { s.close(resolve); s.closeAllConnections(); }))));
  for (const origin of ['http://localhost:3001', 'https://untrusted.invalid']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/login`, { method: 'POST', headers: { Origin: origin } });
    assert.equal(response.headers.get('access-control-allow-origin'), origin === 'http://localhost:3001' ? origin : null);
  }
});
