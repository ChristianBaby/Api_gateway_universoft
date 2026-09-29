import express from 'express';
import jwt from 'jsonwebtoken';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { MICROSERVICE_TOKEN } from '../config/services.js';

const PUBLICACIONES_SERVICE_FALLBACK = 'http://localhost:4010';

// Regla de oro CMS/Publicaciones:
// docs/REGLA_DE_ORO_CMS_PUBLICACIONES.md
// micro-publicaciones no recibe CRUD/configuración de marca desde frontend.
// Marca, keyMeta y canales pertenecen a micro-cms.
const PROTECTED_PUBLICACIONES_ROUTE_REWRITES = [
  ['/marketing/publicaciones/providers', '/v1/providers', undefined, false],
  ['/marketing/publicaciones/connections', '/v1/connections', undefined, true, true],
  ['/marketing/publicaciones/programacion', '/v1/programacion', undefined, true, true],
  ['/marketing/publicaciones/analytics', '/v1/analytics', undefined, true],
  ['/marketing/publicaciones/metrics', '/v1/metrics', undefined, false],
];

const PUBLIC_PUBLICACIONES_ROUTE_REWRITES = [
  // Alias legacy registrado en TikTok Developer Portal. Se mantiene público,
  // pero entra por el Gateway y termina en micro-publicaciones.
  ['/api/tiktok/oauth', '/v1/oauth/tiktok'],
  ['/marketing/publicaciones/oauth', '/v1/oauth'],
  ['/marketing/publicaciones/webhooks', '/v1/webhooks'],
];

const UNTRUSTED_BROWSER_HEADERS = [
  'X-Service-Token',
  'x-service-token',
  'Service-Token',
  'service-token',
  'X-User-Id',
  'x-user-id',
  'X-Marca-Usuario-Id',
  'x-marca-usuario-id',
  'X-Origin-Service',
  'x-origin-service',
];

const safeRequestIdPattern = /^[A-Za-z0-9._:-]{8,120}$/;

