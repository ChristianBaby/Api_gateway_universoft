import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { sessionBoundary } from '../middlewares/session.middleware.js';

export function canReviewRecordings(user) {
  const permissions = user?.permissions ?? user?.rol?.permisos;
  return user?.tipo_entidad === 'usuario' && Array.isArray(permissions) && permissions.includes('rrhh.panel.admin');
}

/** Proxy privado del Gateway hacia micro-telefonia. */
export default function createTelefoniaRoutes() {
  const router = express.Router();
  router.use('/api/telefonia', sessionBoundary, (req, res, next) => {
    const publicProbe = req.method === 'GET' && ['/health', '/ready'].includes(req.path);
    if (!publicProbe && !req.centralSessionUser?.id) return res.status(401).json({ error: 'UNAUTHORIZED' });
    if (/^\/admin(?:\/|$)/i.test(req.path) && !canReviewRecordings(req.centralSessionUser)) {
      return res.status(403).json({ error: 'RECORDINGS_ADMIN_REQUIRED' });
    }
    if (!publicProbe && !process.env.TELEFONIA_SERVICE_TOKEN) return res.status(503).json({ error: 'TELEFONIA_NOT_CONFIGURED' });
    next();
  });
  router.use('/api/telefonia', createProxyMiddleware({
    target: process.env.TELEFONIA_URL || 'http://localhost:7200',
    changeOrigin: true,
    pathRewrite: { '^/api/telefonia': '/api/telefonia' },
    timeout: 60000,
    proxyTimeout: 60000,
    onProxyReq(proxyReq, req) {
      proxyReq.removeHeader('x-service-token');
      proxyReq.removeHeader('x-microservice-token');
      proxyReq.removeHeader('cookie');
      proxyReq.removeHeader('x-user-id');
      proxyReq.removeHeader('x-user-role');
      proxyReq.removeHeader('x-user-name');
      proxyReq.removeHeader('x-user-kind');
      proxyReq.removeHeader('x-telefonia-admin');
      if (req.centralSessionUser?.id) proxyReq.setHeader('x-user-id', req.centralSessionUser.id);
      if (req.centralSessionUser?.id) {
        const user = req.centralSessionUser;
        proxyReq.setHeader('x-user-kind', user.tipo_entidad || '');
        if (canReviewRecordings(user)) proxyReq.setHeader('x-telefonia-admin', 'true');
        const name = [user.nombre, user.apellido_paterno, user.apellido_materno].filter(Boolean).join(' ') || user.name || 'Usuario Ruwark';
        proxyReq.setHeader('x-user-name', encodeURIComponent(String(name).slice(0, 100)));
      }
      proxyReq.setHeader('x-telefonia-service-token', process.env.TELEFONIA_SERVICE_TOKEN || '');
      if (req.headers.authorization) proxyReq.setHeader('authorization', req.headers.authorization);
    },
    onError(_error, _req, res) {
      if (!res.headersSent) res.status(503).json({ success: false, error: 'TELEFONIA_UNAVAILABLE' });
    },
  }));
  return router;
}
