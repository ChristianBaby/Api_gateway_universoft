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
const { rewriteMarketingPath } = await import('../src/routes/marketing-editor.routes.js');

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

async function withEnvironment(overrides, run) {
  const previous = new Map(
    Object.keys(overrides).map((name) => [name, process.env[name]]),
  );

  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = String(value);
    }
  }

  try {
    return await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

async function withMockEditorAndGateway(run) {
  const received = [];
  const editorServer = http.createServer(async (req, res) => {
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

  const editorAddress = await listen(editorServer);
  const editorBaseUrl = `http://127.0.0.1:${editorAddress.port}`;

  const previousEditorUrl = process.env.MICRO_EDITOR_IMAGEN_URL;
  process.env.MICRO_EDITOR_IMAGEN_URL = editorBaseUrl;

  const gatewayApp = express();
  gatewayApp.use('/', createRoutes(getServices()));

  const gatewayServer = http.createServer(gatewayApp);
  const gatewayAddress = await listen(gatewayServer);
  const gatewayBaseUrl = `http://127.0.0.1:${gatewayAddress.port}`;

  try {
    await run({ gatewayBaseUrl, editorBaseUrl, received });
  } finally {
    if (previousEditorUrl === undefined) {
      delete process.env.MICRO_EDITOR_IMAGEN_URL;
    } else {
      process.env.MICRO_EDITOR_IMAGEN_URL = previousEditorUrl;
    }
    await close(gatewayServer);
    await close(editorServer);
  }
}

async function withMockEditorCmsAndGateway(run, { wrapCmsWorkspace = false, cmsWorkspacePayload } = {}) {
  const received = [];
  const cmsReceived = [];
  const editorServer = http.createServer(async (req, res) => {
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

  const cmsServer = http.createServer(async (req, res) => {
    const body = await readBody(req);
    cmsReceived.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    });

    const workspacePayload = typeof cmsWorkspacePayload === 'function'
      ? await cmsWorkspacePayload({ req, body, cmsReceived })
      : cmsWorkspacePayload || {
        activeBrandId: 'cms-brand-123',
        brands: [
          {
            brand: { id: 'cms-brand-123', nombre: 'Avanzik' },
            brandUser: { id: 'cms-brand-scope-456', puedeEditarMarca: true },
          },
        ],
      };

    if (workspacePayload?.status) {
      res.writeHead(workspacePayload.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(workspacePayload.body || { success: false }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(wrapCmsWorkspace ? { success: true, data: workspacePayload } : workspacePayload));
  });

  const editorAddress = await listen(editorServer);
  const cmsAddress = await listen(cmsServer);
  const editorBaseUrl = `http://127.0.0.1:${editorAddress.port}`;
  const cmsBaseUrl = `http://127.0.0.1:${cmsAddress.port}`;

  const previousEditorUrl = process.env.MICRO_EDITOR_IMAGEN_URL;
  const previousCmsUrl = process.env.CMS_SERVICE_URL;
  process.env.MICRO_EDITOR_IMAGEN_URL = editorBaseUrl;
  process.env.CMS_SERVICE_URL = cmsBaseUrl;

  const gatewayApp = express();
  gatewayApp.use('/', createRoutes(getServices()));

  const gatewayServer = http.createServer(gatewayApp);
  const gatewayAddress = await listen(gatewayServer);
  const gatewayBaseUrl = `http://127.0.0.1:${gatewayAddress.port}`;

  try {
    await run({ gatewayBaseUrl, editorBaseUrl, cmsBaseUrl, received, cmsReceived });
  } finally {
    if (previousEditorUrl === undefined) {
      delete process.env.MICRO_EDITOR_IMAGEN_URL;
    } else {
      process.env.MICRO_EDITOR_IMAGEN_URL = previousEditorUrl;
    }
    if (previousCmsUrl === undefined) {
      delete process.env.CMS_SERVICE_URL;
    } else {
      process.env.CMS_SERVICE_URL = previousCmsUrl;
    }
    await close(gatewayServer);
    await close(editorServer);
    await close(cmsServer);
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
    'X-Request-Id': 'req-marketing-editor-001',
    ...overrides,
  };
}

test('rewriteMarketingPath preserves suffix and query strings for mounted routes', () => {
  assert.equal(rewriteMarketingPath('/', '/marketing/templates', '/v1/templates'), '/v1/templates');
  assert.equal(rewriteMarketingPath('/?tipo=post', '/marketing/templates', '/v1/templates'), '/v1/templates?tipo=post');
  assert.equal(rewriteMarketingPath('/42/draft', '/marketing/design-documents', '/v1/design-documents'), '/v1/design-documents/42/draft');
  assert.equal(
    rewriteMarketingPath('/42/draft?include=layers', '/marketing/design-documents', '/v1/design-documents'),
    '/v1/design-documents/42/draft?include=layers',
  );
  assert.equal(
    rewriteMarketingPath('/marketing/templates?tipo=post', '/marketing/templates', '/v1/templates'),
    '/v1/templates?tipo=post',
  );
  assert.equal(
    rewriteMarketingPath('/marketing/design-documents/42/draft', '/marketing/design-documents', '/v1/design-documents'),
    '/v1/design-documents/42/draft',
  );
  assert.equal(
    rewriteMarketingPath(
      '/marketing/external-assets/youtube-audio/references/77',
      '/marketing/external-assets/youtube-audio',
      '/v1/external-assets/youtube-audio',
    ),
    '/v1/external-assets/youtube-audio/references/77',
  );
});

test('frontend marketing routes proxy through Gateway to micro-editor /v1 routes', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
    const routes = [
      ['GET', '/marketing/templates?tipo=post', '/v1/templates?tipo=post'],
      ['GET', '/marketing/resources/15?kind=image', '/v1/resources/15?kind=image'],
      ['GET', '/marketing/resources/15/file', '/v1/resources/15/file'],
      ['GET', '/marketing/resources/15/runtime-url', '/v1/resources/15/runtime-url'],
      [
        'GET',
        '/marketing/external-assets/vecteezy/search?query=banners&contentType=svg&license=free',
        '/v1/external-assets/vecteezy/search?query=banners&contentType=svg&license=free',
      ],
      [
        'GET',
        '/marketing/external-assets/pexels/videos/search?query=business&orientation=portrait&perPage=12',
        '/v1/external-assets/pexels/videos/search?query=business&orientation=portrait&perPage=12',
      ],
      [
        'GET',
        '/marketing/external-assets/pexels/images/search?query=marketing&orientation=landscape&perPage=24',
        '/v1/external-assets/pexels/images/search?query=marketing&orientation=landscape&perPage=24',
      ],
      [
        'POST',
        '/marketing/external-assets/pexels/import',
        '/v1/external-assets/pexels/import',
        { providerAssetId: '2014422', contentType: 'image', usageScope: 'brand-gallery' },
      ],
      [
        'POST',
        '/marketing/external-assets/youtube-audio/references',
        '/v1/external-assets/youtube-audio/references',
        {
          sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
          rightsAttestation: {
            statementVersion: 'youtube-audio-rights-v1',
            rightsBasis: 'licensed',
            contentRightsConfirmed: true,
            providerAuthorizationConfirmed: true,
          },
        },
      ],
      [
        'POST',
        '/marketing/external-assets/youtube-audio/references/77/materialize',
        '/v1/external-assets/youtube-audio/references/77/materialize',
        {},
      ],
      [
        'GET',
        '/marketing/external-assets/youtube-audio/references/77',
        '/v1/external-assets/youtube-audio/references/77',
      ],
      [
        'GET',
        '/marketing/external-assets/iconify/search?query=rocket&collection=fluent-emoji&limit=24',
        '/v1/external-assets/iconify/search?query=rocket&collection=fluent-emoji&limit=24',
      ],
      [
        'POST',
        '/marketing/external-assets/vecteezy/import',
        '/v1/external-assets/vecteezy/import',
        {
          providerAssetId: 'banner-1',
          projectPostStudioId: 42,
          licenseAcceptance: { accepted: true, attributionAcknowledged: true },
        },
      ],
      ['GET', '/marketing/output-presets?network=instagram', '/v1/output-presets?network=instagram'],
      ['GET', '/marketing/fonts', '/v1/fonts'],
      ['POST', '/marketing/design-documents', '/v1/design-documents', { contentPieceId: 123 }],
      [
        'POST',
        '/marketing/design-documents/standalone',
        '/v1/design-documents/standalone',
        {
          name: 'Proyecto independiente',
          canvas: { width: 1080, height: 1080, background: '#ffffff' },
          metadata: { source: 'gateway-contract-test' },
        },
      ],
      ['GET', '/marketing/design-documents?standaloneOnly=true&limit=24', '/v1/design-documents?standaloneOnly=true&limit=24'],
      ['DELETE', '/marketing/design-documents/42', '/v1/design-documents/42'],
      ['GET', '/marketing/design-documents/42/draft', '/v1/design-documents/42/draft'],
      ['POST', '/marketing/design-documents/42/preview', '/v1/design-documents/42/preview'],
      [
        'PATCH',
        '/marketing/design-documents/42/draft',
        '/v1/design-documents/42/draft',
        {
          baseRevision: 1,
          clientMutationId: 'mutation-123',
          operationType: 'update_document',
          document: { schemaVersion: '1.0', canvas: { width: 1080, height: 1080 }, layers: [], components: [] },
        },
      ],
      ['GET', '/marketing/exports/92/file', '/v1/exports/92/file'],
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

test('Gateway preserves multipart/form-data for resource uploads', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
    const form = new FormData();
    form.append('file', new Blob(['fake-image-bytes'], { type: 'image/png' }), 'logo.png');
    form.append('assetRole', 'image');
    form.append('source', 'editor-video-upload');

    const response = await fetch(`${gatewayBaseUrl}/marketing/resources/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${frontendJwt()}`,
        'X-Request-Id': 'req-marketing-editor-upload-001',
      },
      body: form,
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);
    const proxied = received[0];
    assert.equal(proxied.method, 'POST');
    assert.equal(proxied.url, '/v1/resources/upload');
    assert.match(proxied.headers['content-type'], /^multipart\/form-data; boundary=/);
    assert.doesNotMatch(proxied.headers['content-type'], /^application\/json/);
    assert.match(proxied.body, /name="file"/);
    assert.match(proxied.body, /filename="logo\.png"/);
    assert.match(proxied.body, /name="assetRole"/);
    assert.match(proxied.body, /editor-video-upload/);
    assert.equal(proxied.headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(proxied.headers['x-marca-usuario-id'], 'frontend-brand-scope-456');
    assert.equal(proxied.headers['x-user-id'], 'frontend-user-123');
  });
});

test('Gateway preserves catalog preview list query and overwrites browser-forged trusted headers', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/design-documents?standaloneOnly=true&limit=24`, {
      headers: frontendHeaders(
        {},
        {
          'X-Service-Token': 'forged-browser-service-token',
          'X-User-Id': 'forged-browser-user',
          'X-User-Email': 'forged-browser@example.test',
          'X-Marca-Usuario-Id': 'forged-browser-brand',
          'X-Request-Id': 'forged-browser-request-id',
        },
      ),
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);

    const proxied = received[0];
    assert.equal(proxied.method, 'GET');
    assert.equal(proxied.url, '/v1/design-documents?standaloneOnly=true&limit=24');
    assert.equal(proxied.headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(proxied.headers['x-user-id'], 'frontend-user-123');
    assert.equal(proxied.headers['x-user-email'], undefined);
    assert.equal(proxied.headers['x-marca-usuario-id'], 'frontend-brand-scope-456');
    assert.equal(proxied.headers['x-marketing-brand-user-id'], undefined);
    assert.equal(proxied.headers['x-active-marca-usuario-id'], undefined);
    assert.match(proxied.headers['x-request-id'], /^gw-editor-/);
    assert.notEqual(proxied.headers['x-service-token'], 'forged-browser-service-token');
    assert.notEqual(proxied.headers['x-user-id'], 'forged-browser-user');
    assert.notEqual(proxied.headers['x-user-email'], 'forged-browser@example.test');
    assert.notEqual(proxied.headers['x-marca-usuario-id'], 'forged-browser-brand');
    assert.notEqual(proxied.headers['x-request-id'], 'forged-browser-request-id');
  });
});

test('Gateway injects trusted service and identity headers instead of browser-forged values', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/exports`, {
      method: 'POST',
      headers: frontendHeaders(
        {},
        {
          'X-Service-Token': 'forged-browser-service-token',
          'X-User-Id': 'forged-browser-user',
          'X-User-Email': 'forged-browser@example.test',
          'X-Marca-Usuario-Id': 'forged-browser-brand',
          'X-Request-Id': 'forged-browser-request-id',
        },
      ),
      body: JSON.stringify({ projectPostStudioId: 42, formato: 'svg' }),
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);

    const proxied = received[0];
    assert.equal(proxied.method, 'POST');
    assert.equal(proxied.url, '/v1/exports');
    assert.equal(proxied.headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(proxied.headers['x-user-id'], 'frontend-user-123');
    assert.equal(proxied.headers['x-user-email'], undefined);
    assert.equal(proxied.headers['x-marca-usuario-id'], 'frontend-brand-scope-456');
    assert.match(proxied.headers['x-request-id'], /^gw-editor-/);
    assert.notEqual(proxied.headers['x-service-token'], 'forged-browser-service-token');
    assert.notEqual(proxied.headers['x-user-id'], 'forged-browser-user');
    assert.notEqual(proxied.headers['x-user-email'], 'forged-browser@example.test');
    assert.notEqual(proxied.headers['x-marca-usuario-id'], 'forged-browser-brand');
    assert.notEqual(proxied.headers['x-request-id'], 'forged-browser-request-id');
    assert.notEqual(proxied.headers['x-request-id'], 'req-marketing-editor-001');
    assert.equal(proxied.body, JSON.stringify({ projectPostStudioId: 42, formato: 'svg' }));
  });
});

test('YouTube audio proxy requires JWT and replaces browser-forged trusted headers', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
    const withoutAuth = await fetch(
      `${gatewayBaseUrl}/marketing/external-assets/youtube-audio/references/77`,
    );
    assert.equal(withoutAuth.status, 401);
    assert.equal(received.length, 0);

    const body = {
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      rightsAttestation: {
        statementVersion: 'youtube-audio-rights-v1',
        rightsBasis: 'owned',
        contentRightsConfirmed: true,
        providerAuthorizationConfirmed: true,
      },
    };
    const response = await fetch(
      `${gatewayBaseUrl}/marketing/external-assets/youtube-audio/references`,
      {
        method: 'POST',
        headers: frontendHeaders(
          {},
          {
            'X-Service-Token': 'forged-browser-service-token',
            'X-User-Id': 'forged-browser-user',
            'X-User-Email': 'forged-browser@example.test',
            'X-Marca-Usuario-Id': 'forged-browser-brand',
            'X-Request-Id': 'forged-browser-request-id',
          },
        ),
        body: JSON.stringify(body),
      },
    );

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);

    const proxied = received[0];
    assert.equal(proxied.url, '/v1/external-assets/youtube-audio/references');
    assert.equal(proxied.body, JSON.stringify(body));
    assert.equal(proxied.headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(proxied.headers['x-user-id'], 'frontend-user-123');
    assert.equal(proxied.headers['x-user-email'], undefined);
    assert.equal(proxied.headers['x-marca-usuario-id'], 'frontend-brand-scope-456');
    assert.match(proxied.headers['x-request-id'], /^gw-editor-/);
    assert.equal(proxied.headers.authorization, undefined);
    assert.equal(proxied.headers.cookie, undefined);
    assert.equal(proxied.headers['proxy-authorization'], undefined);
    assert.notEqual(proxied.headers['x-service-token'], 'forged-browser-service-token');
    assert.notEqual(proxied.headers['x-user-id'], 'forged-browser-user');
    assert.notEqual(proxied.headers['x-marca-usuario-id'], 'forged-browser-brand');
    assert.notEqual(proxied.headers['x-request-id'], 'forged-browser-request-id');
  });
});

