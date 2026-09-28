import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionBoundary } from '../src/middlewares/session.middleware.js';
test('revocación central se aplica antes de cualquier proxy y sin cache entre peticiones', async () => {
  let active = true; let calls = 0;
  const middleware = createSessionBoundary({ loginUrl: 'http://identity.test', fetchImpl: async () => { calls++; return { status: active ? 200 : 401, ok: active, json: async () => ({ success: true, data: { valid: true, user: { id: 'user', rol: 'ventas' } } }) }; } });
  const run = async () => { let status = 0; const req = { path: '/operaciones/proyectos', method: 'GET', headers: { authorization: 'Bearer test-only' } }; const res = { status(s) { status=s; return this; }, json() {} }; await middleware(req, res, () => { status=200; }); return status; };
  assert.equal(await run(), 200); active=false; assert.equal(await run(), 401); assert.equal(calls, 2);
});

test('Bearer no distingue mayúsculas y tampoco permite usar una sesión revocada', async () => {
  let calls = 0;
  const middleware = createSessionBoundary({ fetchImpl: async () => { calls++; return { status: 401, ok: false }; } });
  let status = 0;
  const res = { status(code) { status = code; return this; }, json() {} };
  await middleware({ path: '/operaciones/proyectos', method: 'GET', headers: { authorization: 'bearer expired' } }, res, () => { status = 200; });
  assert.equal(status, 401);
  assert.equal(calls, 1);
});
test('caída de identidad devuelve 503 y refresh puede renovar un access vencido', async () => {
  const middleware = createSessionBoundary({ fetchImpl: async () => { throw new Error('offline'); } });
  let status=0; const res={status(s){status=s;return this;},json(){}};
  await middleware({path:'/private',method:'GET',headers:{authorization:'Bearer test'}},res,()=>{status=200;}); assert.equal(status,503);
  await middleware({path:'/auth/refresh-token',method:'POST',headers:{authorization:'Bearer expired'}},res,()=>{status=200;}); assert.equal(status,200);
});
