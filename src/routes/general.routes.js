import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logServiceRequest, addServiceToken } from '../middlewares/service-token.middleware.js';

/**
 * @fileoverview Rutas del microservicio general
 * @description Maneja documentos, hojas de cálculo, notas, publicaciones y enlaces externos
 */

export default function createGeneralRoutes(SERVICES) {
    const router = express.Router();

    // ============================================
    // RUTAS PARA MICROSERVICIO GENERAL
    // ============================================

    // Rutas de documentos
    router.use('/api/documents',
        logServiceRequest('GENERAL'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.GENERAL.baseUrl,
            changeOrigin: true,
            timeout: 15000,
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`🔗 [DOCUMENTOS] Proxying ${req.method} ${req.originalUrl}`);
                
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
            
            onProxyRes: (proxyRes, req, res) => {
                console.log(`📥 [DOCUMENTOS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },
            
            onError: (err, req, res) => {
                console.error('❌ Error en servicio DOCUMENTOS:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de documentos no disponible',
                        service: 'micro-general',
                        error: err.message
                    });
                }
            }
        })
    );

    // Rutas de hojas de cálculo
    router.use('/api/spreadsheets',
        logServiceRequest('GENERAL'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.GENERAL.baseUrl,
            changeOrigin: true,
            timeout: 15000,
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`🔗 [HOJAS] Proxying ${req.method} ${req.originalUrl}`);
                
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
            
            onProxyRes: (proxyRes, req, res) => {
                console.log(`📥 [HOJAS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },
            
            onError: (err, req, res) => {
                console.error('❌ Error en servicio HOJAS:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de hojas de cálculo no disponible',
                        service: 'micro-general',
                        error: err.message
                    });
                }
            }
        })
    );

    // Rutas de notas inteligentes (MIGRADO desde micro-operaciones)
    router.use('/api/notes',
        logServiceRequest('GENERAL'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.GENERAL.baseUrl,
            changeOrigin: true,
            timeout: 15000,
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`🔗 [NOTAS] Proxying ${req.method} ${req.originalUrl}`);
                console.log(`🎯 [NOTAS] Target: ${SERVICES.GENERAL.baseUrl}${req.originalUrl}`);
                
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }
                
                if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && req.body) {
                    console.log(`📦 [NOTAS] Body data:`, req.body);
                    const bodyData = JSON.stringify(req.body);
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    proxyReq.write(bodyData);
                }
            },
            
            onProxyRes: (proxyRes, req, res) => {
                console.log(`📥 [NOTAS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },
            
            onError: (err, req, res) => {
                console.error('❌ Error en servicio NOTAS:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de notas no disponible',
                        service: 'micro-general',
                        error: err.message
                    });
                }
            }
        })
    );

    // Rutas de publicaciones
    router.use('/api/publicaciones',
        logServiceRequest('GENERAL'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.GENERAL.baseUrl,
            changeOrigin: true,
            timeout: 15000,
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`🔗 [PUBLICACIONES] Proxying ${req.method} ${req.originalUrl}`);
                console.log(`🎯 [PUBLICACIONES] Target: ${SERVICES.GENERAL.baseUrl}${req.originalUrl}`);
                
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }
                
                if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') && req.body) {
                    console.log(`📦 [PUBLICACIONES] Body data:`, req.body);
                    const bodyData = JSON.stringify(req.body);
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    proxyReq.write(bodyData);
                }
            },
            
            onProxyRes: (proxyRes, req, res) => {
                console.log(`📥 [PUBLICACIONES] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },
            
            onError: (err, req, res) => {
                console.error('❌ Error en servicio PUBLICACIONES:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de publicaciones no disponible',
                        service: 'micro-general',
                        error: err.message
                    });
                }
            }
        })
    );

    // Rutas de enlaces externos
    router.use('/api/enlaces-externos',
        logServiceRequest('GENERAL'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.GENERAL.baseUrl,
            changeOrigin: true,
            timeout: 15000,
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`🔗 [ENLACES-EXTERNOS] Proxying ${req.method} ${req.originalUrl}`);
                console.log(`🎯 [ENLACES-EXTERNOS] Target: ${SERVICES.GENERAL.baseUrl}${req.originalUrl}`);
                
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }
                
                // Manejo especial para multipart/form-data (subida de archivos)
                if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
                    console.log(`📸 [ENLACES-EXTERNOS] Multipart form data detected`);
                } else if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && req.body) {
                    console.log(`📦 [ENLACES-EXTERNOS] Body data:`, req.body);
                    const bodyData = JSON.stringify(req.body);
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    proxyReq.write(bodyData);
                }
            },
            
            onProxyRes: (proxyRes, req, res) => {
                console.log(`📥 [ENLACES-EXTERNOS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },
            
            onError: (err, req, res) => {
                console.error('❌ Error en servicio ENLACES-EXTERNOS:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de enlaces externos no disponible',
                        service: 'micro-general',
                        error: err.message
                    });
                }
            }
        })
    );

    // Rutas de áreas protegidas (arqueológicas)
    router.use('/general/areas-protegidas',
        logServiceRequest('GENERAL'),
        createProxyMiddleware({
            target: SERVICES.GENERAL.baseUrl,
            changeOrigin: true,
            timeout: 30000, // Mayor timeout para cargar GeoJSON pesados
            pathRewrite: {
                '^/general/areas-protegidas': '/api/areas-protegidas'
            },
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`🔗 [ÁREAS-PROTEGIDAS] Proxying ${req.method} ${req.originalUrl}`);
                console.log(`🎯 [ÁREAS-PROTEGIDAS] Target: ${SERVICES.GENERAL.baseUrl}/api/areas-protegidas`);
                
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }
                
                if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && req.body) {
                    console.log(`📦 [ÁREAS-PROTEGIDAS] Body data:`, JSON.stringify(req.body).substring(0, 200));
                    const bodyData = JSON.stringify(req.body);
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    proxyReq.write(bodyData);
                }
            },
            
            onProxyRes: (proxyRes, req, res) => {
                console.log(`📥 [ÁREAS-PROTEGIDAS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },
            
            onError: (err, req, res) => {
                console.error('❌ Error en servicio ÁREAS-PROTEGIDAS:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de áreas protegidas no disponible',
                        service: 'micro-general',
                        error: err.message
                    });
                }
            }
        })
    );

    return router;
}