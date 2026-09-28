import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logServiceRequest, addServiceToken } from '../middlewares/service-token.middleware.js';

/**
 * @fileoverview Rutas del microservicio de ventas
 * @description Maneja todas las operaciones de ventas y reportes financieros
 */

export default function createVentasRoutes(SERVICES) {
    const router = express.Router();

    // ============================================
    // RUTAS PARA VENTAS (Microservicio)
    // ============================================

    // Ruta para ventas - manejo completo de todas las operaciones de ventas
    router.use('/api/ventas',
        logServiceRequest('VENTAS'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.VENTAS.baseUrl,
            changeOrigin: true,
            timeout: 180000, // también cubre la subida multipart a Google Drive
            pathRewrite: (path, req) => {
                // Mantener la estructura completa /api/ventas para el microservicio
                return path;
            },
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`💰 [VENTAS] ${req.method} ${req.originalUrl}`);
                console.log(`🎯 [VENTAS] Target: ${SERVICES.VENTAS.baseUrl}${req.path}`);
                
                // Headers para identificación del gateway
                proxyReq.setHeader('X-Service-Name', 'api-gateway');
                proxyReq.setHeader('X-Gateway-Request', 'true');
                
                // Agregar token de autenticación entre microservicios
                if (req.headers['service-token']) {
                    proxyReq.setHeader('X-Service-Token', req.headers['service-token']);
                }

                // Pasar Authorization header
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }
                
                // NO manejar el body manualmente - http-proxy-middleware lo hace automáticamente
            },
            
            onProxyRes: (proxyRes, req, res) => {
                console.log(`📥 [VENTAS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },
            
            onError: (err, req, res) => {
                console.error('❌ [VENTAS] Error:', err.message);
                console.error('🔗 [VENTAS] URL:', SERVICES.VENTAS.baseUrl);
                
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de ventas no disponible',
                        error: err.message
                    });
                }
            }
        })
    );

    // Ruta específica para reportes de ventas
    router.use('/api/reportes-ventas',
        logServiceRequest('VENTAS'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.VENTAS.baseUrl,
            changeOrigin: true,
            timeout: 30000,
            pathRewrite: (path) => {
                return path.replace('/api/reportes-ventas', '/api/reportes');
            },
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`📊 [VENTAS-REPORTES] ${req.method} ${req.originalUrl}`);
                console.log(`🎯 [VENTAS-REPORTES] Target: ${SERVICES.VENTAS.baseUrl}${req.path.replace('/api/reportes-ventas', '/api/reportes')}`);
                
                proxyReq.setHeader('X-Service-Name', 'api-gateway');
                proxyReq.setHeader('X-Gateway-Request', 'true');

                // Pasar Authorization header
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }

                // NO manejar el body manualmente
            },
            
            onError: (err, req, res) => {
                console.error('❌ [VENTAS-REPORTES] Error:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de reportes de ventas no disponible',  
                        error: err.message
                    });
                }
            }
        })
    );

    // Ruta específica para contratos
    router.use('/api/contratos',
        logServiceRequest('VENTAS'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.VENTAS.baseUrl,
            changeOrigin: true,
            timeout: 15000,
            pathRewrite: (path) => {
                // Mantener la ruta /api/contratos en el microservicio de ventas,
                // ya que micro-ventas monta sus rutas bajo /api.
                return path;
            },
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`📄 [CONTRATOS] ${req.method} ${req.originalUrl}`);
                console.log(`🎯 [CONTRATOS] Target: ${SERVICES.VENTAS.baseUrl}${req.path}`);
                
                // Headers para identificación del gateway
                proxyReq.setHeader('X-Service-Name', 'api-gateway');
                proxyReq.setHeader('X-Gateway-Request', 'true');
                
                // Agregar token de autenticación entre microservicios
                if (req.headers['service-token']) {
                    proxyReq.setHeader('X-Service-Token', req.headers['service-token']);
                }

                // Pasar Authorization header
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }
                
                // Si hay body, agregarlo
                if (req.body) {
                    const bodyData = JSON.stringify(req.body);
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    proxyReq.write(bodyData);
                }
            },
            
            onProxyRes: (proxyRes, req, res) => {
                console.log(`📥 [CONTRATOS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },
            
            onError: (err, req, res) => {
                console.error('❌ [CONTRATOS] Error:', err.message);
                console.error('🔗 [CONTRATOS] URL:', SERVICES.VENTAS.baseUrl);
                
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de contratos no disponible',
                        error: err.message
                    });
                }
            }
        })
    );

    // Ruta para Financias/Contabilidad — vive dentro de micro-ventas-ruwark
    // (ver analisis_ventas_operaciones_modelo_implementacion.md, Sección 10)
    router.use('/api/financias',
        logServiceRequest('FINANCIAS'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.VENTAS.baseUrl,
            changeOrigin: true,
            timeout: 30000, // subida de documento firmado/comprobante (multipart) tarda mas que un JSON simple
            pathRewrite: (path) => path,

            onProxyReq: (proxyReq, req, res) => {
                console.log(`💼 [FINANCIAS] ${req.method} ${req.originalUrl}`);

                proxyReq.setHeader('X-Service-Name', 'api-gateway');
                proxyReq.setHeader('X-Gateway-Request', 'true');

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
                console.log(`📥 [FINANCIAS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },

            onError: (err, req, res) => {
                console.error('❌ [FINANCIAS] Error:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Módulo de financias no disponible',
                        error: err.message
                    });
                }
            }
        })
    );

    return router;
}
