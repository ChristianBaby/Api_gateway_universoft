import express from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { MICROSERVICE_TOKEN } from '../config/services.js';

const EDITOR_SERVICE_FALLBACK = 'http://localhost:4008';
const DEFAULT_EDITOR_PROXY_TIMEOUT_MS = 1800000;
const MIN_EDITOR_PROXY_TIMEOUT_MS = 1000;
const MAX_EDITOR_PROXY_TIMEOUT_MS = 1800000;
const YOUTUBE_AUDIO_PUBLIC_PREFIX = '/marketing/external-assets/youtube-audio';
const DEFAULT_YOUTUBE_AUDIO_MAX_JSON_BYTES = 16 * 1024;
const MAX_YOUTUBE_AUDIO_MAX_JSON_BYTES = 1024 * 1024;
const DEFAULT_YOUTUBE_AUDIO_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_YOUTUBE_AUDIO_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_YOUTUBE_AUDIO_RATE_LIMIT_MAX = 6;
const MAX_YOUTUBE_AUDIO_RATE_LIMIT_MAX = 1000;

const MARKETING_ROUTE_REWRITES = [
  {
    publicPrefix: '/marketing/design-documents',
    internalPrefix: '/v1/design-documents',
    scope: 'brand',
  },
  {
    publicPrefix: '/marketing/templates',
    internalPrefix: '/v1/templates',
    scope: 'template',
  },
  {
    publicPrefix: '/marketing/resources',
    internalPrefix: '/v1/resources',
    scope: 'brand',
  },
  {
    publicPrefix: '/marketing/external-assets/vecteezy',
    internalPrefix: '/v1/external-assets/vecteezy',
    scope: 'user',
  },
  {
    publicPrefix: '/marketing/external-assets/pexels',
    internalPrefix: '/v1/external-assets/pexels',
    scope: 'user',
  },
  {
    publicPrefix: YOUTUBE_AUDIO_PUBLIC_PREFIX,
    internalPrefix: '/v1/external-assets/youtube-audio',
    scope: 'brand',
    guard: 'youtube-audio',
  },
  {
    publicPrefix: '/marketing/external-assets/iconify',
    internalPrefix: '/v1/external-assets/iconify',
    scope: 'user',
  },
  {
    publicPrefix: '/marketing/output-presets',
    internalPrefix: '/v1/output-presets',
    scope: 'brand',
  },
  {
    publicPrefix: '/marketing/fonts',
    internalPrefix: '/v1/fonts',
    scope: 'user',
  },
  {
    publicPrefix: '/marketing/exports',
    internalPrefix: '/v1/exports',
    scope: 'user',
  },
];

const UNTRUSTED_BROWSER_HEADERS = [
  'X-Service-Token',
  'x-service-token',
  'Service-Token',
  'service-token',
  'X-User-Id',
  'x-user-id',
  'X-User-Email',
  'x-user-email',
  'X-Marca-Usuario-Id',
  'x-marca-usuario-id',
  'X-Marketing-Brand-User-Id',
  'x-marketing-brand-user-id',
  'X-Active-Marca-Usuario-Id',
  'x-active-marca-usuario-id',
  'X-Ruwark-Personal-Editor',
  'x-ruwark-personal-editor',
  'X-Request-Id',
  'x-request-id',
];

