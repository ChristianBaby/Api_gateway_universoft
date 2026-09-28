import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logServiceRequest, addServiceToken } from '../middlewares/service-token.middleware.js';

/**
 * @fileoverview Rutas del microservicio del bot de WhatsApp (micro-whatsapp-bot)
 * @description Proxy hacia el backend del panel de WhatsApp (leads, campañas, respuestas, auto-respuestas).
 * El backend real vive detrás de /api/* — aquí se expone públicamente bajo /api/whatsapp/*
 * y se reescribe hacia /api/* al reenviar. El body NO se parsea antes de este punto
 * (ver server.js: express.json() queda después de las rutas), así que el stream
 * original (JSON o multipart) pasa intacto sin necesidad de re-serializarlo.
 */
export default function createWhatsappRoutes(SERVICES) {
    const router = express.Router();

    router.use('/api/whatsapp',
        logServiceRequest('WHATSAPP'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.WHATSAPP.baseUrl,
            changeOrigin: true,
            timeout: 30000,
            pathRewrite: {
                '^/api/whatsapp': '/api'
            },
            onProxyReq: (proxyReq, req) => {
                console.log(`🔗 [WHATSAPP] Proxying ${req.method} ${req.originalUrl}`);
            },
            onProxyRes: (proxyRes, req) => {
                console.log(`📥 [WHATSAPP] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },
            onError: (err, req, res) => {
                console.error('❌ Error en servicio WHATSAPP:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio del bot de WhatsApp no disponible',
                        service: 'micro-whatsapp-bot',
                        error: err.message
                    });
                }
            }
        })
    );

    return router;
}
