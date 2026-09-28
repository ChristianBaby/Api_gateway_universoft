import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-gateway-video-secret';
const MICROSERVICE_TOKEN = 'test-gateway-video-service-token';

process.env.JWT_SECRET = JWT_SECRET;
process.env.MICROSERVICE_TOKEN = MICROSERVICE_TOKEN;
process.env.NODE_ENV = 'test';

const { getServices } = await import('../src/config/services.js');
const { default: createRoutes } = await import('../src/routes/index.js');
const { rewriteMarketingVideoPath } = await import('../src/routes/marketing-video.routes.js');

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

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function withMockVideoAndGateway(run) {
  const received = [];
  const videoServer = http.createServer(async (req, res) => {
    const body = await readBody(req);
    received.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url }));
  });

  const videoAddress = await listen(videoServer);
  const videoBaseUrl = `http://127.0.0.1:${videoAddress.port}`;

  const previousVideoUrl = process.env.MICRO_EDITOR_VIDEO_URL;
  const previousEditorUrl = process.env.MICRO_EDITOR_IMAGEN_URL;
  process.env.MICRO_EDITOR_VIDEO_URL = videoBaseUrl;
  delete process.env.MICRO_EDITOR_IMAGEN_URL;

  const gatewayApp = express();
  gatewayApp.use('/', createRoutes(getServices()));
  const gatewayServer = http.createServer(gatewayApp);
  const gatewayAddress = await listen(gatewayServer);
  const gatewayBaseUrl = `http://127.0.0.1:${gatewayAddress.port}`;

  try {
    await run({ gatewayBaseUrl, received });
  } finally {
    if (previousVideoUrl === undefined) delete process.env.MICRO_EDITOR_VIDEO_URL;
    else process.env.MICRO_EDITOR_VIDEO_URL = previousVideoUrl;
    if (previousEditorUrl === undefined) delete process.env.MICRO_EDITOR_IMAGEN_URL;
    else process.env.MICRO_EDITOR_IMAGEN_URL = previousEditorUrl;
    await close(gatewayServer);
    await close(videoServer);
  }
}

function frontendJwt(payload = {}) {
  return jwt.sign(
    {
      user_id: 'frontend-user-123',
      marca_usuario_id: 'frontend-brand-scope-456',
      ...payload,
    },
    JWT_SECRET,
    { expiresIn: '10m' },
  );
}

function frontendHeaders(payload, overrides = {}) {
  return {
    Authorization: `Bearer ${frontendJwt(payload)}`,
    'Content-Type': 'application/json',
    ...overrides,
  };
}

test('rewriteMarketingVideoPath preserves suffixes and query strings', () => {
  assert.equal(rewriteMarketingVideoPath('/', '/marketing/video-projects', '/v1/video-projects'), '/v1/video-projects');
  assert.equal(
    rewriteMarketingVideoPath('/?limit=24', '/marketing/video-projects', '/v1/video-projects'),
    '/v1/video-projects?limit=24',
  );
  assert.equal(
    rewriteMarketingVideoPath('/77/draft', '/marketing/video-projects', '/v1/video-projects'),
    '/v1/video-projects/77/draft',
  );
  assert.equal(
    rewriteMarketingVideoPath('/marketing/video-templates?limit=12', '/marketing/video-templates', '/v1/video-templates'),
    '/v1/video-templates?limit=12',
  );
});