test('YouTube audio POST guard requires bounded JSON before proxying', async () => {
  await withEnvironment(
    { YOUTUBE_AUDIO_GATEWAY_MAX_JSON_BYTES: '128' },
    async () => withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
      const wrongContentType = await fetch(
        `${gatewayBaseUrl}/marketing/external-assets/youtube-audio/references`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${frontendJwt()}`,
            'Content-Type': 'text/plain',
          },
          body: '{}',
        },
      );
      assert.equal(wrongContentType.status, 415);
      assert.equal((await wrongContentType.json()).error, 'YOUTUBE_AUDIO_JSON_REQUIRED');

      const oversized = await fetch(
        `${gatewayBaseUrl}/marketing/external-assets/youtube-audio/references`,
        {
          method: 'POST',
          headers: frontendHeaders(),
          body: JSON.stringify({ sourceUrl: `https://youtu.be/${'x'.repeat(256)}` }),
        },
      );
      assert.equal(oversized.status, 413);
      assert.equal((await oversized.json()).error, 'YOUTUBE_AUDIO_PAYLOAD_TOO_LARGE');
      assert.equal(received.length, 0);
    }),
  );
});

test('YouTube audio cost limiter counts POST by trusted user and leaves status polling open', async () => {
  await withEnvironment(
    {
      YOUTUBE_AUDIO_GATEWAY_RATE_LIMIT_MAX: '1',
      YOUTUBE_AUDIO_GATEWAY_RATE_LIMIT_WINDOW_MS: '60000',
    },
    async () => withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
      const registrationBody = JSON.stringify({
        sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
        rightsAttestation: {
          statementVersion: 'youtube-audio-rights-v1',
          rightsBasis: 'owned',
          contentRightsConfirmed: true,
          providerAuthorizationConfirmed: true,
        },
      });

      const first = await fetch(
        `${gatewayBaseUrl}/marketing/external-assets/youtube-audio/references`,
        {
          method: 'POST',
          headers: frontendHeaders(),
          body: registrationBody,
        },
      );
      assert.equal(first.status, 200);

      const limited = await fetch(
        `${gatewayBaseUrl}/marketing/external-assets/youtube-audio/references/77/materialize`,
        {
          method: 'POST',
          headers: frontendHeaders(),
          body: JSON.stringify({}),
        },
      );
      assert.equal(limited.status, 429);
      assert.equal((await limited.json()).error, 'YOUTUBE_AUDIO_RATE_LIMITED');

      const statusPoll = await fetch(
        `${gatewayBaseUrl}/marketing/external-assets/youtube-audio/references/77`,
        { headers: frontendHeaders() },
      );
      assert.equal(statusPoll.status, 200);

      const otherUser = await fetch(
        `${gatewayBaseUrl}/marketing/external-assets/youtube-audio/references`,
        {
          method: 'POST',
          headers: frontendHeaders({ user_id: 'other-frontend-user-789' }),
          body: registrationBody,
        },
      );
      assert.equal(otherUser.status, 200);

      assert.deepEqual(
        received.map(({ url }) => url),
        [
          '/v1/external-assets/youtube-audio/references',
          '/v1/external-assets/youtube-audio/references/77',
          '/v1/external-assets/youtube-audio/references',
        ],
      );
      assert.equal(received.at(-1).headers['x-user-id'], 'other-frontend-user-789');
    }),
  );
});

