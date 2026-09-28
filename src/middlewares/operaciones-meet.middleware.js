import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { authenticateJWT } from './auth.middleware.js';

const PREFIX = '/api/operaciones/meet';
const boundary = Symbol('operationsMeetBoundary');
const secretEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && b.length >= 32
    && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (res, status, code) => res.status(status).json({ success: false, code,
    message: status === 401 ? 'Sesión requerida o expirada.' : 'No se pudo completar la operación de Meet.',
    retryable: (status === 503 && code !== 'MEET_SCHEMA_UNAVAILABLE') || status === 429 });

// Único hook de bootstrap: ANTES de Morgan/debug/sessionBoundary. Fuera del
// namespace exacto no toca request/response ni credenciales de otros módulos.
export function operationsMeetBoundary({ env = process.env } = {}) {
    return (req, res, next) => {
        const path = req.path;
        if (!(path.toLowerCase() === PREFIX || path.toLowerCase().startsWith(`${PREFIX}/`))) return next();
        const relay = req.headers['x-operations-meet-callback'];
        delete req.headers['x-operations-meet-callback'];
        for (const name of Object.keys(req.headers)) {
            if (name.startsWith('x-user-') || ['x-marca-usuario-id', 'x-area-id', 'x-request-id', 'x-service-name', 'x-service-token',
                'x-marketing-brand-user-id', 'x-active-marca-usuario-id', 'x-operations-meet-identity'].includes(name)) delete req.headers[name];
        }
        // Los querys siguen disponibles en req.url/query para el proxy, no en logs.
        req.originalUrl = path;
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            if (body?.success === false && !body.code) return originalJson({ success: false,
                code: res.statusCode === 401 ? 'RUWARK_SESSION_REQUIRED' : res.statusCode === 403 ? 'MEET_FORBIDDEN' : 'MEET_UNAVAILABLE',
                message: res.statusCode === 401 ? 'Sesión requerida o expirada.' : 'Meet no está disponible.', retryable: res.statusCode === 503 });
            return originalJson(body);
        };
        if (Object.keys(req.query || {}).some((key) => /^(?:code|state|code_verifier|access_token|refresh_token|client_secret|authorization)$/i.test(key))) {
            return fail(res, 422, 'MEET_VALIDATION');
        }
        if (!path.startsWith(PREFIX)) return fail(res, 404, 'MEET_NOT_FOUND');
        const exchange = req.method === 'POST' && path === `${PREFIX}/oauth/exchange`;
        if (exchange) {
            // Sesión Ruwark ajena/vencida no participa en un callback server-to-server.
            delete req.headers.authorization; delete req.headers.cookie;
            if (req.cookies) req.cookies = {};
            if (!secretEqual(relay, env.OPERACIONES_MEET_CALLBACK_SECRET)) return fail(res, 403, 'MEET_FORBIDDEN');
        }
        req[boundary] = { exchange };
        next();
    };
}

export function createOperationsMeetProxy({ target, authenticate = authenticateJWT, env = process.env, fetchImpl = (...args) => fetch(...args) }) {
    const router = express.Router({ caseSensitive: true, strict: true });
    router.use((req, res, next) => {
        if (!req[boundary] || env.OPERACIONES_MEET_ENABLED !== 'true') return fail(res, 503, 'MEET_DISABLED');
        if (typeof env.MICROSERVICE_TOKEN !== 'string' || env.MICROSERVICE_TOKEN.trim().length < 16) return fail(res, 503, 'MEET_CONFIG_UNAVAILABLE');
        if (req[boundary].exchange) return next();
        return authenticate(req, res, next);
    });
    router.use(express.json({ limit: '64kb', strict: true }));
    router.use(async (req, res) => {
        try {
            const path = req.path;
            const validRoute = (req.method === 'GET' && ['/connection', '/reuniones'].includes(path))
                || (req.method === 'POST' && ['/oauth/authorize', '/oauth/exchange', '/reuniones'].includes(path))
                || (['GET', 'PATCH'].includes(req.method) && /^\/reuniones\/[a-f0-9-]{36}$/.test(path))
                || (req.method === 'POST' && /^\/reuniones\/[a-f0-9-]{36}\/cancel$/.test(path));
            if (!validRoute || (path === '/oauth/exchange' && !req[boundary].exchange)) return fail(res, 404, 'MEET_NOT_FOUND');
            const requestId = randomUUID();
            const headers = { 'Content-Type': 'application/json', 'X-Service-Name': 'api-gateway',
                'X-Service-Token': env.MICROSERVICE_TOKEN, 'X-Request-Id': requestId };
            if (req[boundary].exchange) headers['X-Operations-Meet-Callback'] = env.OPERACIONES_MEET_CALLBACK_SECRET;
            else {
                const id = String(req.user?.usuario_id ?? req.user?.id ?? '');
                const role = typeof req.user?.rol === 'string' ? req.user.rol.trim().toLowerCase() : '';
                if (!/^[a-zA-Z0-9_-]{1,36}$/.test(id) || role !== 'operaciones'
                    || (req.user?.id != null && req.user?.usuario_id != null && String(req.user.id) !== String(req.user.usuario_id))) return fail(res, 403, 'MEET_FORBIDDEN');
                headers['X-User-Id'] = id; headers['X-User-Role'] = role;
                const issued = String(Date.now());
                const signature = createHmac('sha256', env.MICROSERVICE_TOKEN).update(JSON.stringify([id, role, requestId, issued])).digest('hex');
                // Evita que proxies legacy con addServiceToken legitimen headers de
                // actor aportados por cliente sin pasar JWT/sessionBoundary de Meet.
                headers['X-Operations-Meet-Identity'] = `${issued}.${signature}`;
            }
            if (req.headers['idempotency-key']) headers['Idempotency-Key'] = req.headers['idempotency-key'];
            const destination = new URL(`${PREFIX}${req.url}`, target);
            if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) return fail(res, 503, 'MEET_CONFIG_UNAVAILABLE');
            const response = await fetchImpl(destination, { method: req.method, headers, redirect: 'error', cache: 'no-store',
                signal: AbortSignal.timeout(15000), ...(['POST', 'PATCH'].includes(req.method) ? { body: JSON.stringify(req.body || {}) } : {}) });
            const body = await response.json();
            if (!response.ok || body?.success !== true) {
                const code = /^MEET_[A-Z_]+$/.test(body?.code || '') ? body.code : 'MEET_UNAVAILABLE';
                // Solo authenticate/sessionBoundary producen401 Ruwark, nunca un proveedor.
                return fail(res, [403, 404, 409, 422, 429, 503].includes(response.status) ? response.status : 503, code);
            }
            res.status(response.status).json(body);
        } catch { fail(res, 503, 'MEET_UNAVAILABLE'); }
    });
    router.use((error, req, res, next) => { // Error de JSON/cuerpo: no cae al logger global con body o headers.
        fail(res, error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large' ? 422 : 503, 'MEET_VALIDATION');
    });
    return router;
}
