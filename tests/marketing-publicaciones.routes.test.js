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
const { rewriteMarketingPublicacionesPath } = await import('../src/routes/marketing-publicaciones.routes.js');

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

async function withMockPublicacionesAndGateway(run) {
  const received = [];
  const publicacionesServer = http.createServer(async (req, res) => {
    const body = await readBody(req);
    received.push({ method: req.method, url: req.url, headers: req.headers, body });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url }));
  });

  const publicacionesAddress = await listen(publicacionesServer);
  const publicacionesBaseUrl = `http://127.0.0.1:${publicacionesAddress.port}`;

  const previousPublicacionesUrl = process.env.MICRO_PUBLICACIONES_URL;
  process.env.MICRO_PUBLICACIONES_URL = publicacionesBaseUrl;

  const gatewayApp = express();
  gatewayApp.use('/', createRoutes(getServices()));

  const gatewayServer = http.createServer(gatewayApp);
  const gatewayAddress = await listen(gatewayServer);
  const gatewayBaseUrl = `http://127.0.0.1:${gatewayAddress.port}`;

  try {
    await run({ gatewayBaseUrl, publicacionesBaseUrl, received });
  } finally {
    if (previousPublicacionesUrl === undefined) {
      delete process.env.MICRO_PUBLICACIONES_URL;
    } else {
      process.env.MICRO_PUBLICACIONES_URL = previousPublicacionesUrl;
    }
    await close(gatewayServer);
    await close(publicacionesServer);
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

function frontendHeaders(payload = {}, overrides = {}) {
  return {
    Authorization: `Bearer ${frontendJwt(payload)}`,
    'Content-Type': 'application/json',
    'X-Request-Id': 'req-marketing-publicaciones-001',
    ...overrides,
  };
}

function cmsHeaders(overrides = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Service-Token': MICROSERVICE_TOKEN,
    'X-Origin-Service': 'micro-cms',
    'X-User-Id': 'cms-user-123',
    'X-Marca-Usuario-Id': 'cms-brand-scope-456',
    'X-Request-Id': 'req-cms-publicaciones-001',
    ...overrides,
  };
}

test('rewriteMarketingPublicacionesPath preserves suffix and query strings', () => {
  assert.equal(rewriteMarketingPublicacionesPath('/', '/marketing/publicaciones/providers', '/v1/providers'), '/v1/providers');
  assert.equal(
    rewriteMarketingPublicacionesPath('/?provider=linkedin', '/marketing/publicaciones/providers', '/v1/providers'),
    '/v1/providers?provider=linkedin',
  );
  assert.equal(
    rewriteMarketingPublicacionesPath('/pubjob_1/cancel', '/marketing/publicaciones/jobs', '/v1/publication-jobs'),
    '/v1/publication-jobs/pubjob_1/cancel',
  );
  assert.equal(
    rewriteMarketingPublicacionesPath('/pubjob_1/admin/cancel', '/marketing/publicaciones/jobs', '/v1/publication-jobs'),
    '/v1/publication-jobs/pubjob_1/admin/cancel',
  );
  assert.equal(
    rewriteMarketingPublicacionesPath('/marketing/publicaciones/jobs/pubjob_1', '/marketing/publicaciones/jobs', '/v1/publication-jobs'),
    '/v1/publication-jobs/pubjob_1',
  );
});