test('Gateway keeps /marketing/resources brand-scoped and ignores browser-forged brand headers', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/resources?kind=image`, {
      headers: frontendHeaders(
        {},
        {
          'X-Service-Token': 'forged-browser-service-token',
          'X-Marca-Usuario-Id': 'forged-browser-brand',
          'X-User-Id': 'forged-browser-user',
        },
      ),
    });

    assert.equal(response.status, 200);
    const proxied = received.at(-1);
    assert.equal(proxied.method, 'GET');
    assert.equal(proxied.url, '/v1/resources?kind=image');
    assert.equal(proxied.headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(proxied.headers['x-marca-usuario-id'], 'frontend-brand-scope-456');
    assert.equal(proxied.headers['x-user-id'], 'frontend-user-123');
    assert.notEqual(proxied.headers['x-service-token'], 'forged-browser-service-token');
    assert.notEqual(proxied.headers['x-marca-usuario-id'], 'forged-browser-brand');
    assert.notEqual(proxied.headers['x-user-id'], 'forged-browser-user');
  });
});

test('Gateway blocks email-only JWTs for brand-scoped standalone project catalog', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
    const token = frontendJwt({
      user_id: undefined,
      id: undefined,
      sub: undefined,
      marca_usuario_id: undefined,
      marcaUsuarioId: undefined,
      email: 'marketing@ruwark.com',
    });
    const response = await fetch(`${gatewayBaseUrl}/marketing/design-documents?standaloneOnly=true&limit=3`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-User-Email': 'forged-browser@example.test',
      },
    });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'BRAND_SCOPE_DENIED');
    assert.equal(received.length, 0);
  });
});

test('Gateway blocks design document workspace routes without trusted brand scope', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
    const withoutAuth = await fetch(`${gatewayBaseUrl}/marketing/templates`);
    assert.equal(withoutAuth.status, 401);

    const standaloneWithoutBrand = await fetch(`${gatewayBaseUrl}/marketing/design-documents/standalone`, {
      method: 'POST',
      headers: {
        ...frontendHeaders({ marca_usuario_id: undefined, marcaUsuarioId: undefined }),
        'X-Marca-Usuario-Id': 'forged-browser-brand',
      },
      body: JSON.stringify({ name: 'Proyecto sin marca', metadata: { source: 'test' } }),
    });
    assert.equal(standaloneWithoutBrand.status, 403);
    assert.equal((await standaloneWithoutBrand.json()).error, 'BRAND_SCOPE_DENIED');
    assert.equal(received.length, 0);

    const summaryWithoutBrand = await fetch(`${gatewayBaseUrl}/marketing/design-documents/42`, {
      headers: frontendHeaders({ marca_usuario_id: undefined, marcaUsuarioId: undefined }),
    });
    assert.equal(summaryWithoutBrand.status, 403);
    assert.equal(received.length, 0);

    const deleteWithoutBrand = await fetch(`${gatewayBaseUrl}/marketing/design-documents/42`, {
      method: 'DELETE',
      headers: frontendHeaders({ marca_usuario_id: undefined, marcaUsuarioId: undefined }),
    });
    assert.equal(deleteWithoutBrand.status, 403);
    assert.equal(received.length, 0);

    const draftWithoutBrand = await fetch(`${gatewayBaseUrl}/marketing/design-documents/42/draft`, {
      method: 'PATCH',
      headers: frontendHeaders({ marca_usuario_id: undefined, marcaUsuarioId: undefined }),
      body: JSON.stringify({
        baseRevision: 1,
        clientMutationId: 'mutation-user-only-1',
        operationType: 'update_document',
        document: {
          schemaVersion: '1.0',
          canvas: { width: 1080, height: 1080 },
          layers: [{ uid: 'layer-1', components: [{ uid: 'component-1', type: 'text' }] }],
        },
      }),
    });
    assert.equal(draftWithoutBrand.status, 403);
    assert.equal(received.length, 0);

    const validateWithoutBrand = await fetch(`${gatewayBaseUrl}/marketing/design-documents/42/validate`, {
      method: 'POST',
      headers: frontendHeaders({ marca_usuario_id: undefined, marcaUsuarioId: undefined }),
    });
    assert.equal(validateWithoutBrand.status, 403);
    assert.equal(received.length, 0);

    const previewWithoutBrand = await fetch(`${gatewayBaseUrl}/marketing/design-documents/42/preview`, {
      method: 'POST',
      headers: frontendHeaders({ marca_usuario_id: undefined, marcaUsuarioId: undefined }),
    });
    assert.equal(previewWithoutBrand.status, 403);
    assert.equal(received.length, 0);

    const presetsWithoutBrand = await fetch(`${gatewayBaseUrl}/marketing/output-presets?network=instagram`, {
      headers: frontendHeaders({ marca_usuario_id: undefined, marcaUsuarioId: undefined }),
    });
    assert.equal(presetsWithoutBrand.status, 403);
    assert.equal(received.length, 0);

    const catalogWithoutBrand = await fetch(`${gatewayBaseUrl}/marketing/templates`, {
      headers: {
        Authorization: `Bearer ${frontendJwt({ marca_usuario_id: undefined, marcaUsuarioId: undefined })}`,
      },
    });
    assert.equal(catalogWithoutBrand.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received.at(-1).url, '/v1/templates');
    assert.equal(received.at(-1).headers['x-marca-usuario-id'], undefined);

    const linkedDocumentWithoutBrand = await fetch(`${gatewayBaseUrl}/marketing/design-documents`, {
      method: 'POST',
      headers: frontendHeaders({ marca_usuario_id: undefined, marcaUsuarioId: undefined }),
      body: JSON.stringify({ contentPieceId: 123 }),
    });
    assert.equal(linkedDocumentWithoutBrand.status, 403);
    assert.equal(received.length, 1);
  });
});

test('Gateway blocks design-documents but keeps user-scoped exports open when requested brand is not in CMS workspace', async () => {
  await withMockEditorCmsAndGateway(async ({ gatewayBaseUrl, received, cmsReceived }) => {
    const headers = frontendHeaders(
      {
        marca_usuario_id: undefined,
        marcaUsuarioId: undefined,
        email: 'marketing@ruwark.com',
      },
      {
        'X-Marketing-Brand-User-Id': 'missing-brand-scope-999',
        'X-Marca-Usuario-Id': 'forged-browser-brand',
      },
    );

    const draft = await fetch(`${gatewayBaseUrl}/marketing/design-documents/42/draft`, { headers });
    assert.equal(draft.status, 403);
    assert.equal(received.length, 0);

    const exportsResponse = await fetch(`${gatewayBaseUrl}/marketing/exports`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ projectPostStudioId: 42, formato: 'svg' }),
    });
    assert.equal(exportsResponse.status, 200);
    assert.equal(received.at(-1).url, '/v1/exports');
    assert.equal(received.at(-1).headers['x-user-id'], 'frontend-user-123');
    assert.equal(received.at(-1).headers['x-user-email'], 'marketing@ruwark.com');
    assert.equal(received.at(-1).headers['x-marca-usuario-id'], undefined);
    assert.equal(received.at(-1).headers['x-marketing-brand-user-id'], undefined);
    assert.equal(received.at(-1).body, JSON.stringify({ projectPostStudioId: 42, formato: 'svg' }));

    assert.equal(cmsReceived.length, 4);
    for (const workspaceRequest of cmsReceived) {
      assert.equal(workspaceRequest.url, '/marketing/cms/workspace');
      assert.equal(workspaceRequest.headers['x-service-token'], MICROSERVICE_TOKEN);
      assert.equal(workspaceRequest.headers['x-user-id'], 'frontend-user-123');
      assert.equal(workspaceRequest.headers['x-user-email'], 'marketing@ruwark.com');
    }
    assert.equal(cmsReceived[0].headers['x-marca-usuario-id'], undefined);
    assert.equal(cmsReceived[1].headers['x-marca-usuario-id'], 'missing-brand-scope-999');
    assert.equal(cmsReceived[2].headers['x-marca-usuario-id'], undefined);
    assert.equal(cmsReceived[3].headers['x-marca-usuario-id'], 'missing-brand-scope-999');
  });
});

test('Gateway keeps global template catalog readable when requested brand is not in CMS workspace', async () => {
  await withMockEditorCmsAndGateway(async ({ gatewayBaseUrl, received, cmsReceived }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/templates?tipo=post`, {
      headers: frontendHeaders(
        {
          marca_usuario_id: undefined,
          marcaUsuarioId: undefined,
          email: 'marketing@ruwark.com',
        },
        {
          'X-Marketing-Brand-User-Id': 'missing-brand-scope-999',
          'X-Marca-Usuario-Id': 'forged-browser-brand',
        },
      ),
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received.at(-1).url, '/v1/templates?tipo=post');
    assert.equal(received.at(-1).headers['x-marca-usuario-id'], undefined);
    assert.equal(cmsReceived.length, 2);
    assert.equal(cmsReceived[0].url, '/marketing/cms/workspace');
    assert.equal(cmsReceived[0].headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(cmsReceived[0].headers['x-marca-usuario-id'], undefined);
    assert.equal(cmsReceived[1].url, '/marketing/cms/workspace');
    assert.equal(cmsReceived[1].headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(cmsReceived[1].headers['x-marca-usuario-id'], 'missing-brand-scope-999');
  });
});

