import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import createRrhhRoutes from '../src/routes/rrhh.routes.js';
test('RRHH proxy conserva Bearer, elimina secreto del cliente y reescribe ruta', async t => {
  const upstream = createServer((req, res) => {
    assert.equal(req.url, '/me');
    assert.equal(req.headers.authorization, 'Bearer test-access');
    assert.equal(req.headers['x-service-token'], undefined);
    assert.equal(req.headers.cookie, undefined);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_COLLABORATOR' }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const previous = process.env.RRHH_URL;
  process.env.RRHH_URL = `http://127.0.0.1:${upstream.address().port}`;
  const app = express(); app.use(createRrhhRoutes());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(async () => {
    if (previous === undefined) delete process.env.RRHH_URL; else process.env.RRHH_URL = previous;
    await Promise.all([server, upstream].map(s => new Promise(resolve => { s.close(resolve); s.closeAllConnections(); })));
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/rrhh-api/me`, { headers: { authorization: 'Bearer test-access', 'x-service-token': 'forged', cookie: 'token=forged' } });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'NOT_COLLABORATOR');
});
