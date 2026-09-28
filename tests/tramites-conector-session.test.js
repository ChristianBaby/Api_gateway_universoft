import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionBoundary } from '../src/middlewares/session.middleware.js';
test('el token del conector local MINCUL nunca se verifica como sesión central', async () => {
 let checked = 0, next = 0;
 const boundary = createSessionBoundary({ fetchImpl: async () => { checked++; return { status: 401 }; } });
 const res = { status(code) { assert.equal(code, 401); return this; }, json() {} };
 for (const path of ['/tramites/conector/estado', '/tramites/conector/sesion', '/tramites/conector/agente/contexto']) {
   await boundary({ path, method: 'GET', headers: { authorization: 'Bearer expired' } }, res, () => next++);
 }
 assert.equal(next, 3); assert.equal(checked, 0);
 for (const path of ['/tramites/70b4c80b-6653-4992-a983-26c72e0ca021', '/tramites']) {
   await boundary({ path, method: 'GET', headers: { authorization: 'Bearer expired' } }, res, () => next++);
 }
 assert.equal(checked, 2); assert.equal(next, 3);
});