test('Gateway still requires trusted brand scope for template mutations', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
    const createWithoutBrand = await fetch(`${gatewayBaseUrl}/marketing/templates`, {
      method: 'POST',
      headers: frontendHeaders({ marca_usuario_id: undefined, marcaUsuarioId: undefined }),
      body: JSON.stringify({
        nombre: 'Plantilla global',
        document: {
          schemaVersion: '1.0',
          canvas: { width: 1080, height: 1080 },
          layers: [],
        },
      }),
    });

    assert.equal(createWithoutBrand.status, 403);
    assert.equal((await createWithoutBrand.json()).error, 'BRAND_SCOPE_DENIED');
    assert.equal(received.length, 0);
  });
});

test('Gateway falls back to requested CMS workspace only when it belongs to authenticated user', async () => {
  await withMockEditorCmsAndGateway(async ({ gatewayBaseUrl, received, cmsReceived }) => {
    const headers = frontendHeaders(
      {
        marca_usuario_id: undefined,
        marcaUsuarioId: undefined,
        email: 'marketing@ruwark.com',
      },
      {
        'X-Marketing-Brand-User-Id': 'requested-brand-scope-777',
        'X-Marca-Usuario-Id': 'forged-browser-brand',
      },
    );

    const response = await fetch(`${gatewayBaseUrl}/marketing/templates`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        nombre: 'Plantilla solicitada',
        document: {
          schemaVersion: '1.0',
          canvas: { width: 1080, height: 1080 },
          layers: [],
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(received.at(-1).url, '/v1/templates');
    assert.equal(received.at(-1).headers['x-marca-usuario-id'], 'requested-brand-scope-777');
    assert.equal(received.at(-1).headers['x-user-id'], 'frontend-user-123');
    assert.equal(received.at(-1).headers['x-user-email'], 'marketing@ruwark.com');
    assert.equal(received.at(-1).headers['x-marketing-brand-user-id'], undefined);
    assert.notEqual(received.at(-1).headers['x-marca-usuario-id'], 'forged-browser-brand');

    assert.equal(cmsReceived.length, 2);
    assert.equal(cmsReceived[0].headers['x-marca-usuario-id'], undefined);
    assert.equal(cmsReceived[1].headers['x-marca-usuario-id'], 'requested-brand-scope-777');
  }, {
    cmsWorkspacePayload: ({ req }) => (req.headers['x-marca-usuario-id']
      ? {
        user: { id: 'frontend-user-123', email: 'marketing@ruwark.com' },
        activeBrandId: 'requested-cms-brand-777',
        brands: [
          {
            brand: { id: 'requested-cms-brand-777', nombre: 'Marca solicitada' },
            brandUser: { id: 'requested-brand-scope-777', usuarioId: 'frontend-user-123', puedeEditarMarca: true },
          },
        ],
      }
      : { status: 404, body: { success: false, error: 'WORKSPACE_NOT_FOUND' } }),
  });
});

test('Gateway rejects requested CMS workspace fallback when it belongs to another user', async () => {
  await withMockEditorCmsAndGateway(async ({ gatewayBaseUrl, received, cmsReceived }) => {
    const headers = frontendHeaders(
      {
        marca_usuario_id: undefined,
        marcaUsuarioId: undefined,
        email: 'marketing@ruwark.com',
      },
      {
        'X-Marketing-Brand-User-Id': 'requested-brand-scope-888',
        'X-Marca-Usuario-Id': 'forged-browser-brand',
      },
    );

    const response = await fetch(`${gatewayBaseUrl}/marketing/templates`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        nombre: 'Plantilla ajena',
        document: {
          schemaVersion: '1.0',
          canvas: { width: 1080, height: 1080 },
          layers: [],
        },
      }),
    });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'BRAND_SCOPE_DENIED');
    assert.equal(received.length, 0);
    assert.equal(cmsReceived.length, 2);
    assert.equal(cmsReceived[1].headers['x-marca-usuario-id'], 'requested-brand-scope-888');
  }, {
    cmsWorkspacePayload: ({ req }) => (req.headers['x-marca-usuario-id']
      ? {
        user: { id: 'frontend-user-123', email: 'marketing@ruwark.com' },
        activeBrandId: 'requested-cms-brand-888',
        brands: [
          {
            brand: { id: 'requested-cms-brand-888', nombre: 'Marca ajena' },
            brandUser: { id: 'requested-brand-scope-888', usuarioId: 'other-user-999', puedeEditarMarca: true },
          },
        ],
      }
      : { status: 404, body: { success: false, error: 'WORKSPACE_NOT_FOUND' } }),
  });
});