function generateRequestId() {
  return `gw-editor-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function resolveRequestId() {
  return generateRequestId();
}

function resolveEditorProxyTimeoutMs() {
  const rawTimeout = process.env.MICRO_EDITOR_IMAGEN_TIMEOUT_MS;

  if (!rawTimeout || !String(rawTimeout).trim()) {
    return DEFAULT_EDITOR_PROXY_TIMEOUT_MS;
  }

  const normalizedTimeout = String(rawTimeout).trim();

  if (!/^\d+$/.test(normalizedTimeout)) {
    return DEFAULT_EDITOR_PROXY_TIMEOUT_MS;
  }

  const timeoutMs = Number.parseInt(normalizedTimeout, 10);

  if (
    Number.isFinite(timeoutMs)
    && timeoutMs >= MIN_EDITOR_PROXY_TIMEOUT_MS
    && timeoutMs <= MAX_EDITOR_PROXY_TIMEOUT_MS
  ) {
    return timeoutMs;
  }

  return DEFAULT_EDITOR_PROXY_TIMEOUT_MS;
}

function resolveBoundedPositiveInteger(name, fallback, maximum) {
  const normalized = String(process.env[name] || '').trim();

  if (!/^\d+$/.test(normalized)) {
    return fallback;
  }

  const value = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum
    ? value
    : fallback;
}

function youtubeAudioJsonGuard(req, res, next) {
  if (String(req.method || '').toUpperCase() !== 'POST') {
    return next();
  }

  const contentType = String(req.headers['content-type'] || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();

  if (contentType !== 'application/json') {
    return res.status(415).json({
      success: false,
      error: 'YOUTUBE_AUDIO_JSON_REQUIRED',
      message: 'Las solicitudes de audio autorizado deben usar application/json',
      requestId: req.marketingRequestId,
    });
  }

  const rawContentLength = String(req.headers['content-length'] || '').trim();
  if (!/^\d+$/.test(rawContentLength)) {
    return res.status(411).json({
      success: false,
      error: 'YOUTUBE_AUDIO_CONTENT_LENGTH_REQUIRED',
      message: 'Content-Length válido es requerido para esta solicitud',
      requestId: req.marketingRequestId,
    });
  }

  const contentLength = Number.parseInt(rawContentLength, 10);
  const maximumBytes = resolveBoundedPositiveInteger(
    'YOUTUBE_AUDIO_GATEWAY_MAX_JSON_BYTES',
    DEFAULT_YOUTUBE_AUDIO_MAX_JSON_BYTES,
    MAX_YOUTUBE_AUDIO_MAX_JSON_BYTES,
  );

  if (!Number.isSafeInteger(contentLength) || contentLength < 1) {
    return res.status(400).json({
      success: false,
      error: 'YOUTUBE_AUDIO_JSON_BODY_REQUIRED',
      message: 'La solicitud debe incluir un cuerpo JSON',
      requestId: req.marketingRequestId,
    });
  }

  if (contentLength > maximumBytes) {
    return res.status(413).json({
      success: false,
      error: 'YOUTUBE_AUDIO_PAYLOAD_TOO_LARGE',
      message: 'La solicitud excede el tamaño permitido',
      requestId: req.marketingRequestId,
    });
  }

  return next();
}

function createYoutubeAudioCostLimiter() {
  const windowMs = resolveBoundedPositiveInteger(
    'YOUTUBE_AUDIO_GATEWAY_RATE_LIMIT_WINDOW_MS',
    DEFAULT_YOUTUBE_AUDIO_RATE_LIMIT_WINDOW_MS,
    MAX_YOUTUBE_AUDIO_RATE_LIMIT_WINDOW_MS,
  );
  const max = resolveBoundedPositiveInteger(
    'YOUTUBE_AUDIO_GATEWAY_RATE_LIMIT_MAX',
    DEFAULT_YOUTUBE_AUDIO_RATE_LIMIT_MAX,
    MAX_YOUTUBE_AUDIO_RATE_LIMIT_MAX,
  );

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => String(req.method || '').toUpperCase() !== 'POST',
    keyGenerator: (req) => {
      const context = req.trustedGatewayContext || {};
      return `youtube-audio:${context.userId || context.userEmail}`;
    },
    handler: (req, res) => res.status(429).json({
      success: false,
      error: 'YOUTUBE_AUDIO_RATE_LIMITED',
      message: 'Demasiadas solicitudes de audio autorizado; inténtalo nuevamente más tarde',
      requestId: req.marketingRequestId,
    }),
  });
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
    throw new Error('[CONFIG] JWT_SECRET es requerido en producción para validar rutas Marketing.');
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

function resolveUserEmail(user) {
  return firstTruthy(
    user?.email,
    user?.correo,
    user?.usuario?.email,
    user?.user?.email,
  );
}

function resolveUserRole(user) {
  return firstTruthy(
    user?.role,
    user?.rol,
    user?.user_role,
    user?.userRole,
    user?.tipo_usuario,
    user?.usuario?.role,
    user?.usuario?.rol,
    user?.user?.role,
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
    user?.brand?.membership_id,
  );
}

function resolveRequestedMarcaUsuarioId(req) {
  return firstTruthy(
    req.headers['x-marketing-brand-user-id'],
    req.headers['x-active-marca-usuario-id'],
  );
}

function workspaceBrandUserId(workspace) {
  return firstTruthy(
    workspace?.brandUser?.id,
    workspace?.brand_user?.id,
    workspace?.marcaUsuarioId,
    workspace?.marca_usuario_id,
  );
}

function workspaceUserId(payload) {
  return firstTruthy(
    payload?.user?.id,
    payload?.user?.usuario_id,
    payload?.userId,
    payload?.usuarioId,
  );
}

function workspaceUserEmail(payload) {
  return firstTruthy(
    payload?.user?.email,
    payload?.user?.correo,
    payload?.userEmail,
    payload?.email,
    payload?.correo,
  );
}

function workspaceBrandUserOwnerId(workspace) {
  return firstTruthy(
    workspace?.brandUser?.usuarioId,
    workspace?.brandUser?.usuario_id,
    workspace?.brandUser?.userId,
    workspace?.brandUser?.user_id,
    workspace?.brand_user?.usuarioId,
    workspace?.brand_user?.usuario_id,
    workspace?.brand_user?.userId,
    workspace?.brand_user?.user_id,
  );
}

function normalizeComparable(value) {
  return value === undefined || value === null ? null : String(value).trim();
}

function sameComparable(left, right) {
  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function sameEmail(left, right) {
  const normalizedLeft = normalizeComparable(left)?.toLowerCase();
  const normalizedRight = normalizeComparable(right)?.toLowerCase();
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function workspaceBelongsToAuthenticatedUser(payload, workspace, { userId, userEmail }) {
  const brandUserOwnerId = workspaceBrandUserOwnerId(workspace);
  if (brandUserOwnerId) {
    return sameComparable(brandUserOwnerId, userId);
  }

  const payloadUserId = workspaceUserId(payload);
  if (payloadUserId) {
    return sameComparable(payloadUserId, userId);
  }

  const payloadUserEmail = workspaceUserEmail(payload);
  if (payloadUserEmail) {
    return sameEmail(payloadUserEmail, userEmail);
  }

  return false;
}

function unwrapWorkspacePayload(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

async function fetchCmsWorkspace({ cmsBaseUrl, userId, userEmail, requestId, requestedMarcaUsuarioId }) {
  const response = await fetch(`${cmsBaseUrl.replace(/\/$/, '')}/marketing/cms/workspace`, {
    method: 'GET',
    headers: {
      'X-Service-Name': 'api-gateway',
      'X-Gateway-Request': 'true',
      'X-Service-Token': MICROSERVICE_TOKEN,
      'X-Request-Id': requestId,
      ...(userId ? { 'X-User-Id': userId } : {}),
      ...(userEmail ? { 'X-User-Email': userEmail } : {}),
      ...(requestedMarcaUsuarioId ? { 'X-Marca-Usuario-Id': requestedMarcaUsuarioId } : {}),
    },
  });

  if (!response.ok) {
    return null;
  }

  return unwrapWorkspacePayload(await response.json());
}

function getWorkspaceEntries(payload) {
  return Array.isArray(payload?.brands)
    ? payload.brands
    : payload?.brand
      ? [{ brand: payload.brand, brandUser: payload.brandUser }]
      : [];
}

function scopeFromWorkspacePayload(payload, requestedMarcaUsuarioId) {
  const workspaces = getWorkspaceEntries(payload);

  if (requestedMarcaUsuarioId) {
    const requested = workspaces.find((workspace) => String(workspaceBrandUserId(workspace)) === String(requestedMarcaUsuarioId));
    return requested
      ? {
        marcaUsuarioId: String(workspaceBrandUserId(requested)),
        userId: workspaceUserId(payload),
        workspace: requested,
        payload,
      }
      : null;
  }

  const active = payload?.activeBrandId
    ? workspaces.find((workspace) => String(workspace?.brand?.id) === String(payload.activeBrandId))
    : null;
  const selected = active || workspaces[0];
  const marcaUsuarioId = workspaceBrandUserId(selected);
  return marcaUsuarioId
    ? {
      marcaUsuarioId: String(marcaUsuarioId),
      userId: workspaceUserId(payload),
      workspace: selected,
      payload,
    }
    : null;
}

async function resolveMarcaUsuarioIdFromCmsWorkspace({
  SERVICES,
  userId,
  userEmail,
  requestId,
  requestedMarcaUsuarioId,
}) {
  const cmsBaseUrl = SERVICES.CMS?.baseUrl;
  if (!cmsBaseUrl || (!userId && !userEmail)) return null;

  const userScopedPayload = await fetchCmsWorkspace({
    cmsBaseUrl,
    userId,
    userEmail,
    requestId,
  });
  const userScopedScope = userScopedPayload
    ? scopeFromWorkspacePayload(userScopedPayload, requestedMarcaUsuarioId)
    : null;

  if (userScopedScope) {
    return userScopedScope;
  }

  if (!requestedMarcaUsuarioId) {
    return null;
  }

  const requestedScopedPayload = await fetchCmsWorkspace({
    cmsBaseUrl,
    userId,
    userEmail,
    requestId,
    requestedMarcaUsuarioId,
  });
  const requestedScopedScope = requestedScopedPayload
    ? scopeFromWorkspacePayload(requestedScopedPayload, requestedMarcaUsuarioId)
    : null;

  if (!requestedScopedScope) {
    return null;
  }

  return workspaceBelongsToAuthenticatedUser(requestedScopedScope.payload, requestedScopedScope.workspace, { userId, userEmail })
    ? requestedScopedScope
    : null;
}

function withRequestId(req, res, next) {
  req.marketingRequestId = resolveRequestId(req);
  res.setHeader('X-Request-Id', req.marketingRequestId);
  next();
}

function authenticateMarketingJwt(req, res, next, jwtSecret = getJwtSecret()) {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Token de acceso requerido',
      requestId: req.marketingRequestId,
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
      requestId: req.marketingRequestId,
    });
  }
}

function isUserScopedDesignDocumentRoute(req) {
  const suffix = req.path || '/';

  if (req.method === 'GET' && /^\/?$/.test(suffix)) {
    return true;
  }

  if (req.method === 'POST' && suffix === '/standalone') {
    return true;
  }

  if (req.method === 'GET' && /^\/[^/]+\/?$/.test(suffix)) {
    return true;
  }

  if (req.method === 'DELETE' && /^\/[^/]+\/?$/.test(suffix)) {
    return true;
  }

  if (req.method === 'PATCH' && /^\/[^/]+\/?$/.test(suffix)) {
    return true;
  }

  if (['GET', 'PATCH'].includes(req.method) && /^\/[^/]+\/draft\/?$/.test(suffix)) {
    return true;
  }

  if (req.method === 'POST' && /^\/[^/]+\/(validate|approve|preview)\/?$/.test(suffix)) {
    return true;
  }

  return false;
}

async function attachTrustedEditorScope(req, res, next, { SERVICES, requireBrand = false, forceUser = false } = {}) {
  const tokenMarcaUsuarioId = forceUser ? null : resolveMarcaUsuarioId(req.user);
  let marcaUsuarioId = tokenMarcaUsuarioId;
  const userId = resolveUserId(req.user);
  let trustedUserId = userId;
  const userEmail = resolveUserEmail(req.user);
  const requestedMarcaUsuarioId = forceUser ? null : resolveRequestedMarcaUsuarioId(req);

  if (!userId && !userEmail) {
    return res.status(403).json({
      success: false,
      error: 'USER_SCOPE_DENIED',
      message: 'No se pudo resolver la identidad del usuario',
      requestId: req.marketingRequestId,
    });
  }

  if (requestedMarcaUsuarioId && String(requestedMarcaUsuarioId) !== String(tokenMarcaUsuarioId || '')) {
    try {
      const cmsScope = await resolveMarcaUsuarioIdFromCmsWorkspace({
        SERVICES,
        userId,
        userEmail,
        requestId: req.marketingRequestId,
        requestedMarcaUsuarioId,
      });
      marcaUsuarioId = cmsScope?.marcaUsuarioId || null;
      trustedUserId = cmsScope?.userId || trustedUserId;
    } catch (error) {
      console.warn(`⚠️ [MARKETING-EDITOR] No se pudo verificar marca solicitada requestId=${req.marketingRequestId}: ${error.message}`);
      marcaUsuarioId = null;
    }

    if (!marcaUsuarioId && requireBrand) {
      return res.status(403).json({
        success: false,
        error: 'BRAND_SCOPE_DENIED',
        message: 'La marca solicitada no pertenece al usuario autenticado',
        requestId: req.marketingRequestId,
      });
    }
  } else if (!marcaUsuarioId && requireBrand) {
    try {
      const cmsScope = await resolveMarcaUsuarioIdFromCmsWorkspace({
        SERVICES,
        userId,
        userEmail,
        requestId: req.marketingRequestId,
        requestedMarcaUsuarioId,
      });
      marcaUsuarioId = cmsScope?.marcaUsuarioId || null;
      trustedUserId = cmsScope?.userId || trustedUserId;
    } catch (error) {
      console.warn(`⚠️ [MARKETING-EDITOR] No se pudo resolver workspace CMS requestId=${req.marketingRequestId}: ${error.message}`);
    }
  }

  if (!marcaUsuarioId) {
    if (requireBrand) {
      return res.status(403).json({
        success: false,
        error: 'BRAND_SCOPE_DENIED',
        message: 'No se pudo resolver el alcance de marca del usuario',
        requestId: req.marketingRequestId,
      });
    }
  }

  req.trustedGatewayContext = {
    requestId: req.marketingRequestId,
  };

  if (trustedUserId) {
    req.trustedGatewayContext.userId = trustedUserId;
  }

  if (userEmail) {
    req.trustedGatewayContext.userEmail = userEmail;
  }

  if (marcaUsuarioId) {
    req.trustedGatewayContext.marcaUsuarioId = marcaUsuarioId;
  }

  return next();
}

function requireTrustedBrandScope(SERVICES) {
  return (req, res, next) => {
    const personalSalesEditor = req.headers['x-ruwark-personal-editor'] === 'true'
      && String(resolveUserRole(req.user) || '').toLowerCase() === 'ventas';
    void attachTrustedEditorScope(req, res, next, {
      SERVICES, requireBrand: !personalSalesEditor, forceUser: personalSalesEditor,
    }).catch(next);
  };
}

function requireTrustedUserScope(SERVICES) {
  return (req, res, next) => {
    void attachTrustedEditorScope(req, res, next, { SERVICES, requireBrand: false }).catch(next);
  };
}

function requireDesignDocumentScope(SERVICES) {
  return (req, res, next) => {
    const personalSalesEditor = req.headers['x-ruwark-personal-editor'] === 'true'
      && String(resolveUserRole(req.user) || '').toLowerCase() === 'ventas'
      && isUserScopedDesignDocumentRoute(req);
    void attachTrustedEditorScope(req, res, next, {
      SERVICES,
      requireBrand: !personalSalesEditor && !isUserScopedDesignDocumentRoute(req),
      forceUser: personalSalesEditor,
    }).catch(next);
  };
}

function requireTemplateScope(SERVICES) {
  return (req, res, next) => {
    const method = String(req.method || 'GET').toUpperCase();
    const readOnly = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
    void attachTrustedEditorScope(req, res, next, {
      SERVICES,
      requireBrand: !readOnly,
    }).catch(next);
  };
}

function removeUntrustedHeaders(proxyReq) {
  for (const header of UNTRUSTED_BROWSER_HEADERS) {
    proxyReq.removeHeader(header);
  }
}

export function rewriteMarketingPath(path, publicPrefix, internalPrefix) {
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

function createMarketingProxy(SERVICES, publicPrefix, internalPrefix) {
  const target = SERVICES.EDITOR_IMAGEN?.baseUrl || EDITOR_SERVICE_FALLBACK;
  const proxyTimeoutMs = resolveEditorProxyTimeoutMs();
  const logRequestPath = publicPrefix === YOUTUBE_AUDIO_PUBLIC_PREFIX
    ? `${YOUTUBE_AUDIO_PUBLIC_PREFIX}/*`
    : null;

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    timeout: proxyTimeoutMs,
    proxyTimeout: proxyTimeoutMs,
    logLevel: 'warn',
    pathRewrite: (path) => rewriteMarketingPath(path, publicPrefix, internalPrefix),
    onProxyReq: (proxyReq, req) => {
      const context = req.trustedGatewayContext || {};

      removeUntrustedHeaders(proxyReq);
      if (publicPrefix === YOUTUBE_AUDIO_PUBLIC_PREFIX) {
        proxyReq.removeHeader('authorization');
        proxyReq.removeHeader('cookie');
        proxyReq.removeHeader('proxy-authorization');
      }
      proxyReq.setHeader('X-Service-Name', 'api-gateway');
      proxyReq.setHeader('X-Gateway-Request', 'true');
      proxyReq.setHeader('X-Service-Token', MICROSERVICE_TOKEN);
      proxyReq.setHeader('X-Request-Id', context.requestId || req.marketingRequestId || generateRequestId());

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

      if (context.userEmail) {
        proxyReq.setHeader('X-User-Email', context.userEmail);
      } else {
        proxyReq.removeHeader('X-User-Email');
      }

      console.log(`🎨 [MARKETING-EDITOR] ${req.method} ${logRequestPath || req.originalUrl} -> ${internalPrefix}* requestId=${context.requestId}`);
    },
    onProxyRes: (proxyRes, req) => {
      console.log(`📥 [MARKETING-EDITOR] Response ${proxyRes.statusCode} for ${req.method} ${logRequestPath || req.originalUrl} requestId=${req.marketingRequestId}`);
    },
    onError: (err, req, res) => {
      console.error(`❌ [MARKETING-EDITOR] Proxy error ${err.code || 'UNKNOWN'} requestId=${req.marketingRequestId}`);
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: 'EDITOR_SERVICE_UNAVAILABLE',
          message: 'Servicio de editor de imagen no disponible',
          requestId: req.marketingRequestId,
        });
      }
    },
  });
}

export default function createMarketingEditorRoutes(SERVICES) {
  const router = express.Router();
  const jwtSecret = getJwtSecret();
  const authenticateWithConfiguredSecret = (req, res, next) => (
    authenticateMarketingJwt(req, res, next, jwtSecret)
  );

  const scopeMiddlewareByPolicy = {
    brand: requireTrustedBrandScope(SERVICES),
    user: requireTrustedUserScope(SERVICES),
    'design-document': requireDesignDocumentScope(SERVICES),
    template: requireTemplateScope(SERVICES),
  };
  const youtubeAudioCostLimiter = createYoutubeAudioCostLimiter();

  for (const {
    publicPrefix,
    internalPrefix,
    scope,
    guard,
  } of MARKETING_ROUTE_REWRITES) {
    const scopeMiddleware = scopeMiddlewareByPolicy[scope] || requireTrustedBrandScope;
    const guardedMiddlewares = guard === 'youtube-audio'
      ? [youtubeAudioJsonGuard, youtubeAudioCostLimiter]
      : [];

    router.use(
      publicPrefix,
      withRequestId,
      authenticateWithConfiguredSecret,
      scopeMiddleware,
      ...guardedMiddlewares,
      createMarketingProxy(SERVICES, publicPrefix, internalPrefix),
    );
  }

  return router;
}
