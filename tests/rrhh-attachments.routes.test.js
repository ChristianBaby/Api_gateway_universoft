import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import createRrhhRoutes from '../src/routes/rrhh.routes.js';

test('proxy RRHH transmite 25 MB binarios y nombre sin truncar', async t => {
  const bytes = Buffer.alloc(25 * 1024 * 1024, 7);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const upstream = createServer(async (req, res) => {
    let size = 0; const digest = createHash('sha256');
    for await (const part of req) { size += part.length; digest.update(part); }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ size, hash: digest.digest('hex'), filename: req.headers['x-file-name'] }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const previous = process.env.RRHH_URL;
  process.env.RRHH_URL = `http://127.0.0.1:${upstream.address().port}`;
  const app = express(); app.use(createRrhhRoutes()); app.use(express.json({ limit: '10mb' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(async () => {
    if (previous === undefined) delete process.env.RRHH_URL; else process.env.RRHH_URL = previous;
    await Promise.all([server, upstream].map(s => new Promise(resolve => { s.close(resolve); s.closeAllConnections(); })));
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/rrhh-api/comunicaciones/test/adjuntos`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'planos.zip' }, body: bytes });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { size: bytes.length, hash, filename: 'planos.zip' });
});
