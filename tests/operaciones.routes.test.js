import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

process.env.NODE_ENV = 'test';

const { default: createOperacionesRoutes } = await import('../src/routes/operaciones.routes.js');

function listen(server) {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server.address()));
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

async function withMockOperacionesAndGateway(run) {
    const received = [];
    const operacionesServer = http.createServer((req, res) => {
        received.push({ url: req.url, method: req.method, headers: req.headers });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: req.url }));
    });
    const operacionesAddress = await listen(operacionesServer);

    const gatewayApp = express();
    gatewayApp.use('/', createOperacionesRoutes({
        OPERACIONES: { baseUrl: `http://127.0.0.1:${operacionesAddress.port}` },
    }));
    const gatewayServer = http.createServer(gatewayApp);
    const gatewayAddress = await listen(gatewayServer);

    try {
        await run({
            received,
            gatewayBaseUrl: `http://127.0.0.1:${gatewayAddress.port}`,
        });
    } finally {
        await close(gatewayServer);
        await close(operacionesServer);
    }
}

test('Gateway conserva el contrato canónico de proyectos de Operaciones sin /v2', async () => {
    await withMockOperacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
        const urls = [
            '/api/operaciones/proyectos/contadores-por-estado',
            '/api/operaciones/proyectos?page=1&limit=15&estados=aprobado_contabilidad',
        ];

        for (const url of urls) {
            const response = await fetch(`${gatewayBaseUrl}${url}`, {
                headers: { Authorization: 'Bearer frontend-token' },
            });
            assert.equal(response.status, 200);
        }

        assert.deepEqual(received.map((request) => request.url), urls);
        for (const request of received) {
            assert.equal(request.headers['x-service-name'], 'api-gateway');
            assert.ok(request.headers['x-service-token']);
            assert.equal(request.headers.authorization, 'Bearer frontend-token');
            assert.equal(request.url.includes('/v2'), false);
        }
    });
});

test('La compatibilidad /api/projects también se reescribe sin pasar por /v2', async () => {
    await withMockOperacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
        const response = await fetch(`${gatewayBaseUrl}/api/projects?limit=5`);
        assert.equal(response.status, 200);
        assert.equal(received[0].url, '/api/operaciones/proyectos?limit=5');
    });
});
