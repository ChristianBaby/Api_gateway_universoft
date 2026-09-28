import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('el gateway declara explicitamente los dominios vigentes de staging', () => {
    const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
    assert.match(server, /https:\/\/staging-rwk-frontend-ruwark\.nfnbzo\.easypanel\.host/);
    assert.match(server, /https:\/\/staging-rwk-panel-cliente-ruwark\.nfnbzo\.easypanel\.host/);
    assert.match(server, /https:\/\/staging-rwk-api-gateway-ruwar\.nfnbzo\.easypanel\.host/);
    assert.match(server, /https:\/\/staging-rwk-frontend-ruwark\.z05b3r\.easypanel\.host/);
    assert.match(server, /https:\/\/staging-api-gateway-ruwark\.z05b3r\.easypanel\.host/);
});

test('las respuestas proxy de clientes permiten al host y al microfrontend de staging', () => {
    const clientesRoutes = fs.readFileSync(path.join(root, 'src/routes/clientes.routes.js'), 'utf8');
    assert.match(clientesRoutes, /https:\/\/staging-rwk-frontend-ruwark\.nfnbzo\.easypanel\.host/);
    assert.match(clientesRoutes, /https:\/\/staging-rwk-panel-cliente-ruwark\.nfnbzo\.easypanel\.host/);
});

test('el gateway permite los headers del editor cuando el panel consume CORS directo', () => {
    const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
    assert.match(server, /'X-Project-Id'/);
    assert.match(server, /'X-Presentation-Id'/);
    assert.match(server, /'X-Filename'/);
});
