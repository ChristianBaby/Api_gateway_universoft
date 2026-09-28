import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionBoundary } from '../src/middlewares/session.middleware.js';

function okResponse(user = { id: 'user-1', rol: 'ventas' }) {
  return { status: 200, ok: true, json: async () => ({ success: true, data: { valid: true, user } }) };
}

function run(middleware, token, path = '/operaciones/proyectos') {
  return new Promise((resolve) => {
    const req = { path, method: 'GET', headers: { authorization: `Bearer ${token}` } };
    const res = { status(code) { this.code = code; return this; }, json(body) { resolve({ code: this.code, body }); } };
    middleware(req, res, () => resolve({ code: 200, req })).catch?.(() => {});
  });
}

test('verificaciones exitosas se cachean: dos requests secuenciales con el mismo token llaman fetch una sola vez', async () => {
  let calls = 0;
  const middleware = createSessionBoundary({ cacheTtlMs: 30000, fetchImpl: async () => { calls++; return okResponse(); } });
  await run(middleware, 'tok-a');
  await run(middleware, 'tok-a');
  assert.equal(calls, 1);
});

test('el cache expira segun cacheTtlMs (clock inyectado con `now`)', async () => {
  let calls = 0;
  let clock = 0;
  const middleware = createSessionBoundary({ cacheTtlMs: 30000, now: () => clock, fetchImpl: async () => { calls++; return okResponse(); } });
  await run(middleware, 'tok-b');
  clock += 29999;
  await run(middleware, 'tok-b');
  assert.equal(calls, 1, 'todavia dentro del TTL, no debe volver a llamar a fetch');
  clock += 2; // total 30001ms, ya vencio
  await run(middleware, 'tok-b');
  assert.equal(calls, 2, 'vencido el TTL debe volver a verificar');
});

test('una respuesta 401 nunca se cachea: la siguiente request vuelve a llamar fetch', async () => {
  let calls = 0;
  const middleware = createSessionBoundary({ cacheTtlMs: 30000, fetchImpl: async () => { calls++; return { status: 401, ok: false }; } });
  const r1 = await run(middleware, 'tok-c');
  const r2 = await run(middleware, 'tok-c');
  assert.equal(r1.code, 401);
  assert.equal(r2.code, 401);
  assert.equal(calls, 2);
});

test('un error de red no se cachea: 503 y luego un reintento exitoso funciona', async () => {
  let shouldFail = true;
  let calls = 0;
  const middleware = createSessionBoundary({ cacheTtlMs: 30000, fetchImpl: async () => { calls++; if (shouldFail) throw new Error('network down'); return okResponse(); } });
  const r1 = await run(middleware, 'tok-d');
  assert.equal(r1.code, 503);
  shouldFail = false;
  const r2 = await run(middleware, 'tok-d');
  assert.equal(r2.code, 200);
  assert.equal(calls, 2);
});

test('requests concurrentes con el mismo token comparten una sola verificacion en curso (in-flight dedupe)', async () => {
  let calls = 0;
  let resolveFetch;
  const pending = new Promise((resolve) => { resolveFetch = resolve; });
  const middleware = createSessionBoundary({
    fetchImpl: async () => { calls++; await pending; return okResponse(); },
  });
  const p1 = run(middleware, 'tok-e');
  const p2 = run(middleware, 'tok-e');
  resolveFetch();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(calls, 1);
  assert.equal(r1.code, 200);
  assert.equal(r2.code, 200);
});

test('tokens distintos no comparten cache', async () => {
  let calls = 0;
  const middleware = createSessionBoundary({ cacheTtlMs: 30000, fetchImpl: async () => { calls++; return okResponse(); } });
  await run(middleware, 'tok-f1');
  await run(middleware, 'tok-f2');
  assert.equal(calls, 2);
});

test('cacheTtlMs: 0 deshabilita el cache por completo', async () => {
  let calls = 0;
  const middleware = createSessionBoundary({ cacheTtlMs: 0, fetchImpl: async () => { calls++; return okResponse(); } });
  await run(middleware, 'tok-g');
  await run(middleware, 'tok-g');
  assert.equal(calls, 2);
});
