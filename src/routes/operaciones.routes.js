import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logServiceRequest, addServiceToken } from '../middlewares/service-token.middleware.js';
import { authenticateJWT } from '../middlewares/auth.middleware.js';
import { createOperationsMeetProxy } from '../middlewares/operaciones-meet.middleware.js';

/**
 * @fileoverview Rutas del microservicio de operaciones
 * @description Expone el contrato canónico de Operaciones y compatibilidad legacy
 */

export default function createOperacionesRoutes(SERVICES) {
    const router = express.Router();
    // Frontera nueva, antes de los proxies legacy; no comparte rutas de otras áreas.
    router.use('/api/operaciones/meet', createOperationsMeetProxy({ target: SERVICES.OPERACIONES.baseUrl }));

    // ============================================
    // COMPATIBILIDAD LEGACY PARA API V2
    // ============================================

    // Proxy temporal para consumidores antiguos. El frontend nuevo usa
    // exclusivamente /api/operaciones/*.
    router.use('/api/v2',
        logServiceRequest('OPERACIONES-V2'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.OPERACIONES.baseUrl,
            changeOrigin: true,
            timeout: 15000,
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`🔗 [OPERACIONES V2] Proxying ${req.method} ${req.originalUrl}`);
                console.log(`🎯 [OPERACIONES V2] Target: ${SERVICES.OPERACIONES.baseUrl}${req.originalUrl}`);
                
                // Asegurar que el header Authorization se pase al microservicio
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                    console.log(`🔑 [OPERACIONES V2] Authorization header reenviado`);
                }
                
                // Para requests POST/PUT/PATCH con body
                if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && req.body) {
                    console.log(`📦 [OPERACIONES V2] Body data:`, req.body);
                    
                    // Serializar el body
                    const bodyData = JSON.stringify(req.body);
                    
                    // Actualizar headers
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    
                    // Escribir el body al proxy request
                    proxyReq.write(bodyData);
                    console.log(`📤 [OPERACIONES V2] Body enviado:`, bodyData);
                }
            },
            
            onProxyRes: (proxyRes, req, res) => {
                console.log(`📥 [OPERACIONES V2] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },
            
            onError: (err, req, res) => {
                console.error('❌ Error en servicio OPERACIONES V2:', err.message);
                console.error('❌ Request details:', {
                    method: req.method,
                    url: req.originalUrl,
                    body: req.body
                });
                
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de operaciones v2 no disponible',
                        service: 'operaciones-v2',
                        error: err.message
                    });
                }
            }
        })
    );

    // ============================================
    // COMPATIBILIDAD PARA /api/projects
    // ============================================

    // Ruta histórica para proyectos; se reescribe al contrato canónico.
    router.use('/api/projects',
        logServiceRequest('OPERACIONES'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.OPERACIONES.baseUrl,
            changeOrigin: true,
            timeout: 15000,
            pathRewrite: (path, req) => {
                // Excepciones que todavía pertenecen al router histórico.
                if (path.includes('/files')) {
                    // Excepción para archivos: mantener en /projects (microservicio) donde está montado projectFileRoutes
                    return path.replace('/api/projects', '/api/projects');
                }
                if (path.includes('/gantt')) {
                    // Excepción para Gantt legacy: mantener en /projects (microservicio) donde está montado ganttRoutes
                    return path.replace('/api/projects', '/api/projects');
                }
                if (path.includes('/stats')) {
                    return path.replace('/api/projects/stats', '/api/operaciones/proyectos/estadisticas');
                }
                
                return path.replace('/api/projects', '/api/operaciones/proyectos');
            },
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`🔗 [PROYECTOS] Proxying ${req.method} ${req.originalUrl}`);
                const rewrittenPath = req.path.includes('/files') || req.path.includes('/gantt')
                    ? req.path.replace('/api/projects', '/api/projects')
                    : req.path.includes('/stats') 
                        ? req.path.replace('/api/projects/stats', '/api/operaciones/proyectos/estadisticas')
                        : req.path.replace('/api/projects', '/api/operaciones/proyectos');
                console.log(`🎯 [PROYECTOS] Reescrito a: ${rewrittenPath}`);
                
                // Asegurar que el header Authorization se pase al microservicio
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                    console.log(`🔑 [PROYECTOS] Authorization header reenviado`);
                }
                
                // Para requests POST/PUT/PATCH con body
                if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && req.body) {
                    console.log(`📦 [PROYECTOS] Body data:`, req.body);
                    
                    // Serializar el body
                    const bodyData = JSON.stringify(req.body);
                    
                    // Actualizar headers
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    
                    // Escribir el body al proxy request
                    proxyReq.write(bodyData);
                    console.log(`📤 [PROYECTOS] Body enviado:`, bodyData);
                }
            },
            
            onProxyRes: (proxyRes, req, res) => {
                console.log(`📥 [PROYECTOS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },
            
            onError: (err, req, res) => {
                console.error('❌ Error en servicio PROYECTOS:', err.message);
                console.error('❌ Request details:', {
                    method: req.method,
                    url: req.originalUrl,
                    body: req.body
                });
                
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de proyectos no disponible',
                        service: 'operaciones',
                        error: err.message
                    });
                }
            }
        })
    );

    // Ruta para tracking
    router.use('/api/tracking',
        logServiceRequest('OPERACIONES'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.OPERACIONES.baseUrl,
            changeOrigin: true,
            timeout: 15000,
            onProxyReq: (proxyReq, req, res) => {
                // Asegurar que el header Authorization se pase al microservicio
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }
            },
            onError: (err, req, res) => {
                console.error('❌ Error en servicio TRACKING:', err.message);
                res.status(503).json({
                    success: false,
                    message: 'Servicio de tracking no disponible',
                    service: 'operaciones'
                });
            }
        })
    );

    // Ruta legacy /operaciones para compatibilidad
    router.use('/operaciones',
        logServiceRequest('OPERACIONES'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.OPERACIONES.baseUrl,
            changeOrigin: true,
            timeout: 15000,
            pathRewrite: (path) => {
                return path.replace(/^\/operaciones/, '');
            },
            onProxyReq: (proxyReq, req, res) => {
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }
                
                // Manejo especial para multipart/form-data (subida de archivos)
                if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
                    // Para multipart, no modificar el body
                } else if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && req.body) {
                    const bodyData = JSON.stringify(req.body);
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    proxyReq.write(bodyData);
                }
            },
            onError: (err, req, res) => {
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de operaciones no disponible',
                        error: err.message
                    });
                }
            }
        })
    );

    // Archivos subidos (evidencia de requisitos, adjuntos de proyecto) —
    // el gateway y micro-operaciones exigen JWT antes de servirlos.
    router.use('/uploads',
        authenticateJWT,
        logServiceRequest('OPERACIONES-UPLOADS'),
        // El helmet() global del gateway pone X-Frame-Options y
        // Content-Security-Policy (frame-ancestors 'self') en toda
        // respuesta que pasa por acá — bloquearían el <iframe> de vista
        // previa del frontend (localhost:3001, otro origen que el gateway).
        // Operaciones ya los saca de su lado, pero el gateway los vuelve a
        // poner encima al proxyear; se sacan otra vez acá.
        (req, res, next) => {
            res.removeHeader('X-Frame-Options');
            res.removeHeader('Content-Security-Policy');
            next();
        },
        createProxyMiddleware({
            target: SERVICES.OPERACIONES.baseUrl,
            changeOrigin: true,
            timeout: 15000,
            onError: (err, req, res) => {
                console.error('❌ Error sirviendo archivo de OPERACIONES:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({ success: false, message: 'Servicio de archivos no disponible' });
                }
            }
        })
    );

    // ============================================
    // CONTRATO CANÓNICO DEL NUEVO SISTEMA DE OPERACIONES
    // ============================================
    router.use(
        "/api/operaciones",
        logServiceRequest('OPERACIONES'),
        addServiceToken,
        createProxyMiddleware({
            target: SERVICES.OPERACIONES.baseUrl,
            changeOrigin: true,
            // Subida masiva IA hace una llamada a Gemini por archivo del
            // lote (más la extracción rica y el intento de auto-generación)
            // — con varios archivos supera fácil los 30s que tenía esto
            // antes, y el proxy cortaba la conexión aunque el backend
            // terminara bien (ver ERR_EMPTY_RESPONSE en el navegador).
            timeout: 180000,
            proxyTimeout: 180000,

            onProxyReq: (proxyReq, req, res) => {
                console.log(`🔧 [API-OPERACIONES] ${req.method} ${req.originalUrl}`);
                console.log(`🎯 [API-OPERACIONES] Target: ${SERVICES.OPERACIONES.baseUrl}${req.path}`);

                // Pasar headers de autenticación
                if (req.headers.authorization) {
                    proxyReq.setHeader("Authorization", req.headers.authorization);
                }

                // Manejar body para requests POST/PUT/PATCH
                if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && req.body) {
                    const bodyData = JSON.stringify(req.body);
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    proxyReq.write(bodyData);
                }
            },

            onProxyRes: (proxyRes, req) => {
                console.log(`📥 [API-OPERACIONES] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            },

            onError: (err, req, res) => {
                console.error("❌ [API-OPERACIONES] Error:", err.message);
                console.error("❌ [API-OPERACIONES] Target URL:", SERVICES.OPERACIONES.baseUrl);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: "Microservicio de operaciones no disponible",
                        error: err.message,
                        service: "micro-operaciones-ruwark",
                    });
                }
            },
        }),
    );

    return router;
}
