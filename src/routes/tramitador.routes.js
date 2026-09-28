import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logServiceRequest, addServiceToken } from '../middlewares/service-token.middleware.js';

const TRAMITADOR_PROXY_TIMEOUT_MS = 240000;

/**
 * @fileoverview Rutas del microservicio Tramitador MINCUL
 * @description Proxy de /api/tramites/* hacia micro-tramitador-mincul
 */

export default function createTramitadorRoutes(SERVICES) {
    const router = express.Router();

    router.use('/api/tramites',
        logServiceRequest('TRAMITADOR'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.TRAMITADOR.baseUrl,
            changeOrigin: true,
            // El agente local ejecuta el navegador visible en el equipo del
            // operador; el CAPTCHA y el envío final siguen siendo manuales.
            timeout: TRAMITADOR_PROXY_TIMEOUT_MS,
            proxyTimeout: TRAMITADOR_PROXY_TIMEOUT_MS,

            onProxyReq: (proxyReq, req, res) => {
                console.log(`🔗 [TRAMITADOR] Proxying ${req.method} ${req.originalUrl}`);

                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }

                if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && req.body) {
                    const bodyData = JSON.stringify(req.body);
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    proxyReq.write(bodyData);
                }
            },

            onProxyRes: (proxyRes, req) => {
                console.log(`📥 [TRAMITADOR] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },

            onError: (err, req, res) => {
                console.error('❌ Error en servicio TRAMITADOR:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Microservicio de tramitador no disponible',
                        service: 'micro-tramitador-mincul',
                        error: err.message
                    });
                }
            }
        })
    );

    return router;
}
