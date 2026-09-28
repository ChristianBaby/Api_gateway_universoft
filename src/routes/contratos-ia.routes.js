import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { authenticateJWT } from '../middlewares/auth.middleware.js';
import { MICROSERVICE_TOKEN } from '../config/services.js';

/**
 * Rutas de micro-scanner-contratos (escáner de PDF a JSON dinámico).
 *
 * Contrato gateway:
 *   GET  /api/contratos-ia/health  -> /health              (público)
 *   POST /api/contratos-ia/extract -> /api/extract-contrato (JWT + token de servicio)
 */
export default function createContratosIaRoutes(SERVICES) {
    const router = express.Router();
    const service = SERVICES.SCANNER_CONTRATOS;

    router.use('/api/contratos-ia/health', createProxyMiddleware({
        target: service.baseUrl,
        changeOrigin: true,
        timeout: 10000,
        pathRewrite: () => '/health',
        onError: (err, req, res) => {
            console.error('❌ [CONTRATOS-IA-HEALTH] Error:', err.message);
            if (!res.headersSent) {
                res.status(503).json({ success: false, error: 'Servicio de scanner de contratos no disponible' });
            }
        }
    }));

    router.use('/api/contratos-ia/extract',
        authenticateJWT,
        createProxyMiddleware({
            target: service.baseUrl,
            changeOrigin: true,
            timeout: 120000, // Gemini File API (upload + generate) puede tardar; precedente MEMORIA_DESCRIPTIVA=120000

            pathRewrite: () => '/api/extract-contrato',

            onProxyReq: (proxyReq, req) => {
                console.log(`📄 [CONTRATOS-IA] ${req.method} ${req.originalUrl}`);
                proxyReq.setHeader('X-Service-Token', MICROSERVICE_TOKEN);

                // NO reescribir el body: el request es multipart/form-data (PDF +
                // campos JSON) y http-proxy-middleware debe streamearlo tal cual,
                // igual que memoria-descriptiva.routes.js.
            },

            onError: (err, req, res) => {
                console.error('❌ [CONTRATOS-IA] Error:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        error: 'Error en el servicio de scanner de contratos',
                        message: err.message
                    });
                }
            }
        })
    );

    return router;
}
