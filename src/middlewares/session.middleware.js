import { createHash } from 'node:crypto';

// Off by default: central revocation must apply on the next request. Opt in with SESSION_VERIFY_CACHE_MS.
const DEFAULT_TTL_MS = Number(process.env.SESSION_VERIFY_CACHE_MS) || 0;
const MAX_CACHE_ENTRIES = 5000;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// Solo para leer `exp`; la verificación de firma sigue siendo responsabilidad
// de micro-login-users. Si el decode falla, se usa el TTL normal.
function jwtExpiryMs(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function createSessionBoundary({
  fetchImpl = (...args) => fetch(...args),
  loginUrl = () => process.env.AUTH_SERVICE_URL || 'http://localhost:4000',
  cacheTtlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const cache = new Map(); // sha256(token) -> { user, expiresAt }
  const inflight = new Map(); // sha256(token) -> Promise<user>

  function pruneAndInsert(key, entry) {
    for (const [k, v] of cache) {
      if (v.expiresAt <= now()) cache.delete(k);
    }
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, entry);
  }

  async function verify(token) {
    const response = await fetchImpl(new URL('/api/auth/verify', typeof loginUrl === 'function' ? loginUrl() : loginUrl), {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) {
      const err = new Error('INVALID_SESSION'); err.invalidSession = true; throw err;
    }
    if (!response.ok) throw new Error('IDENTITY_UNAVAILABLE');
    const body = await response.json();
    if (!body.success || body.data?.valid !== true || !body.data.user?.id) throw new Error('IDENTITY_UNAVAILABLE');
    return body.data.user;
  }

  return async function sessionBoundary(req, res, next) {
    const token = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] || req.cookies?.token;
    // Login y renovación deben funcionar aunque el navegador conserve un access vencido.
    const path = req.path.replace(/^\/api(?=\/)/, '').replace(/\/$/, '');
    // This exact endpoint authorizes a download capability in its POST body.
    // An unrelated expired browser session must not block an external recipient.
    if (path === '/rrhh-api/correo/descargas' && ['GET','POST'].includes(req.method)) return next();
    // El conector local MINCUL usa un token de un solo propósito, propio del
    // microservicio de trámites (expira en minutos, nunca es una sesión de
    // usuario) — micro-tramites-ruwark ya lo valida por su cuenta. Sin esta
    // excepción, el gateway lo trataba como sesión revocada y devolvía 401
    // antes de que la petición llegara al microservicio.
    if (path.startsWith('/tramites/conector/')) return next();
    if (req.method === 'OPTIONS' || ['/auth/login', '/auth/register', '/auth/refresh-token', '/auth/clientes/login', '/auth/clientes/register', '/auth/clientes/refresh-token'].includes(path) || !token) return next();
    if (req.centralSessionToken === token) { req.user = req.centralSessionUser; return next(); }

    const key = hashToken(token);
    if (cacheTtlMs > 0) {
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) {
        req.centralSessionToken = token;
        req.centralSessionUser = cached.user;
        req.user = cached.user;
        return next();
      }
    }

    try {
      let promise = inflight.get(key);
      if (!promise) {
        promise = verify(token);
        inflight.set(key, promise);
      }
      let user;
      try {
        user = await promise;
      } finally {
        if (inflight.get(key) === promise) inflight.delete(key);
      }
      if (cacheTtlMs > 0) {
        let expiresAt = now() + cacheTtlMs;
        const jwtExp = jwtExpiryMs(token);
        if (jwtExp !== null) expiresAt = Math.min(expiresAt, jwtExp);
        pruneAndInsert(key, { user, expiresAt });
      }
      req.centralSessionToken = token;
      req.centralSessionUser = user;
      req.user = user;
      return next();
    } catch (err) {
      if (err?.invalidSession) return res.status(401).json({ success: false, error: 'INVALID_SESSION' });
      return res.status(503).json({ success: false, error: 'IDENTITY_UNAVAILABLE' });
    }
  };
}
export const sessionBoundary = createSessionBoundary();