test('Gateway verifies requested brand and propagates it for standalone preset creation', async () => {
  await withMockEditorCmsAndGateway(async ({ gatewayBaseUrl, received, cmsReceived }) => {
    const headers = {
      Authorization: `Bearer ${frontendJwt({
        marca_usuario_id: undefined,
        marcaUsuarioId: undefined,
        email: 'marketing@ruwark.com',
      })}`,
      'Content-Type': 'application/json',
      'X-Marketing-Brand-User-Id': 'cms-brand-scope-456',
      'X-Marca-Usuario-Id': 'forged-browser-brand',
    };

    const response = await fetch(`${gatewayBaseUrl}/marketing/design-documents/standalone`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Proyecto con preset de marca',
        formatPresetId: 704637912730421,
        canvas: { width: 1080, height: 1080 },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(received.at(-1).url, '/v1/design-documents/standalone');
    assert.equal(received.at(-1).headers['x-marca-usuario-id'], 'cms-brand-scope-456');
    assert.equal(received.at(-1).headers['x-user-id'], 'frontend-user-123');
    assert.equal(received.at(-1).headers['x-user-email'], 'marketing@ruwark.com');
    assert.equal(received.at(-1).headers['x-marketing-brand-user-id'], undefined);
    assert.notEqual(received.at(-1).headers['x-marca-usuario-id'], 'forged-browser-brand');
    assert.equal(cmsReceived.length, 1);
    assert.equal(cmsReceived[0].url, '/marketing/cms/workspace');
  });
});

test('Gateway resolves active CMS workspace brand for editor catalogs when JWT has no marca_usuario_id', async () => {
  await withMockEditorCmsAndGateway(async ({ gatewayBaseUrl, received, cmsReceived }) => {
    const headers = {
      Authorization: `Bearer ${frontendJwt({
        marca_usuario_id: undefined,
        marcaUsuarioId: undefined,
        email: 'marketing@ruwark.com',
      })}`,
      'X-Marketing-Brand-User-Id': 'cms-brand-scope-456',
      'X-Marca-Usuario-Id': 'forged-browser-brand',
    };

    const templates = await fetch(`${gatewayBaseUrl}/marketing/templates?tipo=post`, { headers });
    assert.equal(templates.status, 200);
    assert.equal(received.at(-1).url, '/v1/templates?tipo=post');
    assert.equal(received.at(-1).headers['x-marca-usuario-id'], 'cms-brand-scope-456');
    assert.equal(received.at(-1).headers['x-user-id'], 'frontend-user-123');
    assert.equal(received.at(-1).headers['x-user-email'], 'marketing@ruwark.com');
    assert.equal(received.at(-1).headers['x-marketing-brand-user-id'], undefined);
    assert.notEqual(received.at(-1).headers['x-marca-usuario-id'], 'forged-browser-brand');

    const presets = await fetch(`${gatewayBaseUrl}/marketing/output-presets?network=instagram`, { headers });
    assert.equal(presets.status, 200);
    assert.equal(received.at(-1).url, '/v1/output-presets?network=instagram');
    assert.equal(received.at(-1).headers['x-marca-usuario-id'], 'cms-brand-scope-456');

    assert.equal(cmsReceived.length, 2);
    for (const workspaceRequest of cmsReceived) {
      assert.equal(workspaceRequest.url, '/marketing/cms/workspace');
      assert.equal(workspaceRequest.headers['x-service-token'], MICROSERVICE_TOKEN);
      assert.equal(workspaceRequest.headers['x-user-id'], 'frontend-user-123');
      assert.equal(workspaceRequest.headers['x-user-email'], 'marketing@ruwark.com');
      assert.equal(workspaceRequest.headers['x-request-id']?.startsWith('gw-editor-'), true);
    }
  });
});

test('Gateway resolves editor brand scope from wrapped CMS workspace responses', async () => {
  await withMockEditorCmsAndGateway(async ({ gatewayBaseUrl, received, cmsReceived }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/resources?kind=image`, {
      headers: frontendHeaders({ marca_usuario_id: undefined, marcaUsuarioId: undefined }),
    });

    assert.equal(response.status, 200);
    assert.equal(received.at(-1).url, '/v1/resources?kind=image');
    assert.equal(received.at(-1).headers['x-marca-usuario-id'], 'cms-brand-scope-456');
    assert.equal(cmsReceived.length, 1);
  }, { wrapCmsWorkspace: true });
});

test('Gateway status exposes marketing editor routes for frontend discovery', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl }) => {
    const response = await fetch(`${gatewayBaseUrl}/status`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.services.editorImagen.name, 'micro-editor-imagen');
    assert.ok(body.services.editorImagen.routes.includes('/marketing/templates'));
    assert.ok(body.services.editorImagen.routes.includes('/marketing/exports'));
    assert.ok(body.services.editorImagen.routes.includes('/marketing/external-assets/vecteezy'));
    assert.ok(body.services.editorImagen.routes.includes('/marketing/external-assets/pexels'));
    assert.ok(body.services.editorImagen.routes.includes('/marketing/external-assets/youtube-audio'));
    assert.ok(body.services.editorImagen.routes.includes('/marketing/external-assets/iconify'));
  });
});

test('Gateway route documentation inventories external asset providers', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl }) => {
    const documentationResponse = await fetch(`${gatewayBaseUrl}/`);
    assert.equal(documentationResponse.status, 200);

    const documentation = await documentationResponse.json();
    assert.deepEqual(documentation.endpoints.marketingEditor.externalAssets, {
      vecteezy: '/marketing/external-assets/vecteezy',
      pexels: '/marketing/external-assets/pexels',
      youtubeAudio: '/marketing/external-assets/youtube-audio',
      iconify: '/marketing/external-assets/iconify',
    });

    const notFoundResponse = await fetch(`${gatewayBaseUrl}/route-that-does-not-exist`);
    assert.equal(notFoundResponse.status, 404);

    const notFound = await notFoundResponse.json();
    assert.ok(notFound.availableRoutes.marketing.includes('/marketing/external-assets/vecteezy/*'));
    assert.ok(notFound.availableRoutes.marketing.includes('/marketing/external-assets/pexels/*'));
    assert.ok(notFound.availableRoutes.marketing.includes('/marketing/external-assets/youtube-audio/*'));
    assert.ok(notFound.availableRoutes.marketing.includes('/marketing/external-assets/iconify/*'));
  });
});


test('external assets route works without active brand but still injects trusted user scope', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/external-assets/vecteezy/search?query=banners`, {
      headers: frontendHeaders({ marca_usuario_id: undefined, marcaUsuarioId: undefined }),
    });

    assert.equal(response.status, 200);
    assert.equal(received.at(-1).url, '/v1/external-assets/vecteezy/search?query=banners');
    assert.equal(received.at(-1).headers['x-user-id'], 'frontend-user-123');
    assert.equal(received.at(-1).headers['x-marca-usuario-id'], undefined);
    assert.equal(received.at(-1).headers['x-service-token'], MICROSERVICE_TOKEN);
  });
});

