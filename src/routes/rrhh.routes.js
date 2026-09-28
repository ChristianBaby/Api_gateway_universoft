import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

export default function createRrhhRoutes() {
  const router = express.Router();
  router.use('/rrhh-api', createProxyMiddleware({
    target: process.env.RRHH_URL || 'http://localhost:7100',
    changeOrigin: true, pathRewrite: { '^/rrhh-api': '' }, timeout: 60000, proxyTimeout: 60000,
    onProxyReq(proxyReq) {
      proxyReq.removeHeader('x-service-token');
      proxyReq.removeHeader('cookie');
    },
    onError(error, req, res) {
      if (!res.headersSent) res.status(503).json({ success: false, error: 'RRHH_UNAVAILABLE' });
    },
  }));
  return router;
}
