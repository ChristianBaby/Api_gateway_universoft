import express from 'express';
import jwt from 'jsonwebtoken';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { MICROSERVICE_TOKEN } from '../config/services.js';

const VIDEO_SERVICE_FALLBACK = 'http://localhost:4008';
const DEFAULT_VIDEO_PROXY_TIMEOUT_MS = 180000;
const MIN_VIDEO_PROXY_TIMEOUT_MS = 1000;
const MAX_VIDEO_PROXY_TIMEOUT_MS = 300000;

const VIDEO_ROUTE_REWRITES = [
  {
    publicPrefix: '/marketing/video-projects',
    internalPrefix: '/v1/video-projects',
    kind: 'projects',
  },
  {
    publicPrefix: '/marketing/video-templates',
    internalPrefix: '/v1/video-templates',
    kind: 'templates',
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
  'X-User-Role',
  'x-user-role',
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
  return `gw-video-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function resolveVideoProxyTimeoutMs() {
  const rawTimeout = process.env.MICRO_EDITOR_VIDEO_TIMEOUT_MS || process.env.MICRO_EDITOR_IMAGEN_TIMEOUT_MS;
  if (!rawTimeout || !String(rawTimeout).trim()) return DEFAULT_VIDEO_PROXY_TIMEOUT_MS;
  const normalizedTimeout = String(rawTimeout).trim();
  if (!/^\d+$/.test(normalizedTimeout)) return DEFAULT_VIDEO_PROXY_TIMEOUT_MS;
  const timeoutMs = Number.parseInt(normalizedTimeout, 10);
  return Number.isFinite(timeoutMs)
    && timeoutMs >= MIN_VIDEO_PROXY_TIMEOUT_MS
    && timeoutMs <= MAX_VIDEO_PROXY_TIMEOUT_MS
    ? timeoutMs
    : DEFAULT_VIDEO_PROXY_TIMEOUT_MS;
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim() || null;
}

function getJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) return process.env.JWT_SECRET.trim();
  if (['production', 'prod', 'staging'].includes(String(process.env.NODE_ENV || '').trim().toLowerCase())) {
    throw new Error('[CONFIG] JWT_SECRET es requerido en producción para validar rutas Marketing Video.');
  }
  return 'ruwark-secret-key-2024';
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
  return firstTruthy(user?.email, user?.correo, user?.usuario?.email, user?.user?.email);
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

function unwrapWorkspacePayload(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

function getWorkspaceEntries(payload) {
  return Array.isArray(payload?.brands)
    ? payload.brands
    : payload?.brand
      ? [{ brand: payload.brand, brandUser: payload.brandUser }]
      : [];
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
  return firstTruthy(payload?.user?.id, payload?.user?.usuario_id, payload?.userId, payload?.usuarioId);
}

function workspaceUserEmail(payload) {
  return firstTruthy(payload?.user?.email, payload?.user?.correo, payload?.userEmail, payload?.email, payload?.correo);
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

function workspaceBelongsToAuthenticatedUser(payload, workspace, { userId, userEmail }) {
  const brandUserOwnerId = workspaceBrandUserOwnerId(workspace);
  if (brandUserOwnerId) return sameComparable(brandUserOwnerId, userId);
  const payloadUserId = workspaceUserId(payload);
  if (payloadUserId) return sameComparable(payloadUserId, userId);
  const payloadUserEmail = workspaceUserEmail(payload);
  return payloadUserEmail ? sameEmail(payloadUserEmail, userEmail) : false;
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
  if (!response.ok) return null;
  return unwrapWorkspacePayload(await response.json());
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

  const userScopedPayload = await fetchCmsWorkspace({ cmsBaseUrl, userId, userEmail, requestId });
  const userScopedScope = userScopedPayload
    ? scopeFromWorkspacePayload(userScopedPayload, requestedMarcaUsuarioId)
    : null;
  if (userScopedScope) return userScopedScope;
  if (!requestedMarcaUsuarioId) return null;

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
  if (!requestedScopedScope) return null;
  return workspaceBelongsToAuthenticatedUser(requestedScopedScope.payload, requestedScopedScope.workspace, { userId, userEmail })
    ? requestedScopedScope
    : null;
}

function withRequestId(req, res, next) {
  req.videoRequestId = generateRequestId();
  res.setHeader('X-Request-Id', req.videoRequestId);
  next();
}

function authenticateVideoJwt(req, res, next, jwtSecret = getJwtSecret()) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Token de acceso requerido',
      requestId: req.videoRequestId,
    });
  }
  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Token inválido o expirado',
      requestId: req.videoRequestId,
    });
  }
}

function videoRouteRequiresBrand(req, routeKind) {
  const method = String(req.method || 'GET').toUpperCase();
  if (routeKind === 'templates') return !['GET', 'HEAD', 'OPTIONS'].includes(method);
  return !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

async function attachTrustedVideoScope(req, res, next, { SERVICES, routeKind }) {
  const personalSalesEditor = req.headers['x-ruwark-personal-editor'] === 'true'
    && String(resolveUserRole(req.user) || '').toLowerCase() === 'ventas'
    && routeKind === 'projects';
  const tokenMarcaUsuarioId = personalSalesEditor ? null : resolveMarcaUsuarioId(req.user);
  let marcaUsuarioId = tokenMarcaUsuarioId;
  const userId = resolveUserId(req.user);
  let trustedUserId = userId;
  const userEmail = resolveUserEmail(req.user);
  const userRole = resolveUserRole(req.user);
  const method = String(req.method || 'GET').toUpperCase();
  const isPublicTemplateRead = routeKind === 'templates' && ['GET', 'HEAD', 'OPTIONS'].includes(method);
  const requestedMarcaUsuarioId = (isPublicTemplateRead || personalSalesEditor) ? null : resolveRequestedMarcaUsuarioId(req);
  const requireBrand = !personalSalesEditor && videoRouteRequiresBrand(req, routeKind);

  if (!userId && !userEmail) {
    return res.status(403).json({
      success: false,
      error: 'USER_SCOPE_DENIED',
      message: 'No se pudo resolver la identidad del usuario',
      requestId: req.videoRequestId,
    });
  }

  if (requestedMarcaUsuarioId && String(requestedMarcaUsuarioId) !== String(tokenMarcaUsuarioId || '')) {
    try {
      const cmsScope = await resolveMarcaUsuarioIdFromCmsWorkspace({
        SERVICES,
        userId,
        userEmail,
        requestId: req.videoRequestId,
        requestedMarcaUsuarioId,
      });
      marcaUsuarioId = cmsScope?.marcaUsuarioId || null;
      trustedUserId = cmsScope?.userId || trustedUserId;
    } catch (error) {
      console.warn(`⚠️ [MARKETING-VIDEO] No se pudo verificar marca solicitada requestId=${req.videoRequestId}: ${error.message}`);
      marcaUsuarioId = null;
    }
  } else if (!marcaUsuarioId && requireBrand) {
    try {
      const cmsScope = await resolveMarcaUsuarioIdFromCmsWorkspace({
        SERVICES,
        userId,
        userEmail,
        requestId: req.videoRequestId,
        requestedMarcaUsuarioId,
      });
      marcaUsuarioId = cmsScope?.marcaUsuarioId || null;
      trustedUserId = cmsScope?.userId || trustedUserId;
    } catch (error) {
      console.warn(`⚠️ [MARKETING-VIDEO] No se pudo resolver workspace CMS requestId=${req.videoRequestId}: ${error.message}`);
    }
  }

  if (requireBrand && !marcaUsuarioId) {
    return res.status(403).json({
      success: false,
      error: 'BRAND_SCOPE_DENIED',
      message: 'No se pudo resolver el alcance de marca para Video Studio',
      requestId: req.videoRequestId,
    });
  }

  req.trustedVideoGatewayContext = {
    requestId: req.videoRequestId,
    ...(trustedUserId ? { userId: trustedUserId } : {}),
    ...(userEmail ? { userEmail } : {}),
    ...(userRole ? { userRole } : {}),
    ...(marcaUsuarioId ? { marcaUsuarioId } : {}),
  };
  return next();
}

function requireVideoScope(SERVICES, routeKind) {
  return (req, res, next) => {
    void attachTrustedVideoScope(req, res, next, { SERVICES, routeKind }).catch(next);
  };
}

function removeUntrustedHeaders(proxyReq) {
  for (const header of UNTRUSTED_BROWSER_HEADERS) {
    proxyReq.removeHeader(header);
  }
}

export function rewriteMarketingVideoPath(path, publicPrefix, internalPrefix) {
  let suffix = path || '/';
  if (suffix.startsWith(publicPrefix)) {
    suffix = suffix.slice(publicPrefix.length) || '/';
  }
  if (suffix === '/') return internalPrefix;
  if (suffix.startsWith('/?')) return `${internalPrefix}${suffix.slice(1)}`;
  if (suffix.startsWith('?')) return `${internalPrefix}${suffix}`;
  return `${internalPrefix}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

function createMarketingVideoProxy(SERVICES, publicPrefix, internalPrefix) {
  const target = SERVICES.VIDEO_STUDIO?.baseUrl || SERVICES.EDITOR_IMAGEN?.baseUrl || VIDEO_SERVICE_FALLBACK;
  const proxyTimeoutMs = resolveVideoProxyTimeoutMs();
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    timeout: proxyTimeoutMs,
    proxyTimeout: proxyTimeoutMs,
    logLevel: 'warn',
    pathRewrite: (path) => rewriteMarketingVideoPath(path, publicPrefix, internalPrefix),
    onProxyReq: (proxyReq, req) => {
      const context = req.trustedVideoGatewayContext || {};
      removeUntrustedHeaders(proxyReq);
      proxyReq.setHeader('X-Service-Name', 'api-gateway');
      proxyReq.setHeader('X-Gateway-Request', 'true');
      proxyReq.setHeader('X-Service-Token', MICROSERVICE_TOKEN);
      proxyReq.setHeader('X-Request-Id', context.requestId || req.videoRequestId || generateRequestId());

      if (context.marcaUsuarioId) proxyReq.setHeader('X-Marca-Usuario-Id', context.marcaUsuarioId);
      else proxyReq.removeHeader('X-Marca-Usuario-Id');

      if (context.userId) proxyReq.setHeader('X-User-Id', context.userId);
      else proxyReq.removeHeader('X-User-Id');

      if (context.userEmail) proxyReq.setHeader('X-User-Email', context.userEmail);
      else proxyReq.removeHeader('X-User-Email');

      if (context.userRole) proxyReq.setHeader('X-User-Role', context.userRole);
      else proxyReq.removeHeader('X-User-Role');

      console.log(`🎬 [MARKETING-VIDEO] ${req.method} ${req.originalUrl} -> ${internalPrefix}* requestId=${context.requestId}`);
    },
    onProxyRes: (proxyRes, req) => {
      console.log(`📥 [MARKETING-VIDEO] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl} requestId=${req.videoRequestId}`);
    },
    onError: (err, req, res) => {
      console.error(`❌ [MARKETING-VIDEO] Proxy error ${err.code || 'UNKNOWN'} requestId=${req.videoRequestId}`);
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: 'VIDEO_SERVICE_UNAVAILABLE',
          message: 'Servicio de Video Studio no disponible',
          requestId: req.videoRequestId,
        });
      }
    },
  });
}

export default function createMarketingVideoRoutes(SERVICES) {
  const router = express.Router();
  const jwtSecret = getJwtSecret();
  const authenticateWithConfiguredSecret = (req, res, next) => authenticateVideoJwt(req, res, next, jwtSecret);

  for (const { publicPrefix, internalPrefix, kind } of VIDEO_ROUTE_REWRITES) {
    router.use(
      publicPrefix,
      withRequestId,
      authenticateWithConfiguredSecret,
      requireVideoScope(SERVICES, kind),
      createMarketingVideoProxy(SERVICES, publicPrefix, internalPrefix),
    );
  }

  return router;
}