test('authenticated marketing publicaciones routes proxy to /v1 routes with trusted headers', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
    const routes = [
      ['GET', '/marketing/publicaciones/providers', '/v1/providers'],
      ['GET', '/marketing/publicaciones/connections', '/v1/connections'],
      ['GET', '/marketing/publicaciones/analytics/meta/sync?rangeDays=30', '/v1/analytics/meta/sync?rangeDays=30'],
      ['POST', '/marketing/publicaciones/analytics/meta/sync', '/v1/analytics/meta/sync', { rangeDays: 30 }],
      ['GET', '/marketing/publicaciones/jobs/pubjob_1', '/v1/publication-jobs/pubjob_1'],
      ['POST', '/marketing/publicaciones/metrics/sync', '/v1/metrics/sync', { provider: 'linkedin' }],
    ];

    for (const [method, publicPath, , body] of routes) {
      const response = await fetch(`${gatewayBaseUrl}${publicPath}`, {
        method,
        headers: frontendHeaders({}, {
          'X-Service-Token': 'forged-browser-service-token',
          'X-User-Id': 'forged-browser-user',
          'X-Origin-Service': 'forged-origin',
        }),
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(response.status, 200);
    }

    assert.deepEqual(
      received.map((request) => request.url),
      routes.map(([, , expectedInternalPath]) => expectedInternalPath),
    );

    for (const proxied of received) {
      assert.equal(proxied.headers['x-service-token'], MICROSERVICE_TOKEN);
      assert.equal(proxied.headers['x-user-id'], 'frontend-user-123');
      assert.equal(proxied.headers['x-marca-usuario-id'], 'frontend-brand-scope-456');
      assert.equal(proxied.headers['x-request-id'], 'req-marketing-publicaciones-001');
      assert.notEqual(proxied.headers['x-service-token'], 'forged-browser-service-token');
      assert.notEqual(proxied.headers['x-origin-service'], 'forged-origin');
      assert.equal(proxied.headers['x-origin-service'], undefined);
    }
  });
});

test('publication connections auth-url can use selected brand header when JWT has no embedded brand scope', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/connections/auth-url`, {
      method: 'POST',
      headers: frontendHeaders(
        { marca_usuario_id: undefined },
        { 'X-Marca-Usuario-Id': 'selected-brand-scope-789' },
      ),
      body: JSON.stringify({
        provider: 'youtube',
        redirectAfter: '/dashboard/marketing/brands/brand-123#conectar-redes',
        requestedScopes: ['https://www.googleapis.com/auth/youtube.upload'],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].method, 'POST');
    assert.equal(received[0].url, '/v1/connections/auth-url');
    assert.equal(received[0].headers['x-user-id'], 'frontend-user-123');
    assert.equal(received[0].headers['x-marca-usuario-id'], 'selected-brand-scope-789');
    assert.equal(received[0].headers['x-service-token'], MICROSERVICE_TOKEN);
  });
});

test('brand meta token update is rejected because brand configuration belongs to CMS', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/brands/brand-123/meta-token`, {
      method: 'PATCH',
      headers: frontendHeaders({}, {
        'X-Marca-Usuario-Id': 'selected-brand-scope-789',
      }),
      body: JSON.stringify({ keyMeta: 'redacted-meta-token' }),
    });

    assert.equal(response.status, 410);

    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error, 'BRAND_OWNERSHIP_MOVED_TO_CMS');
    assert.equal(body.correctEndpoint, '/marketing/cms/brands/{brandId}');
    assert.equal(body.rule, 'docs/REGLA_DE_ORO_CMS_PUBLICACIONES.md');
    assert.equal(body.requestId, 'req-marketing-publicaciones-001');
    assert.equal(received.length, 0);
  });
});

test('analytics can use selected brand header when JWT has user but no embedded brand scope', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
    const analyticsResponse = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/analytics/meta/sync?rangeDays=30`, {
      method: 'GET',
      headers: frontendHeaders(
        { marca_usuario_id: undefined },
        { 'X-Marca-Usuario-Id': 'selected-brand-scope-789' },
      ),
    });

    assert.equal(analyticsResponse.status, 200);
    assert.equal(received[0].url, '/v1/analytics/meta/sync?rangeDays=30');
    assert.equal(received[0].headers['x-user-id'], 'frontend-user-123');
    assert.equal(received[0].headers['x-marca-usuario-id'], 'selected-brand-scope-789');

    const providersResponse = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/providers`, {
      method: 'GET',
      headers: frontendHeaders(
        { marca_usuario_id: undefined },
        { 'X-Marca-Usuario-Id': 'selected-brand-scope-789' },
      ),
    });

    assert.equal(providersResponse.status, 403);
    assert.equal(received.length, 1);
  });
});