function generateRequestId() {
  return `gw-publicaciones-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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
    throw new Error('[CONFIG] JWT_SECRET es requerido en producción para validar rutas de publicaciones.');
  }
  return 'universoft-dev-only-cambiame';
}

function firstTruthy(...values) {
  return values.find((value) => value !== undefined && value !== null && `${value}`.trim() !== '');
}

function resolveUserId(user) {
  return firstTruthy(
    user?.usuario_id,
    user?.user_id,
    user?.userId,
    user?.id,
    user?.sub,
    user?.usuario?.id,
    user?.user?.id,
  );
}

function resolveMarcaUsuarioId(user, req, options = {}) {
  const requestedFromHeader = firstTruthy(req.headers['x-marca-usuario-id']);
  if (options.preferHeader && requestedFromHeader) return requestedFromHeader;

  const fromToken = firstTruthy(
    user?.marca_usuario_id,
    user?.marcaUsuarioId,
    user?.marca_usuario?.id,
    user?.marcaUsuario?.id,
    user?.brandMembershipId,
    user?.brand_membership_id,
    user?.currentBrandMembershipId,
    user?.current_brand_membership_id,
    user?.brand?.membershipId,
    user?.brand?.membership_id,
  );
  if (fromToken) return fromToken;
  if (!options.allowHeaderFallback) return undefined;
  return requestedFromHeader;
}

function withRequestId(req, res, next) {
  req.publicacionesRequestId = resolveRequestId(req);
  res.setHeader('X-Request-Id', req.publicacionesRequestId);
  next();
}

function authenticateMarketingJwt(req, res, next, jwtSecret = getJwtSecret()) {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Token de acceso requerido',
      requestId: req.publicacionesRequestId,
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
      requestId: req.publicacionesRequestId,
    });
  }
}


function authenticateInternalCmsRequest(req, res, next) {
  const incomingToken = req.headers['x-service-token'];
  const originService = req.headers['x-origin-service'];
  const marcaUsuarioId = req.headers['x-marca-usuario-id'];

  if (incomingToken !== MICROSERVICE_TOKEN) {
    return res.status(401).json({
      success: false,
      error: 'SERVICE_TOKEN_REQUIRED',
      message: 'Token de servicio requerido para crear jobs de publicación',
      requestId: req.publicacionesRequestId,
    });
  }

  if (originService !== 'micro-cms') {
    return res.status(403).json({
      success: false,
      error: 'ORIGIN_SERVICE_DENIED',
      message: 'La creación de jobs debe originarse en micro-cms',
      requestId: req.publicacionesRequestId,
    });
  }

  if (!marcaUsuarioId) {
    return res.status(403).json({
      success: false,
      error: 'BRAND_SCOPE_DENIED',
      message: 'X-Marca-Usuario-Id es requerido para crear jobs de publicación',
      requestId: req.publicacionesRequestId,
    });
  }

  req.trustedGatewayContext = {
    requestId: req.publicacionesRequestId,
    userId: req.headers['x-user-id'],
    marcaUsuarioId,
  };

  return next();
}

function requireTrustedBrandScope(options = {}) {
  return (req, res, next) => {
  const marcaUsuarioId = resolveMarcaUsuarioId(req.user, req, {
    allowHeaderFallback: Boolean(options.allowHeaderFallback),
    preferHeader: Boolean(options.preferHeader),
  });

  if (!marcaUsuarioId) {
    return res.status(403).json({
      success: false,
      error: 'BRAND_SCOPE_DENIED',
      message: 'No se pudo resolver el alcance de marca del usuario',
      requestId: req.publicacionesRequestId,
    });
  }

  req.trustedGatewayContext = {
    requestId: req.publicacionesRequestId,
    userId: resolveUserId(req.user),
    marcaUsuarioId,
  };

  return next();
  };
}

function safeUrlForLog(req) {
  const original = req.originalUrl || req.url || '';
  return original.split('?')[0];
}

function removeUntrustedHeaders(proxyReq) {
  for (const header of UNTRUSTED_BROWSER_HEADERS) {
    proxyReq.removeHeader(header);
  }
}

export function rewriteMarketingPublicacionesPath(path, publicPrefix, internalPrefix) {
  let suffix = path || '/';

  if (suffix.startsWith(publicPrefix)) {
    suffix = suffix.slice(publicPrefix.length) || '/';
  }

  if (suffix === '/') {
    return internalPrefix;
  }

  if (suffix.startsWith('/?')) {
    return `${internalPrefix}${suffix.slice(1)}`;
  }

  if (suffix.startsWith('?')) {
    return `${internalPrefix}${suffix}`;
  }

  return `${internalPrefix}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

function createPublicacionesProxy(SERVICES, publicPrefix, internalPrefix, options = {}) {
  const target = SERVICES.PUBLICACIONES?.baseUrl || PUBLICACIONES_SERVICE_FALLBACK;
  // TikTok/YouTube video publish can include S3 download + chunk upload to the
  // provider.  Keep this timeout isolated to publicaciones so other modules are
  // not affected, and allow EasyPanel to override it via env.
  const publicacionesTimeoutMs = Number(process.env.MICRO_PUBLICACIONES_TIMEOUT_MS || 180000);

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    timeout: publicacionesTimeoutMs,
    proxyTimeout: publicacionesTimeoutMs,
    logLevel: 'warn',
    pathRewrite: (path) => rewriteMarketingPublicacionesPath(path, publicPrefix, internalPrefix),
    onProxyReq: (proxyReq, req) => {
      const context = req.trustedGatewayContext || {};

      removeUntrustedHeaders(proxyReq);
      proxyReq.setHeader('X-Service-Name', 'api-gateway');
      proxyReq.setHeader('X-Gateway-Request', 'true');
      proxyReq.setHeader('X-Service-Token', MICROSERVICE_TOKEN);
      proxyReq.setHeader('X-Request-Id', context.requestId || req.publicacionesRequestId || generateRequestId());

      if (context.marcaUsuarioId) {
        proxyReq.setHeader('X-Marca-Usuario-Id', context.marcaUsuarioId);
      }

      if (context.userId) {
        proxyReq.setHeader('X-User-Id', context.userId);
      } else {
        proxyReq.removeHeader('X-User-Id');
      }

      if (options.originService) {
        proxyReq.setHeader('X-Origin-Service', options.originService);
      }

      console.log(`📣 [MARKETING-PUBLICACIONES] ${req.method} ${safeUrlForLog(req)} -> ${internalPrefix}* requestId=${context.requestId || req.publicacionesRequestId}`);
    },
    onProxyRes: (proxyRes, req) => {
      console.log(`📥 [MARKETING-PUBLICACIONES] Response ${proxyRes.statusCode} for ${req.method} ${safeUrlForLog(req)} requestId=${req.publicacionesRequestId}`);
    },
    onError: (err, req, res) => {
      console.error(`❌ [MARKETING-PUBLICACIONES] Proxy error ${err.code || 'UNKNOWN'} requestId=${req.publicacionesRequestId}`);
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: 'PUBLICACIONES_SERVICE_UNAVAILABLE',
          message: 'Servicio de publicaciones no disponible',
          requestId: req.publicacionesRequestId,
        });
      }
    },
  });
}

