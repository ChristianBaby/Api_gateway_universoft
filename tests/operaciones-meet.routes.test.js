import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { operationsMeetBoundary, createOperationsMeetProxy } from '../src/middlewares/operaciones-meet.middleware.js';
import { createSessionBoundary } from '../src/middlewares/session.middleware.js';
import { readMeetConfig } from '../../micro-operaciones-ruwark/src/config/meetOperaciones.js';
import { createMeetOperacionesRouter } from '../../micro-operaciones-ruwark/src/routes/meetOperaciones.routes.js';
import { MeetError } from '../../micro-operaciones-ruwark/src/services/meetOperaciones.errors.js';
import { createMeetOAuthRepository } from '../../micro-operaciones-ruwark/src/repositories/meetOperacionesOAuth.repository.js';

// Solo harness127.0.0.1:puerto efímero. No importa server.js, DB ni proveedores reales.
const prefix = '/api/operaciones/meet';
const env = { OPERACIONES_MEET_ENABLED: 'true', MICROSERVICE_TOKEN: 'sentinel-service-token-not-real',
    OPERACIONES_MEET_CALLBACK_SECRET: 'sentinel-relay-secret-not-real-000000',
    OPERACIONES_MEET_GOOGLE_CLIENT_ID: 'fake-ops.apps.googleusercontent.com',
    OPERACIONES_MEET_GOOGLE_CLIENT_SECRET: 'sentinel-client-secret-not-real',
    OPERACIONES_MEET_GOOGLE_REDIRECT_URI: 'https://ops.example/api/operaciones/meet/oauth/callback',
    OPERACIONES_MEET_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') };
const id = '11111111-2222-3333-4444-555555555555';

async function listen(t, app) {
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; });
    return `http://127.0.0.1:${server.address().port}`;
}
async function fixture(t, { disabled = false, backendDisabled = false, sessionRejected = false, upstream401 = false } = {}) {
    const calls = []; const logs = []; const forwarded = []; let factories = 0; let authentications = 0; let sessionChecks = 0;
    const config = readMeetConfig(backendDisabled ? {} : env);
    const services = {
        oauth: {
            async connection(actor) { calls.push(['connection', actor]); return { status: 'not_connected', accounts: [], canConnect: false, capabilities: { list: true } }; },
            async authorize(actor, body) { calls.push(['authorize', actor, body]); return { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=sentinel-body-only' }; },
            async exchange(body) { calls.push(['exchange', body]); return { connected: true }; },
        },
        meetings: {
            async list(actor, query) { calls.push(['list', actor, query]); return { data: [], meta: { page: 1, limit: 20, total: 0 } }; },
            async get(actor, rowId) { calls.push(['get', actor, rowId]); throw new MeetError('MEET_NOT_FOUND'); },
            async create(actor, key, body) { calls.push(['create', actor, key, body]); return { created: true, data: { id } }; },
            async update(actor, rowId, body) { calls.push(['update', actor, rowId, body]); throw new MeetError('MEET_CONFLICT'); },
            async cancel(actor, rowId, body) { calls.push(['cancel', actor, rowId, body]); throw new Error('sentinel-provider-secret'); },
        },
    };
    const backend = express(); backend.use(express.json({ limit: '10mb' }));
    backend.use(prefix, createMeetOperacionesRouter({ getConfig: () => config, createServices: () => { factories++; return services; } }));
    const backendUrl = await listen(t, backend);
    const gateway = express(); gateway.use(operationsMeetBoundary({ env }));
    gateway.use((req, res, next) => { logs.push({ path: req.originalUrl, headers: { ...req.headers } }); next(); });
    gateway.use(createSessionBoundary({ loginUrl: () => 'https://identity.invalid', fetchImpl: async () => {
        sessionChecks++; return new Response(JSON.stringify({ success: true, data: { valid: true, user: { id: 'trusted-user', rol: ' OPERACIONES ' } } }), { status: sessionRejected ? 401 : 200 });
    } }));
    const authenticate = (req, res, next) => {
        authentications++;
        if (!req.headers.authorization) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
        // Rol del fixture por Bearer, nunca por header identidad. JWT/session real se prueba aparte.
        req.user = { id: 'trusted-user', rol: req.headers.authorization === 'Bearer fake-admin' ? 'admin' : ' OPERACIONES ' }; next();
    };
    gateway.use(prefix, createOperationsMeetProxy({ target: backendUrl, env: disabled ? { ...env, OPERACIONES_MEET_ENABLED: 'false' } : env, authenticate,
        fetchImpl: async (url, options) => {
            forwarded.push({ url: String(url), headers: options.headers });
            if (upstream401) return new Response(JSON.stringify({ success: false, code: 'MEET_PROVIDER_FORBIDDEN', message: 'sentinel-raw-error' }), { status: 401 });
            assert.equal(new URL(url).origin, backendUrl); return fetch(url, options);
        } }));
    gateway.use((req, res) => res.json({ untouchedRelay: req.headers['x-operations-meet-callback'] ?? null, untouchedId: req.headers['x-user-id'] ?? null }));
    const gatewayUrl = await listen(t, gateway);
    const request = async (path, { method = 'GET', headers = {}, body, raw, direct = false, noAuth = false } = {}) => {
        const response = await fetch(`${direct ? backendUrl : gatewayUrl}${prefix}${path}`, { method,
            headers: { ...(noAuth ? {} : { Authorization: 'Bearer fake-operations' }), ...(body || raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
            ...(body || raw ? { body: raw || JSON.stringify(body) } : {}) });
        return { status: response.status, headers: response.headers, body: await response.json() };
    };
    return { request, calls, logs, forwarded, services, gatewayUrl, counts: () => ({ factories, authentications, sessionChecks }) };
}

test('loopback Gateway→backend regenera identidad confiable y firma, elimina spoof, conserva query y no-store', async (t) => {
    const f = await fixture(t);
    const result = await f.request('/reuniones?from=2026-10-01&to=2026-10-30', { headers: { 'X-User-Id': 'spoof', 'X-User-Role': 'admin',
        'X-Service-Token': 'spoof', 'X-Operations-Meet-Identity': 'spoof', 'X-Operations-Meet-Callback': env.OPERACIONES_MEET_CALLBACK_SECRET } });
    assert.equal(result.status, 200); assert.equal(result.body.success, true); assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(f.calls[0][1].id, 'trusted-user'); assert.equal(f.calls[0][1].role, 'operaciones'); assert.equal(f.calls[0][2].from, '2026-10-01');
    assert.ok(f.forwarded[0].headers['X-Operations-Meet-Identity']); assert.equal(f.forwarded[0].headers['X-Operations-Meet-Callback'], undefined);
    assert.equal(f.logs[0].path, `${prefix}/reuniones`); assert.equal(f.logs[0].headers['x-user-id'], undefined);
    assert.ok(!JSON.stringify(f.logs).includes(env.OPERACIONES_MEET_CALLBACK_SECRET));
});

test('sesión ausente/revocada401 canónico, rol admin403 sin bypass ni llamadas backend', async (t) => {
    const f = await fixture(t);
    assert.equal((await f.request('/connection', { noAuth: true })).body.code, 'RUWARK_SESSION_REQUIRED');
    assert.equal((await f.request('/connection', { headers: { Authorization: 'Bearer fake-admin' } })).status, 403);
    assert.equal(f.calls.length, 0);
    const revoked = await fixture(t, { sessionRejected: true });
    assert.equal((await revoked.request('/connection')).status, 401); assert.equal(revoked.counts().authentications, 0);
});

test('exchange exacto requiere relay antes de logging y omite sesión vencida; body sensible no se loguea', async (t) => {
    const f = await fixture(t, { sessionRejected: true });
    assert.equal((await f.request('/oauth/exchange', { method: 'POST', body: { code: 'sentinel-code', state: 'sentinel-state' } })).status, 403);
    assert.equal(f.logs.length, 0);
    const result = await f.request('/oauth/exchange', { method: 'POST', headers: { 'X-Operations-Meet-Callback': env.OPERACIONES_MEET_CALLBACK_SECRET,
        Authorization: 'Bearer expired', Cookie: 'token=expired' }, body: { code: 'sentinel-code', state: 'sentinel-state' } });
    assert.equal(result.status, 200); assert.deepEqual(result.body.data, { connected: true });
    assert.equal(f.counts().authentications, 0); assert.equal(f.counts().sessionChecks, 0);
    assert.equal(f.forwarded[0].headers['X-User-Id'], undefined);
    for (const secret of ['sentinel-code', 'sentinel-state', env.OPERACIONES_MEET_CALLBACK_SECRET, 'expired']) assert.ok(!JSON.stringify(f.logs).includes(secret));
});

test('excepción OAuth no acepta GET, slash final, subruta ni casing distinto; query sensible se rechaza pre-log', async (t) => {
    const f = await fixture(t);
    for (const path of ['/oauth/exchange/', '/oauth/exchange/extra', '/oauth/EXCHANGE']) {
        assert.equal((await f.request(path, { method: 'POST', body: {}, headers: { 'X-Operations-Meet-Callback': env.OPERACIONES_MEET_CALLBACK_SECRET } })).status, 404);
    }
    assert.equal((await f.request('/oauth/exchange')).status, 404);
    const count = f.logs.length;
    assert.equal((await f.request('/oauth/exchange?code=sentinel-never-log')).status, 422);
    assert.equal(f.logs.length, count); assert.equal(f.calls.length, 0);
});

test('fuera namespace no modifica headers ni respuesta; bootstrap importa/monta hook antes Morgan y sesión', async (t) => {
    const f = await fixture(t);
    const response = await fetch(`${f.gatewayUrl}/api/operaciones/meet-other`, { headers: { 'X-User-Id': 'keep-me', 'X-Operations-Meet-Callback': 'keep-relay' } });
    assert.deepEqual(await response.json(), { untouchedId: 'keep-me', untouchedRelay: 'keep-relay' });
    const source = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
    assert.ok(source.indexOf('app.use(operationsMeetBoundary())') < source.indexOf("app.use(morgan('combined'))"));
    assert.ok(source.indexOf('app.use(operationsMeetBoundary())') < source.indexOf('app.use(sessionBoundary)'));
});

test('flag off en cualquiera frontera no construye servicios ni consulta schema/proveedor', async (t) => {
    for (const options of [{ disabled: true }, { backendDisabled: true }]) {
        const f = await fixture(t, options); const result = await f.request('/connection');
        assert.equal(result.status, 503); assert.equal(result.body.code, 'MEET_DISABLED'); assert.equal(f.counts().factories, 0); assert.equal(f.calls.length, 0);
    }
});

test('backend rechaza identidad spoof aunque proxy legacy añada service token válido; relay también obligatorio', async (t) => {
    const f = await fixture(t); const headers = { 'X-Service-Name': 'api-gateway', 'X-Service-Token': env.MICROSERVICE_TOKEN,
        'X-User-Id': 'trusted-user', 'X-User-Role': 'operaciones' };
    assert.equal((await f.request('/connection', { direct: true, headers })).status, 403);
    assert.equal((await f.request('/oauth/exchange', { direct: true, method: 'POST', headers, body: {} })).status, 403);
    assert.equal(f.counts().factories, 0);
});

test('CRUD preserva envelope, clave idempotente y status; error externo saneado nunca produce401', async (t) => {
    const f = await fixture(t);
    const created = await f.request('/reuniones', { method: 'POST', headers: { 'Idempotency-Key': id }, body: { title: 'test' } });
    assert.equal(created.status, 201); assert.equal(f.calls[0][2], id);
    assert.equal((await f.request(`/reuniones/${id}`)).status, 404);
    assert.equal((await f.request(`/reuniones/${id}`, { method: 'PATCH', body: { revision: 'a'.repeat(64) } })).status, 409);
    const cancelled = await f.request(`/reuniones/${id}/cancel`, { method: 'POST', body: {} });
    assert.equal(cancelled.status, 503); assert.ok(!JSON.stringify(cancelled.body).includes('sentinel'));
    const g = await fixture(t, { upstream401: true }); assert.equal((await g.request('/connection')).status, 503);
});

test('JSON malformado/oversize falla422 sin servicios, incluido body ya parseado por bootstrap legacy', async (t) => {
    const f = await fixture(t);
    assert.equal((await f.request('/oauth/authorize', { method: 'POST', raw: '{"bad":' })).status, 422);
    assert.equal((await f.request('/oauth/authorize', { method: 'POST', body: { extra: 'x'.repeat(70000) } })).status, 422);
    assert.equal((await f.request('/oauth/exchange', { direct: true, method: 'POST', headers: {
        'X-Service-Name': 'api-gateway', 'X-Service-Token': env.MICROSERVICE_TOKEN, 'X-Operations-Meet-Callback': env.OPERACIONES_MEET_CALLBACK_SECRET,
    }, body: { extra: 'x'.repeat(70000) } })).status, 422);
    assert.equal(f.counts().factories, 0);
});

test('error SQL fake de tabla/columna llega como MEET_SCHEMA_UNAVAILABLE503 al frontend sin detalles ni retry automático', async (t) => {
    const f = await fixture(t);
    for (const code of ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']) {
        const repository = createMeetOAuthRepository({ async query() { throw { code, message: 'sentinel-db-secret', sqlMessage: 'sentinel-schema' }; } });
        f.services.oauth.connection = (actor) => repository.canConnect(actor);
        const result = await f.request('/connection');
        assert.equal(result.status, 503); assert.equal(result.body.code, 'MEET_SCHEMA_UNAVAILABLE'); assert.equal(result.body.retryable, false);
        assert.doesNotMatch(JSON.stringify(result.body), /sentinel|ER_NO_SUCH_TABLE|ER_BAD_FIELD_ERROR/);
    }
});
