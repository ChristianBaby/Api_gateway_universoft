import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync(new URL('../src/routes/auth.routes.js', import.meta.url), 'utf8');

test('frontend administra identidades Workspace exclusivamente por el proxy /users', () => {
  assert.match(routes, /router\.use\('\/users'/);
  assert.match(routes, /path\.replace\(\/\^\\\/users\/, '\/api\/users'\)/);
  assert.match(routes, /proxyReq\.setHeader\('Authorization', req\.headers\.authorization\)/);
  assert.match(routes, /\/users\/:id\/google-workspace\/provision llama a Google Admin SDK/);
});

test('el gateway no corta el aprovisionamiento antes de que responda Admin SDK', () => {
  const usersProxy = routes.split("router.use('/users'")[1]?.split("router.use('/roles'")[0] || '';
  assert.match(usersProxy, /timeout: 60000/);
  assert.match(usersProxy, /proxyTimeout: 60000/);
});
