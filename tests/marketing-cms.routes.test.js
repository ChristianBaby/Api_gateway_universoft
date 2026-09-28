import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-gateway-marketing-secret';
const MICROSERVICE_TOKEN = 'test-gateway-service-token';

process.env.JWT_SECRET = JWT_SECRET;
process.env.MICROSERVICE_TOKEN = MICROSERVICE_TOKEN;
process.env.NODE_ENV = 'test';

const { getServices } = await import('../src/config/services.js');
const { default: createRoutes } = await import('../src/routes/index.js');
const { rewriteCmsPath } = await import('../src/routes/cms.routes.js');

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

async function withMockCmsAndGateway(run) {
  const received = [];
  const cmsServer = http.createServer(async (req, res) => {
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

  const cmsAddress = await listen(cmsServer);
  const cmsBaseUrl = `http://127.0.0.1:${cmsAddress.port}`;

  const previousCmsUrl = process.env.CMS_SERVICE_URL;
  process.env.CMS_SERVICE_URL = cmsBaseUrl;

  const gatewayApp = express();
  gatewayApp.use('/', createRoutes(getServices()));

  const gatewayServer = http.createServer(gatewayApp);
  const gatewayAddress = await listen(gatewayServer);
  const gatewayBaseUrl = `http://127.0.0.1:${gatewayAddress.port}`;

  try {
    await run({ gatewayBaseUrl, cmsBaseUrl, received });
  } finally {
    if (previousCmsUrl === undefined) {
      delete process.env.CMS_SERVICE_URL;
    } else {
      process.env.CMS_SERVICE_URL = previousCmsUrl;
    }
    await close(gatewayServer);
    await close(cmsServer);
  }
}

function frontendJwt(payload = {}) {
  return jwt.sign(
    {
      user_id: 'cms-user-123',
      marca_usuario_id: 'cms-brand-scope-456',
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
    'X-Request-Id': 'req-cms-gateway-001',
    ...overrides,
  };
}

test('CMS service default target follows micro-cms port 4007', () => {
  const previousCmsUrl = process.env.CMS_SERVICE_URL;
  delete process.env.CMS_SERVICE_URL;
  try {
    assert.equal(getServices().CMS.baseUrl, 'http://localhost:4007');
  } finally {
    if (previousCmsUrl === undefined) {
      delete process.env.CMS_SERVICE_URL;
    } else {
      process.env.CMS_SERVICE_URL = previousCmsUrl;
    }
  }
});

test('rewriteCmsPath preserves /marketing/cms contract and query strings', () => {
  assert.equal(rewriteCmsPath('/'), '/marketing/cms');
  assert.equal(rewriteCmsPath('/?include=summary'), '/marketing/cms?include=summary');
  assert.equal(rewriteCmsPath('/workspace'), '/marketing/cms/workspace');
  assert.equal(rewriteCmsPath('/workspace?include=brand'), '/marketing/cms/workspace?include=brand');
  assert.equal(
    rewriteCmsPath('/marketing/cms/social-channels?network=instagram'),
    '/marketing/cms/social-channels?network=instagram',
  );
});

test('Gateway proxies CMS routes without rewriting them to /v1', async () => {
  await withMockCmsAndGateway(async ({ gatewayBaseUrl, received }) => {
    const routes = [
      ['GET', '/marketing/cms/workspace?include=brand', '/marketing/cms/workspace?include=brand'],
      ['GET', '/workspace?include=brand', '/marketing/cms/workspace?include=brand'],
      ['GET', '/marketing/cms/social-channels', '/marketing/cms/social-channels'],
      ['PATCH', '/marketing/cms/brands/brand-1', '/marketing/cms/brands/brand-1', { nombre: 'Marca actualizada' }],
      [
        'POST',
        '/marketing/cms/publications/1001/schedule',
        '/marketing/cms/publications/1001/schedule',
        { networkVariantIds: [5001], scheduledAt: '2026-06-10T09:00:00-05:00' },
      ],
    ];

    for (const [method, publicPath, , body] of routes) {
      const response = await fetch(`${gatewayBaseUrl}${publicPath}`, {
        method,
        headers: frontendHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(response.status, 200);
    }

    assert.deepEqual(
      received.map((request) => request.url),
      routes.map(([, , expectedInternalPath]) => expectedInternalPath),
    );
    assert.deepEqual(
      received.map((request) => request.method),
      routes.map(([method]) => method),
    );
  });
});

test('Gateway injects trusted CMS service and identity headers for workspace discovery', async () => {
  await withMockCmsAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/cms/workspace`, {
      method: 'GET',
      headers: frontendHeaders(
        { rol: 'marketing-admin' },
        {
          'X-Service-Token': 'forged-browser-service-token',
          'X-User-Id': 'forged-browser-user',
          'X-User-Role': 'forged-browser-role',
          'X-Marca-Usuario-Id': 'forged-browser-brand',
          'X-Marketing-Brand-User-Id': 'forged-marketing-brand',
        },
      ),
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);

    const proxied = received[0];
    assert.equal(proxied.method, 'GET');
    assert.equal(proxied.url, '/marketing/cms/workspace');
    assert.equal(proxied.headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(proxied.headers['x-user-id'], 'cms-user-123');
    assert.equal(proxied.headers['x-user-email'], undefined);
    assert.equal(proxied.headers['x-user-role'], 'marketing-admin');
    assert.equal(proxied.headers['x-marca-usuario-id'], undefined);
    assert.equal(proxied.headers['x-marketing-brand-user-id'], undefined);
    assert.equal(proxied.headers['x-request-id'], 'req-cms-gateway-001');
    assert.notEqual(proxied.headers['x-service-token'], 'forged-browser-service-token');
    assert.notEqual(proxied.headers['x-user-id'], 'forged-browser-user');
    assert.notEqual(proxied.headers['x-user-role'], 'forged-browser-role');
    assert.notEqual(proxied.headers['x-marca-usuario-id'], 'forged-browser-brand');
  });
});

test('Gateway injects trusted active brand only for brand-scoped CMS actions', async () => {
  await withMockCmsAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/cms/plannings`, {
      method: 'GET',
      headers: frontendHeaders({ rol: 'marketing-admin' }),
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);

    const proxied = received[0];
    assert.equal(proxied.method, 'GET');
    assert.equal(proxied.url, '/marketing/cms/plannings');
    assert.equal(proxied.headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(proxied.headers['x-user-id'], 'cms-user-123');
    assert.equal(proxied.headers['x-user-role'], 'marketing-admin');
    assert.equal(proxied.headers['x-marca-usuario-id'], 'cms-brand-scope-456');
  });
});

test('Gateway allows user-scoped CMS discovery without an active brand', async () => {
  await withMockCmsAndGateway(async ({ gatewayBaseUrl, received }) => {
    const userOnlyHeaders = frontendHeaders({
      marca_usuario_id: undefined,
      marcaUsuarioId: undefined,
      email: 'marketing@ruwark.com',
    });

    const workspace = await fetch(`${gatewayBaseUrl}/marketing/cms/workspace`, {
      headers: userOnlyHeaders,
    });
    assert.equal(workspace.status, 200);

    const brands = await fetch(`${gatewayBaseUrl}/marketing/cms/brands`, {
      headers: userOnlyHeaders,
    });
    assert.equal(brands.status, 200);

    const brandLookup = await fetch(`${gatewayBaseUrl}/marketing/cms/brands/lookup?query=Nueva%20marca`, {
      headers: userOnlyHeaders,
    });
    assert.equal(brandLookup.status, 200);

    const createBrand = await fetch(`${gatewayBaseUrl}/marketing/cms/brands`, {
      method: 'POST',
      headers: userOnlyHeaders,
      body: JSON.stringify({ nombre: 'Nueva marca' }),
    });
    assert.equal(createBrand.status, 200);

    const logoUploadUrl = await fetch(`${gatewayBaseUrl}/marketing/cms/brands/logo-upload-url`, {
      method: 'POST',
      headers: userOnlyHeaders,
      body: JSON.stringify({ fileName: 'logo.png', contentType: 'image/png', sizeBytes: 1234 }),
    });
    assert.equal(logoUploadUrl.status, 200);

    const logoUpload = await fetch(`${gatewayBaseUrl}/marketing/cms/brands/logo-upload`, {
      method: 'POST',
      headers: userOnlyHeaders,
      body: JSON.stringify({ fileName: 'logo.png', contentType: 'image/png', dataUrl: 'data:image/png;base64,aGVsbG8=' }),
    });
    assert.equal(logoUpload.status, 200);

    const adminUsers = await fetch(`${gatewayBaseUrl}/marketing/cms/admin/users`, {
      headers: userOnlyHeaders,
    });
    assert.equal(adminUsers.status, 200);

    assert.equal(received.length, 7);
    for (const proxied of received) {
      assert.equal(proxied.headers['x-service-token'], MICROSERVICE_TOKEN);
      assert.equal(proxied.headers['x-user-id'], 'cms-user-123');
      assert.equal(proxied.headers['x-user-email'], 'marketing@ruwark.com');
      assert.equal(proxied.headers['x-marca-usuario-id'], undefined);
    }
  });
});

test('Gateway keeps brand-scoped CMS actions protected while discovery remains open', async () => {
  await withMockCmsAndGateway(async ({ gatewayBaseUrl, received }) => {
    const withoutAuth = await fetch(`${gatewayBaseUrl}/marketing/cms/workspace`);
    assert.equal(withoutAuth.status, 401);

    const userOnlyHeaders = frontendHeaders({
      marca_usuario_id: undefined,
      marcaUsuarioId: undefined,
      email: 'marketing@ruwark.com',
    });

    const protectedPlanning = await fetch(`${gatewayBaseUrl}/marketing/cms/plannings`, {
      headers: userOnlyHeaders,
    });
    assert.equal(protectedPlanning.status, 403);

    const protectedBrandUpdate = await fetch(`${gatewayBaseUrl}/marketing/cms/brands/brand-1`, {
      method: 'PATCH',
      headers: userOnlyHeaders,
      body: JSON.stringify({ nombre: 'Marca editada' }),
    });
    assert.equal(protectedBrandUpdate.status, 403);

    assert.equal(received.length, 0);
  });
});

test('Sales video reads need identity but no marketing membership; writes remain scoped', async () => {
  await withMockCmsAndGateway(async ({ gatewayBaseUrl, received }) => {
    const headers = frontendHeaders({ marca_usuario_id: undefined, marcaUsuarioId: undefined, rol: 'ventas' });
    for (const path of ['/sales-videos', '/sales-videos/42/download']) {
      const response = await fetch(`${gatewayBaseUrl}/marketing/cms${path}`, { headers });
      assert.equal(response.status, 200);
    }
    assert.equal(received.length, 2);
    assert.equal(received[0].headers['x-marca-usuario-id'], undefined);
    assert.equal(received[0].headers['x-user-role'], 'ventas');
    assert.equal((await fetch(`${gatewayBaseUrl}/marketing/cms/sales-videos`)).status, 401);
    assert.equal((await fetch(`${gatewayBaseUrl}/marketing/cms/sales-videos`, { method: 'POST', headers })).status, 403);
  });
});
