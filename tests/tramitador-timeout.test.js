import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/routes/tramitador.routes.js', 'utf8');

test('el proxy de trámites soporta la espera manual de sesión MINCUL', () => {
    assert.match(source, /TRAMITADOR_PROXY_TIMEOUT_MS\s*=\s*240000/);
    assert.match(source, /timeout:\s*TRAMITADOR_PROXY_TIMEOUT_MS/);
    assert.match(source, /proxyTimeout:\s*TRAMITADOR_PROXY_TIMEOUT_MS/);
});