test('Gateway proxies independent Video Studio routes to /v1/video-* with trusted headers', async () => {
  await withMockVideoAndGateway(async ({ gatewayBaseUrl, received }) => {
    const routes = [
      ['GET', '/marketing/video-projects?limit=24', '/v1/video-projects?limit=24'],
      ['POST', '/marketing/video-projects', '/v1/video-projects', { name: 'Video lanzamiento' }],
      ['PATCH', '/marketing/video-projects/77', '/v1/video-projects/77', { name: 'Nuevo nombre' }],
      ['GET', '/marketing/video-projects/77/draft', '/v1/video-projects/77/draft'],
      [
        'PATCH',
        '/marketing/video-projects/77/draft',
        '/v1/video-projects/77/draft',
        { baseRevision: 1, document: { layers: [{ uid: 'track-1', components: [] }] } },
      ],
      ['DELETE', '/marketing/video-projects/77', '/v1/video-projects/77'],
      ['GET', '/marketing/video-templates?limit=12', '/v1/video-templates?limit=12'],
      ['POST', '/marketing/video-templates', '/v1/video-templates', { projectVideoStudioId: 77, nombre: 'Plantilla video' }],
      ['PATCH', '/marketing/video-templates/501', '/v1/video-templates/501', { projectVideoStudioId: 77, nombre: 'Plantilla editada' }],
      ['POST', '/marketing/video-templates/501/thumbnail', '/v1/video-templates/501/thumbnail', {}],
      ['DELETE', '/marketing/video-templates/501', '/v1/video-templates/501'],
    ];

    for (const [method, publicPath, , body] of routes) {
      const response = await fetch(`${gatewayBaseUrl}${publicPath}`, {
        method,
        headers: frontendHeaders({}, {
          'X-Service-Token': 'forged-browser-token',
          'X-User-Id': 'forged-browser-user',
          'X-Marca-Usuario-Id': 'forged-browser-brand',
          'X-Request-Id': 'forged-browser-request',
        }),
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(response.status, 200);
    }

    assert.deepEqual(received.map((request) => request.url), routes.map(([, , expected]) => expected));
    assert.deepEqual(received.map((request) => request.method), routes.map(([method]) => method));

    for (const request of received) {
      assert.equal(request.headers['x-service-token'], MICROSERVICE_TOKEN);
      assert.equal(request.headers['x-user-id'], 'frontend-user-123');
      assert.equal(request.headers['x-marca-usuario-id'], 'frontend-brand-scope-456');
      assert.match(request.headers['x-request-id'], /^gw-video-/);
      assert.equal(request.headers['x-marketing-brand-user-id'], undefined);
      assert.notEqual(request.headers['x-service-token'], 'forged-browser-token');
      assert.notEqual(request.headers['x-user-id'], 'forged-browser-user');
      assert.notEqual(request.headers['x-marca-usuario-id'], 'forged-browser-brand');
      assert.notEqual(request.headers['x-request-id'], 'forged-browser-request');
    }
  });
});

test('Gateway rejects Video Studio mutations without trusted brand scope before proxying', async () => {
  await withMockVideoAndGateway(async ({ gatewayBaseUrl, received }) => {
    const withoutBrand = { marca_usuario_id: undefined, marcaUsuarioId: undefined };
    const createResponse = await fetch(`${gatewayBaseUrl}/marketing/video-projects`, {
      method: 'POST',
      headers: frontendHeaders(withoutBrand),
      body: JSON.stringify({ name: 'Sin marca' }),
    });
    assert.equal(createResponse.status, 403);
    assert.equal((await createResponse.json()).error, 'BRAND_SCOPE_DENIED');
    assert.equal(received.length, 0);

    const templatesResponse = await fetch(`${gatewayBaseUrl}/marketing/video-templates?limit=3`, {
      headers: frontendHeaders(withoutBrand),
    });
    assert.equal(templatesResponse.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/v1/video-templates?limit=3');
    assert.equal(received[0].headers['x-marca-usuario-id'], undefined);
    assert.equal(received[0].headers['x-user-id'], 'frontend-user-123');

    const createTemplateResponse = await fetch(`${gatewayBaseUrl}/marketing/video-templates`, {
      method: 'POST',
      headers: frontendHeaders(withoutBrand),
      body: JSON.stringify({ projectVideoStudioId: 77, nombre: 'Sin marca' }),
    });
    assert.equal(createTemplateResponse.status, 403);
    assert.equal((await createTemplateResponse.json()).error, 'BRAND_SCOPE_DENIED');
    assert.equal(received.length, 1);
  });
});
