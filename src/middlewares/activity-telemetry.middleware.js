export function createActivityTelemetry({ env = process.env, fetchImpl = (...args) => fetch(...args) } = {}) {
  return (req, res, next) => {
    const path = req.path;
    if (path.startsWith('/rrhh-api/') || path.startsWith('/api/rrhh-api/') || path.startsWith('/rrhh/') || path.startsWith('/_next/') || path.startsWith('/auth/') || path.startsWith('/api/auth/') || path === '/health') return next();
    res.once('finish', () => {
      const userId = req.user?.id;
      if (!userId || req.user?.tipo_entidad === 'cliente' || !env.RRHH_SERVICE_TOKEN || !env.RRHH_URL) return;
      // No persistir query strings, cuerpos, credenciales ni identificadores personales en la ruta.
      const route = path.replace(/^\/api(?=\/)/, '').replace(/\/[^/]*(?:@|%40)[^/]*(?=\/|$)/gi, '/:id')
        .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:id').slice(0, 180);
      void fetchImpl(new URL('/internal/kpi/session-log', env.RRHH_URL), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-service-token': env.RRHH_SERVICE_TOKEN },
        body: JSON.stringify({ usuario_id: userId, tipo: 'actividad', ip_address: req.ip || null, user_agent: req.headers['user-agent'] || null,
          datos: { metodo: req.method, ruta: route, estado_http: res.statusCode } }),
        signal: AbortSignal.timeout(1500), redirect: 'error',
      }).catch(() => {});
    });
    next();
  };
}
