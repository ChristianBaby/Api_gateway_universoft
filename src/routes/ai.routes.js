import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { authenticateJWT } from '../middlewares/auth.middleware.js';
import { logServiceRequest, addServiceToken } from '../middlewares/service-token.middleware.js';
import { MICROSERVICE_TOKEN } from '../config/services.js';

/**
 * Rutas del microservicio IA de Marketing.
 *
 * Contrato gateway:
 *   - /marketing/ai/health -> /health (publico, sin /v1)
 *   - /marketing/ai/ready  -> /ready  (publico, sin /v1)
 *   - /marketing/ai/*      -> /v1/*   (protegido con JWT + token de servicio)
 */
export default function createAiRoutes(SERVICES) {
    const router = express.Router();
    const service = SERVICES.AI;

    const publicProbeProxy = createProxyMiddleware({
        target: service.baseUrl,
        changeOrigin: true,
        timeout: 10000,
        pathRewrite: (path) => path.replace(/^\/marketing\/ai/, ''),
        onProxyReq: (proxyReq, req) => {
            console.log(`🤖 [AI-PROBE] Proxying ${req.method} ${req.originalUrl}`);
            console.log(`🎯 [AI-PROBE] Target: ${service.baseUrl}${req.originalUrl.replace(/^\/marketing\/ai/, '')}`);
        },
        onProxyRes: (proxyRes, req) => {
            console.log(`📥 [AI-PROBE] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
        },
        onError: (err, req, res) => {
            console.error('❌ [AI-PROBE] Error en servicio IA:', err.message);
            if (!res.headersSent) {
                res.status(503).json({
                    success: false,
                    message: 'Servicio IA de marketing no disponible',
                    service: 'micro-ia',
                    error: err.message
                });
            }
        }
    });

    // Health/ready deben llegar al microservicio como /health y /ready, no como /v1/*
    router.use('/marketing/ai/health', publicProbeProxy);
    router.use('/marketing/ai/ready', publicProbeProxy);

    // Endpoints internos de IA bajo /v1/*, protegidos y con token de servicio.
    router.use('/marketing/ai',
        authenticateJWT,
        logServiceRequest('AI'),
        addServiceToken,
        createProxyMiddleware({
            target: service.baseUrl,
            changeOrigin: true,
            timeout: 120000,
            pathRewrite: {
                '^/marketing/ai': '/v1'
            },
            onProxyReq: (proxyReq, req) => {
                console.log(`🤖 [AI] Proxying ${req.method} ${req.originalUrl}`);
                console.log(`🎯 [AI] Target: ${service.baseUrl}${req.originalUrl.replace('/marketing/ai', '/v1')}`);

                // Blindaje: no dependemos solo de la mutacion de req.headers hecha por
                // addServiceToken. El micro IA valida estrictamente este header y un
                // valor ausente/mal propagado produce 401 "Token de servicio invalido".
                proxyReq.setHeader('X-Service-Token', MICROSERVICE_TOKEN);
                proxyReq.setHeader('X-Microservice-Token', MICROSERVICE_TOKEN);

                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }

                const marcaUsuarioId = req.headers['x-marca-usuario-id']
                    || req.headers['x-marketing-brand-user-id']
                    || req.headers['x-active-marca-usuario-id']
                    || req.user?.marca_usuario_id
                    || req.user?.marcaUsuarioId;

                if (marcaUsuarioId) {
                    proxyReq.setHeader('X-Marca-Usuario-Id', marcaUsuarioId);
                }
            },
            onProxyRes: (proxyRes, req) => {
                console.log(`📥 [AI] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },
            onError: (err, req, res) => {
                console.error('❌ [AI] Error en servicio IA:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio IA de marketing no disponible',
                        service: 'micro-ia',
                        error: err.message
                    });
                }
            }
        })
    );

    return router;
}