test('publication jobs admin verifier can use selected brand header when JWT has no embedded brand scope', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/jobs/admin/list?status=scheduled&limit=50`, {
      method: 'GET',
      headers: frontendHeaders(
        { marca_usuario_id: undefined },
        { 'X-Marca-Usuario-Id': 'selected-brand-scope-789' },
      ),
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/v1/publication-jobs/admin/list?status=scheduled&limit=50');
    assert.equal(received[0].headers['x-user-id'], 'frontend-user-123');
    assert.equal(received[0].headers['x-marca-usuario-id'], 'selected-brand-scope-789');
    assert.equal(received[0].headers['x-service-token'], MICROSERVICE_TOKEN);
  });
});

test('publication jobs admin dispatch-due can use selected brand header when JWT has no embedded brand scope', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/jobs/admin/dispatch-due?limit=20&lockSeconds=300`, {
      method: 'POST',
      headers: frontendHeaders(
        { marca_usuario_id: undefined },
        { 'X-Marca-Usuario-Id': 'selected-brand-scope-789' },
      ),
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].method, 'POST');
    assert.equal(received[0].url, '/v1/publication-jobs/admin/dispatch-due?limit=20&lockSeconds=300');
    assert.equal(received[0].headers['x-user-id'], 'frontend-user-123');
    assert.equal(received[0].headers['x-marca-usuario-id'], 'selected-brand-scope-789');
    assert.equal(received[0].headers['x-service-token'], MICROSERVICE_TOKEN);
  });
});

test('publication jobs admin retry-now can use selected brand header when JWT has no embedded brand scope', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/jobs/pubjob_youtube_1/admin/retry-now`, {
      method: 'POST',
      headers: frontendHeaders(
        { marca_usuario_id: undefined },
        { 'X-Marca-Usuario-Id': 'selected-brand-scope-789' },
      ),
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].method, 'POST');
    assert.equal(received[0].url, '/v1/publication-jobs/pubjob_youtube_1/admin/retry-now');
    assert.equal(received[0].headers['x-user-id'], 'frontend-user-123');
    assert.equal(received[0].headers['x-marca-usuario-id'], 'selected-brand-scope-789');
    assert.equal(received[0].headers['x-service-token'], MICROSERVICE_TOKEN);
  });
});

test('publication jobs admin cancel can use selected brand header to desprogram retry storms', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/jobs/pubjob_asset_error/admin/cancel`, {
      method: 'POST',
      headers: frontendHeaders(
        { marca_usuario_id: undefined },
        { 'X-Marca-Usuario-Id': 'selected-brand-scope-789' },
      ),
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].method, 'POST');
    assert.equal(received[0].url, '/v1/publication-jobs/pubjob_asset_error/admin/cancel');
    assert.equal(received[0].headers['x-user-id'], 'frontend-user-123');
    assert.equal(received[0].headers['x-marca-usuario-id'], 'selected-brand-scope-789');
    assert.equal(received[0].headers['x-service-token'], MICROSERVICE_TOKEN);
  });
});

