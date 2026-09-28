import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync(new URL('../src/routes/ventas.routes.js', import.meta.url), 'utf8');

test('Google Drive, Docs y Sheets atraviesan el proxy canónico de Ventas', () => {
  const ventasProxy = routes.split("router.use('/api/ventas'")[1]
    ?.split("router.use('/api/reportes-ventas'")[0] || '';

  assert.match(ventasProxy, /target: SERVICES\.VENTAS\.baseUrl/);
  assert.match(ventasProxy, /return path/);
  assert.match(ventasProxy, /setHeader\('Authorization', req\.headers\.authorization\)/);
  assert.match(ventasProxy, /addServiceToken/);
  assert.match(ventasProxy, /timeout: 180000/);
});

test('el Gateway no contiene credenciales ni una ruta directa especial para Gmail', () => {
  assert.doesNotMatch(routes, /ruwark23@gmail\.com/);
  assert.doesNotMatch(routes, /client_secret|refresh_token/i);
  assert.doesNotMatch(routes, /googleapis\.com/);
});
