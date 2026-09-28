import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createActivityTelemetry } from '../src/middlewares/activity-telemetry.middleware.js';

test('gateway records only authenticated non-RRHH responses without query strings', async () => {
  const sent = [];
  const middleware = createActivityTelemetry({ env: { RRHH_URL: 'http://rrhh', RRHH_SERVICE_TOKEN: 'secret' },
    fetchImpl: async (url, options) => { sent.push({ url: String(url), options }); return { ok: true }; } });
  const response = new EventEmitter(); response.statusCode = 201;
  middleware({ path: '/api/ventas/pedidos/123', method: 'POST', ip: '192.0.2.5', headers: { 'user-agent': 'Test' }, user: { id: 'user' } }, response, () => {});
  response.emit('finish');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1);
  const body = JSON.parse(sent[0].options.body);
  assert.equal(body.usuario_id, 'user');
  assert.deepEqual(body.datos, { metodo: 'POST', ruta: '/ventas/pedidos/:id', estado_http: 201 });
  assert.equal(body.ip_address, '192.0.2.5');
  const skipped = new EventEmitter();
  middleware({ path: '/rrhh-api/mi-actividad/telemetria', headers: {}, user: { id: 'user' } }, skipped, () => {});
  skipped.emit('finish');
  assert.equal(sent.length, 1);
});