test('legacy cms analytics route is orchestrated to micro-publicaciones analytics', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/cms/analytics/meta/sync`, {
      method: 'POST',
      headers: frontendHeaders({}, {
        'X-Service-Token': 'forged-browser-service-token',
        'X-User-Id': 'forged-browser-user',
        'X-Marca-Usuario-Id': 'forged-browser-brand',
      }),
      body: JSON.stringify({ rangeDays: 30, limit: 25 }),
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/v1/analytics/meta/sync');
    assert.equal(received[0].headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(received[0].headers['x-user-id'], 'frontend-user-123');
    assert.equal(received[0].headers['x-marca-usuario-id'], 'frontend-brand-scope-456');
    assert.equal(received[0].headers['x-request-id'], 'req-marketing-publicaciones-001');
    assert.notEqual(received[0].headers['x-service-token'], 'forged-browser-service-token');
  });
});

test('frontend cannot mutate publication jobs directly; micro-cms service requests can', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
    const jobPayload = { publicationId: 1001, networkVariantId: 5001 };

    const browserCreate = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/jobs`, {
      method: 'POST',
      headers: frontendHeaders(),
      body: JSON.stringify(jobPayload),
    });
    const browserRetry = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/jobs/pubjob_1/retry`, {
      method: 'POST',
      headers: frontendHeaders(),
      body: JSON.stringify({}),
    });
    const browserCancel = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/jobs/pubjob_1/cancel`, {
      method: 'POST',
      headers: frontendHeaders(),
      body: JSON.stringify({}),
    });

    assert.equal(browserCreate.status, 401);
    assert.equal(browserRetry.status, 401);
    assert.equal(browserCancel.status, 401);
    assert.equal(received.length, 0);

    const cmsCreate = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/jobs`, {
      method: 'POST',
      headers: cmsHeaders(),
      body: JSON.stringify(jobPayload),
    });
    const cmsRetry = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/jobs/pubjob_1/retry`, {
      method: 'POST',
      headers: cmsHeaders(),
      body: JSON.stringify({}),
    });
    const cmsCancel = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/jobs/pubjob_1/cancel`, {
      method: 'POST',
      headers: cmsHeaders(),
      body: JSON.stringify({}),
    });

    assert.equal(cmsCreate.status, 200);
    assert.equal(cmsRetry.status, 200);
    assert.equal(cmsCancel.status, 200);
    assert.deepEqual(received.map((request) => request.url), [
      '/v1/publication-jobs',
      '/v1/publication-jobs/pubjob_1/retry',
      '/v1/publication-jobs/pubjob_1/cancel',
    ]);

    for (const request of received) {
      assert.equal(request.headers['x-service-token'], MICROSERVICE_TOKEN);
      assert.equal(request.headers['x-origin-service'], 'micro-cms');
      assert.equal(request.headers['x-user-id'], 'cms-user-123');
      assert.equal(request.headers['x-marca-usuario-id'], 'cms-brand-scope-456');
    }
  });
});

test('micro-cms job mutations require origin service and brand scope', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
    const missingOrigin = { ...cmsHeaders(), 'X-Origin-Service': undefined };
    delete missingOrigin['X-Origin-Service'];
    const missingBrand = { ...cmsHeaders(), 'X-Marca-Usuario-Id': undefined };
    delete missingBrand['X-Marca-Usuario-Id'];

    const noOrigin = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/jobs/pubjob_1/retry`, {
      method: 'POST',
      headers: missingOrigin,
      body: JSON.stringify({}),
    });
    const noBrand = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/jobs/pubjob_1/cancel`, {
      method: 'POST',
      headers: missingBrand,
      body: JSON.stringify({}),
    });

    assert.equal(noOrigin.status, 403);
    assert.equal((await noOrigin.json()).error, 'ORIGIN_SERVICE_DENIED');
    assert.equal(noBrand.status, 403);
    assert.equal((await noBrand.json()).error, 'BRAND_SCOPE_DENIED');
    assert.equal(received.length, 0);
  });
});

test('OAuth callbacks and provider webhooks are public controlled routes without JWT', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl, received }) => {
    const oauth = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/oauth/linkedin/callback?state=oauth_state&code=redacted-code`);
    assert.equal(oauth.status, 200);

    const tiktokLegacyOauth = await fetch(`${gatewayBaseUrl}/api/tiktok/oauth/callback?state=oauth_state_tiktok&code=redacted-tiktok-code`);
    assert.equal(tiktokLegacyOauth.status, 200);

    const webhook = await fetch(`${gatewayBaseUrl}/marketing/publicaciones/webhooks/linkedin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-webhook-001' },
      body: JSON.stringify({ event: 'changed' }),
    });
    assert.equal(webhook.status, 200);

    assert.equal(received[0].url, '/v1/oauth/linkedin/callback?state=oauth_state&code=redacted-code');
    assert.equal(received[1].url, '/v1/oauth/tiktok/callback?state=oauth_state_tiktok&code=redacted-tiktok-code');
    assert.equal(received[2].url, '/v1/webhooks/linkedin');
    assert.equal(received[0].headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(received[1].headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(received[2].headers['x-service-token'], MICROSERVICE_TOKEN);
  });
});

test('Gateway status exposes marketing publicaciones routes for discovery', async () => {
  await withMockPublicacionesAndGateway(async ({ gatewayBaseUrl }) => {
    const response = await fetch(`${gatewayBaseUrl}/status`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.services.publicaciones.name, 'micro-publicaciones');
    assert.ok(body.services.publicaciones.routes.includes('/marketing/publicaciones/providers'));
    assert.ok(!body.services.publicaciones.routes.includes('/marketing/publicaciones/brands'));
    assert.ok(body.services.cms.routes.includes('/marketing/cms'));
    assert.ok(body.services.publicaciones.routes.includes('/marketing/publicaciones/jobs'));
  });
});
