import express from 'express';
import jwt from 'jsonwebtoken';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { MICROSERVICE_TOKEN } from '../config/services.js';

const CMS_SERVICE_FALLBACK = 'http://localhost:4007';
const PUBLICACIONES_SERVICE_FALLBACK = 'http://localhost:4010';

const UNTRUSTED_BROWSER_HEADERS = [
    'X-Service-Token',
    'x-service-token',
    'Service-Token',
    'service-token',
    'X-User-Id',
    'x-user-id',
    'X-User-Email',
    'x-user-email',
    'X-User-Role',
    'x-user-role',
    'X-Marca-Usuario-Id',
    'x-marca-usuario-id',
    'X-Marketing-Brand-User-Id',
    'x-marketing-brand-user-id',
    'X-Active-Marca-Usuario-Id',
    'x-active-marca-usuario-id',
    'X-Origin-Service',
    'x-origin-service'
];

const safeRequestIdPattern = /^[A-Za-z0-9._:-]{8,120}$/;

function generateRequestId() {
    return `gw-cms-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function resolveRequestId(req) {
    const incoming = req.headers['x-request-id'];
    if (typeof incoming === 'string' && safeRequestIdPattern.test(incoming)) {
        return incoming;
    }
    return generateRequestId();
}

function getBearerToken(req) {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.slice(7).trim() || null;
}

function getJwtSecret() {
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) {
        return process.env.JWT_SECRET.trim();
    }
    if (['production', 'prod', 'staging'].includes(String(process.env.NODE_ENV || '').trim().toLowerCase())) {
        throw new Error('[CONFIG] JWT_SECRET es requerido en producción para validar rutas CMS.');
    }
    return 'universoft-dev-only-cambiame';
}

function firstTruthy(...values) {
    return values.find((value) => value !== undefined && value !== null && `${value}`.trim() !== '');
}

function roleValue(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object') {
        return firstTruthy(
            value.nombre,
            value.name,
            value.slug,
            value.key,
            value.role,
            value.rol
        );
    }
    return undefined;
}

function resolveUserId(user) {
    return firstTruthy(
        user?.usuario_id,
        user?.user_id,
        user?.userId,
        user?.id,
        user?.sub,
        user?.usuario?.id,
        user?.user?.id
    );
}

function resolveUserEmail(user) {
    return firstTruthy(
        user?.email,
        user?.correo,
        user?.usuario?.email,
        user?.user?.email
    );
}

function resolveUserRole(user) {
    return firstTruthy(
        roleValue(user?.rol),
        roleValue(user?.role),
        user?.rol_nombre,
        user?.roleName,
        roleValue(user?.usuario?.rol),
        roleValue(user?.user?.rol)
    );
}


function resolveRequestedMarcaUsuarioId(req) {
    return firstTruthy(
        req.headers['x-marca-usuario-id'],
        req.headers['x-marketing-brand-user-id'],
        req.headers['x-active-marca-usuario-id']
    );
}
function resolveMarcaUsuarioId(user) {
    return firstTruthy(
        user?.marca_usuario_id,
        user?.marcaUsuarioId,
        user?.marca_usuario?.id,
        user?.marcaUsuario?.id,
        user?.brandMembershipId,
        user?.brand_membership_id,
        user?.currentBrandMembershipId,
        user?.current_brand_membership_id,
        user?.brand?.membershipId,
        user?.brand?.membership_id
    );
}

function withRequestId(req, res, next) {
    req.cmsRequestId = resolveRequestId(req);
    res.setHeader('X-Request-Id', req.cmsRequestId);
    next();
}

function authenticateCmsJwt(req, res, next, jwtSecret = getJwtSecret()) {
    const token = getBearerToken(req);

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'UNAUTHORIZED',
            message: 'Token de acceso requerido',
            requestId: req.cmsRequestId
        });
    }

    try {
        req.user = jwt.verify(token, jwtSecret);
        return next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: 'INVALID_TOKEN',
            message: 'Token inválido o expirado',
            requestId: req.cmsRequestId
        });
    }
}

function cmsRouteSuffix(req) {
    const originalPath = (req.originalUrl || '').split('?')[0] || '/';
    if (originalPath.startsWith('/marketing/cms')) {
        return originalPath.slice('/marketing/cms'.length) || '/';
    }
    return req.path || '/';
}

function isUserScopedDiscoveryRoute(req) {
    const suffix = cmsRouteSuffix(req);
    if (req.method === 'GET' && /^\/sales-videos(?:\/\d+\/download)?\/?$/.test(suffix)) return true;
    if (req.method === 'GET' && /^\/workspace\/?$/.test(suffix)) return true;
    if (req.method === 'GET' && /^\/brands(\/lookup)?\/?$/.test(suffix)) return true;
    if (req.method === 'POST' && /^\/brands\/?$/.test(suffix)) return true;
    if (['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method) && /^\/etiquetas(\/[^/]+)?\/?$/.test(suffix)) return true;
    if (/^\/admin(\/|$)/.test(suffix)) return true;
    if (req.method === 'POST' && /^\/brands\/(logo-upload-url|logo-upload|logo-view-url|manual-upload-url)\/?$/.test(suffix)) return true;
    return false;
}

function attachTrustedCmsScope(req, res, next, { requireBrand = true } = {}) {
    const userId = resolveUserId(req.user);
    const userEmail = resolveUserEmail(req.user);
    const userRole = resolveUserRole(req.user);
    const isDiscoveryRoute = !requireBrand;
    const requestedMarcaUsuarioId = isDiscoveryRoute ? null : resolveRequestedMarcaUsuarioId(req);
    const marcaUsuarioId = isDiscoveryRoute ? null : resolveMarcaUsuarioId(req.user) || requestedMarcaUsuarioId;

    if (!userId && !userEmail) {
        return res.status(403).json({
            success: false,
            error: 'USER_SCOPE_DENIED',
            message: 'No se pudo resolver la identidad del usuario autenticado',
            requestId: req.cmsRequestId
        });
    }

    if (requireBrand && !marcaUsuarioId) {
        return res.status(403).json({
            success: false,
            error: 'BRAND_SCOPE_DENIED',
            message: 'No se pudo resolver el alcance de marca del usuario',
            requestId: req.cmsRequestId
        });
    }

    req.trustedGatewayContext = {
        requestId: req.cmsRequestId,
        userId,
        userEmail,
        userRole
    };

    if (marcaUsuarioId) {
        req.trustedGatewayContext.marcaUsuarioId = marcaUsuarioId;
    }

    return next();
}

function requireTrustedCmsScope(req, res, next) {
    return attachTrustedCmsScope(req, res, next, {
        requireBrand: !isUserScopedDiscoveryRoute(req)
    });
}

function removeUntrustedHeaders(proxyReq) {
    for (const header of UNTRUSTED_BROWSER_HEADERS) {
        proxyReq.removeHeader(header);
    }
}

export function rewriteCmsPath(path) {
    let suffix = path || '/';

    if (suffix.startsWith('/marketing/cms')) {
        suffix = suffix.slice('/marketing/cms'.length) || '/';
    }

    if (suffix === '/') {
        return '/marketing/cms';
    }

    if (suffix.startsWith('/?')) {
        return `/marketing/cms${suffix.slice(1)}`;
    }

    if (suffix.startsWith('?')) {
        return `/marketing/cms${suffix}`;
    }

    return `/marketing/cms${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

export function rewriteCmsAnalyticsPath(path) {
    let suffix = path || '/';

    if (suffix.startsWith('/marketing/cms/analytics')) {
        suffix = suffix.slice('/marketing/cms/analytics'.length) || '/';
    }

    if (suffix === '/') {
        return '/v1/analytics';
    }

    if (suffix.startsWith('/?')) {
        return `/v1/analytics${suffix.slice(1)}`;
    }

    if (suffix.startsWith('?')) {
        return `/v1/analytics${suffix}`;
    }

    return `/v1/analytics${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

function createCmsProxy(SERVICES) {
    const target = SERVICES.CMS?.baseUrl || CMS_SERVICE_FALLBACK;
    const cmsTimeoutMs = Number(process.env.CMS_SERVICE_TIMEOUT_MS || 120000);

    return createProxyMiddleware({
        target,
        changeOrigin: true,
        timeout: cmsTimeoutMs,
        proxyTimeout: cmsTimeoutMs,
        logLevel: 'warn',
        pathRewrite: (path, req) => rewriteCmsPath(req.originalUrl || path),
        onProxyReq: (proxyReq, req) => {
            const context = req.trustedGatewayContext || {};

            removeUntrustedHeaders(proxyReq);
            proxyReq.setHeader('X-Service-Name', 'api-gateway');
            proxyReq.setHeader('X-Gateway-Request', 'true');
            proxyReq.setHeader('X-Service-Token', MICROSERVICE_TOKEN);
            proxyReq.setHeader('X-Request-Id', context.requestId || req.cmsRequestId || generateRequestId());

            if (context.userId) {
                proxyReq.setHeader('X-User-Id', context.userId);
            } else {
                proxyReq.removeHeader('X-User-Id');
            }

            if (context.userEmail) {
                proxyReq.setHeader('X-User-Email', context.userEmail);
            } else {
                proxyReq.removeHeader('X-User-Email');
            }

            if (context.userRole) {
                proxyReq.setHeader('X-User-Role', context.userRole);
            } else {
                proxyReq.removeHeader('X-User-Role');
            }

            if (context.marcaUsuarioId) {
                proxyReq.setHeader('X-Marca-Usuario-Id', context.marcaUsuarioId);
            } else {
                proxyReq.removeHeader('X-Marca-Usuario-Id');
            }

            console.log(`🧠 [CMS] ${req.method} ${req.originalUrl} -> /marketing/cms* requestId=${context.requestId}`);
        },
        onProxyRes: (proxyRes, req) => {
            console.log(`📥 [CMS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl} requestId=${req.cmsRequestId}`);
        },
        onError: (err, req, res) => {
            console.error(`❌ [CMS] Proxy error ${err.code || 'UNKNOWN'} requestId=${req.cmsRequestId}`);
            if (!res.headersSent) {
                res.status(503).json({
                    success: false,
                    error: 'CMS_SERVICE_UNAVAILABLE',
                    message: 'Servicio CMS de marketing no disponible',
                    service: 'micro-cms',
                    requestId: req.cmsRequestId
                });
            }
        }
    });
}

function createCmsAnalyticsCompatibilityProxy(SERVICES) {
    const target = SERVICES.PUBLICACIONES?.baseUrl || PUBLICACIONES_SERVICE_FALLBACK;

    return createProxyMiddleware({
        target,
        changeOrigin: true,
        timeout: Number(process.env.MICRO_PUBLICACIONES_TIMEOUT_MS || 45000),
        proxyTimeout: Number(process.env.MICRO_PUBLICACIONES_TIMEOUT_MS || 45000),
        logLevel: 'warn',
        pathRewrite: rewriteCmsAnalyticsPath,
        onProxyReq: (proxyReq, req) => {
            const context = req.trustedGatewayContext || {};

            removeUntrustedHeaders(proxyReq);
            proxyReq.setHeader('X-Service-Name', 'api-gateway');
            proxyReq.setHeader('X-Gateway-Request', 'true');
            proxyReq.setHeader('X-Service-Token', MICROSERVICE_TOKEN);
            proxyReq.setHeader('X-Request-Id', context.requestId || req.cmsRequestId || generateRequestId());

            if (context.marcaUsuarioId) {
                proxyReq.setHeader('X-Marca-Usuario-Id', context.marcaUsuarioId);
            } else {
                proxyReq.removeHeader('X-Marca-Usuario-Id');
            }

            if (context.userId) {
                proxyReq.setHeader('X-User-Id', context.userId);
            } else {
                proxyReq.removeHeader('X-User-Id');
            }

            console.log(`🧠➡️📣 [CMS-ANALYTICS-COMPAT] ${req.method} ${req.originalUrl} -> /v1/analytics* requestId=${context.requestId}`);
        },
        onProxyRes: (proxyRes, req) => {
            console.log(`📥 [CMS-ANALYTICS-COMPAT] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl} requestId=${req.cmsRequestId}`);
        },
        onError: (err, req, res) => {
            console.error(`❌ [CMS-ANALYTICS-COMPAT] Proxy error ${err.code || 'UNKNOWN'} requestId=${req.cmsRequestId}`);
            if (!res.headersSent) {
                res.status(503).json({
                    success: false,
                    error: 'PUBLICACIONES_SERVICE_UNAVAILABLE',
                    message: 'Servicio de publicaciones no disponible para analítica',
                    service: 'micro-publicaciones',
                    requestId: req.cmsRequestId
                });
            }
        }
    });
}

/**
 * Rutas del microservicio CMS de Marketing.
 * El frontend consume /marketing/cms/* y el Gateway conserva exactamente ese contrato hacia micro-cms.
 * Regla de arquitectura: CMS no usa versionado interno ni reescrituras a /v1.
 */
export default function createCmsRoutes(SERVICES) {
    const router = express.Router();
    const jwtSecret = getJwtSecret();
    const authenticateWithConfiguredSecret = (req, res, next) => (
        authenticateCmsJwt(req, res, next, jwtSecret)
    );

    router.use(
        '/marketing/cms/analytics',
        withRequestId,
        authenticateWithConfiguredSecret,
        requireTrustedCmsScope,
        createCmsAnalyticsCompatibilityProxy(SERVICES)
    );

    router.use(
        '/marketing/cms',
        withRequestId,
        authenticateWithConfiguredSecret,
        requireTrustedCmsScope,
        createCmsProxy(SERVICES)
    );

    router.get(
        ['/workspace', '/workspace/'],
        withRequestId,
        authenticateWithConfiguredSecret,
        requireTrustedCmsScope,
        createCmsProxy(SERVICES)
    );

    return router;
}
