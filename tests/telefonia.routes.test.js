import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import createTelefoniaRoutes, { canReviewRecordings } from '../src/routes/telefonia.routes.js';

test('telefonia rejects anonymous clients and overwrites forged identity', async t => {
  const previous = { url: process.env.TELEFONIA_URL, token: process.env.TELEFONIA_SERVICE_TOKEN, fetch: global.fetch };
  const fetchClient = global.fetch;
  let hits = 0;
  const upstream = createServer((req, res) => {
    hits++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ path: req.url, user: req.headers['x-user-id'], name: req.headers['x-user-name'], kind: req.headers['x-user-kind'], role: req.headers['x-user-role'], admin: req.headers['x-telefonia-admin'], secret: req.headers['x-telefonia-service-token'] }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  process.env.TELEFONIA_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.TELEFONIA_SERVICE_TOKEN = 'internal-test';
  global.fetch = async (_url, options) => ['Bearer valid', 'Bearer admin'].includes(options.headers.Authorization)
    ? new Response(JSON.stringify({ success: true, data: { valid: true, user: { id: 'verified-user', nombre: 'Verified', apellido_paterno: 'User', tipo_entidad: 'usuario', permissions: options.headers.Authorization === 'Bearer admin' ? ['rrhh.panel.admin'] : [] } } }))
    : new Response('{}', { status: 401 });
  const app = express(); app.use(createTelefoniaRoutes());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(async () => {
    global.fetch = previous.fetch;
    for (const [key, value] of [['TELEFONIA_URL', previous.url], ['TELEFONIA_SERVICE_TOKEN', previous.token]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await Promise.all([server, upstream].map(s => new Promise(resolve => { s.close(resolve); s.closeAllConnections(); })));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/telefonia`;
  assert.equal((await fetchClient(`${base}/me/calls`, { headers: { 'x-user-id': 'victim' } })).status, 401);
  assert.equal(hits, 0);
  assert.equal((await fetchClient(`${base}/me/calls`, { headers: { authorization: 'Bearer invalid' } })).status, 401);
  assert.equal(hits, 0);
  const response = await fetchClient(`${base}/me/calls`, { headers: { authorization: 'Bearer valid', 'x-user-id': 'victim', 'x-user-name': 'Forged', 'x-user-kind': 'forged', 'x-user-role': 'admin', 'x-telefonia-admin': 'true', 'x-telefonia-service-token': 'forged' } });
  assert.deepEqual(await response.json(), { path: '/api/telefonia/me/calls', user: 'verified-user', name: 'Verified%20User', kind: 'usuario', secret: 'internal-test' });
  const before = hits;
  for (const path of ['/admin/sim/users', '/admin/sim/recordings', '/admin/sim/recordings/id/audio', '/ADMIN/sim/recordings']) {
    assert.equal((await fetchClient(base + path, { headers: { authorization: 'Bearer valid', 'x-telefonia-admin': 'true' } })).status, 403);
  }
  assert.equal(hits, before);
  const admin = await fetchClient(`${base}/admin/sim/recordings`, { headers: { authorization: 'Bearer admin', 'x-user-id': 'victim', 'x-telefonia-admin': 'false' } });
  const adminBody = await admin.json(); assert.equal(admin.status, 200); assert.equal(adminBody.user, 'verified-user'); assert.equal(adminBody.admin, 'true');
  assert.equal((await fetchClient(`${base}/health`)).status, 200);
});

test('administrative recordings use central permissions, not role names or arbitrary claims', () => {
  assert.equal(canReviewRecordings({ tipo_entidad: 'usuario', permissions: ['rrhh.panel.admin'] }), true);
  assert.equal(canReviewRecordings({ tipo_entidad: 'usuario', rol: { permisos: ['rrhh.panel.admin'] } }), true);
  for (const user of [undefined, { admin: true }, { tipo_entidad: 'usuario', rol: { nombre: 'Administrador' } },
    { tipo_entidad: 'cliente', permissions: ['rrhh.panel.admin'] }, { tipo_entidad: 'usuario', permissions: 'rrhh.panel.admin' },
    { tipo_entidad: 'usuario', permissions: [], rol: { permisos: ['rrhh.panel.admin'] } }]) assert.equal(canReviewRecordings(user), false);
});