export default function createMarketingPublicacionesRoutes(SERVICES) {
  const router = express.Router();
  const jwtSecret = getJwtSecret();
  const authenticateWithConfiguredSecret = (req, res, next) => (
    authenticateMarketingJwt(req, res, next, jwtSecret)
  );

  router.use(
    '/marketing/publicaciones/brands',
    withRequestId,
    (req, res) => res.status(410).json({
      success: false,
      error: 'BRAND_OWNERSHIP_MOVED_TO_CMS',
      message: 'Regla de oro: el CRUD/configuración de marca y keyMeta pertenece a micro-cms. Use /marketing/cms/brands.',
      rule: 'docs/REGLA_DE_ORO_CMS_PUBLICACIONES.md',
      correctEndpoint: '/marketing/cms/brands/{brandId}',
      requestId: req.publicacionesRequestId,
    }),
  );

  router.post(
    '/marketing/publicaciones/jobs',
    withRequestId,
    authenticateInternalCmsRequest,
    createPublicacionesProxy(SERVICES, '/marketing/publicaciones/jobs', '/v1/publication-jobs', { originService: 'micro-cms' }),
  );


  router.post(
    '/marketing/publicaciones/jobs/:publicationJobId/retry',
    withRequestId,
    authenticateInternalCmsRequest,
    createPublicacionesProxy(SERVICES, '/marketing/publicaciones/jobs', '/v1/publication-jobs', { originService: 'micro-cms' }),
  );

  router.post(
    '/marketing/publicaciones/jobs/:publicationJobId/cancel',
    withRequestId,
    authenticateInternalCmsRequest,
    createPublicacionesProxy(SERVICES, '/marketing/publicaciones/jobs', '/v1/publication-jobs', { originService: 'micro-cms' }),
  );

  router.get(
    '/marketing/publicaciones/jobs/admin/list',
    withRequestId,
    authenticateWithConfiguredSecret,
    requireTrustedBrandScope({ allowHeaderFallback: true, preferHeader: true }),
    createPublicacionesProxy(SERVICES, '/marketing/publicaciones/jobs', '/v1/publication-jobs'),
  );

  router.post(
    '/marketing/publicaciones/jobs/admin/dispatch-due',
    withRequestId,
    authenticateWithConfiguredSecret,
    requireTrustedBrandScope({ allowHeaderFallback: true, preferHeader: true }),
    createPublicacionesProxy(SERVICES, '/marketing/publicaciones/jobs', '/v1/publication-jobs'),
  );

  router.post(
    '/marketing/publicaciones/jobs/:publicationJobId/admin/retry',
    withRequestId,
    authenticateWithConfiguredSecret,
    requireTrustedBrandScope({ allowHeaderFallback: true, preferHeader: true }),
    createPublicacionesProxy(SERVICES, '/marketing/publicaciones/jobs', '/v1/publication-jobs'),
  );

  router.post(
    '/marketing/publicaciones/jobs/:publicationJobId/admin/retry-now',
    withRequestId,
    authenticateWithConfiguredSecret,
    requireTrustedBrandScope({ allowHeaderFallback: true, preferHeader: true }),
    createPublicacionesProxy(SERVICES, '/marketing/publicaciones/jobs', '/v1/publication-jobs'),
  );

  router.post(
    '/marketing/publicaciones/jobs/:publicationJobId/admin/cancel',
    withRequestId,
    authenticateWithConfiguredSecret,
    requireTrustedBrandScope({ allowHeaderFallback: true, preferHeader: true }),
    createPublicacionesProxy(SERVICES, '/marketing/publicaciones/jobs', '/v1/publication-jobs'),
  );

  router.post(
    '/marketing/publicaciones/jobs/:publicationJobId/refresh-permalink',
    withRequestId,
    authenticateWithConfiguredSecret,
    requireTrustedBrandScope({ allowHeaderFallback: true, preferHeader: true }),
    createPublicacionesProxy(SERVICES, '/marketing/publicaciones/jobs', '/v1/publication-jobs'),
  );

  router.use(
    '/marketing/publicaciones/jobs',
    withRequestId,
    authenticateWithConfiguredSecret,
    requireTrustedBrandScope(),
    createPublicacionesProxy(SERVICES, '/marketing/publicaciones/jobs', '/v1/publication-jobs'),
  );

  for (const [publicPrefix, internalPrefix, originService, allowHeaderFallback, preferHeader] of PROTECTED_PUBLICACIONES_ROUTE_REWRITES) {
    router.use(
      publicPrefix,
      withRequestId,
      authenticateWithConfiguredSecret,
      requireTrustedBrandScope({ allowHeaderFallback, preferHeader }),
      createPublicacionesProxy(SERVICES, publicPrefix, internalPrefix, { originService }),
    );
  }

  for (const [publicPrefix, internalPrefix] of PUBLIC_PUBLICACIONES_ROUTE_REWRITES) {
    router.use(
      publicPrefix,
      withRequestId,
      createPublicacionesProxy(SERVICES, publicPrefix, internalPrefix),
    );
  }

  return router;
}