test('Iconify external assets proxy is user-scoped and strips browser-forged trusted headers', async () => {
  await withMockEditorAndGateway(async ({ gatewayBaseUrl, received }) => {
    const response = await fetch(`${gatewayBaseUrl}/marketing/external-assets/iconify/search?query=rocket&collection=fluent-emoji`, {
      headers: frontendHeaders(
        { marca_usuario_id: undefined, marcaUsuarioId: undefined },
        {
          'X-Service-Token': 'forged-browser-service-token',
          'X-User-Id': 'forged-browser-user',
          'X-User-Email': 'forged-browser@example.test',
          'X-Marca-Usuario-Id': 'forged-browser-brand',
          'X-Request-Id': 'forged-browser-request-id',
        },
      ),
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);

    const proxied = received[0];
    assert.equal(proxied.url, '/v1/external-assets/iconify/search?query=rocket&collection=fluent-emoji');
    assert.equal(proxied.headers['x-service-token'], MICROSERVICE_TOKEN);
    assert.equal(proxied.headers['x-user-id'], 'frontend-user-123');
    assert.equal(proxied.headers['x-user-email'], undefined);
    assert.equal(proxied.headers['x-marca-usuario-id'], undefined);
    assert.equal(proxied.headers['x-marketing-brand-user-id'], undefined);
    assert.equal(proxied.headers['x-active-marca-usuario-id'], undefined);
    assert.equal(proxied.headers['x-request-id']?.startsWith('gw-editor-'), true);
    assert.notEqual(proxied.headers['x-service-token'], 'forged-browser-service-token');
    assert.notEqual(proxied.headers['x-user-id'], 'forged-browser-user');
    assert.notEqual(proxied.headers['x-request-id'], 'forged-browser-request-id');
  });
});
