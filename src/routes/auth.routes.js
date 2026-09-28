import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

/**
 * @fileoverview Rutas de autenticación y gestión de usuarios
 * @description Maneja tanto el nuevo microservicio de login como el sistema legacy
 */

export default function createAuthRoutes(SERVICES) {
    const router = express.Router();

    const setCorsFromRequest = (req, res, proxyRes) => {
        if (proxyRes) for (const header of Object.keys(proxyRes.headers)) {
            if (header.startsWith('access-control-')) delete proxyRes.headers[header];
        }
        // El middleware CORS global ya validó el origen; no reflejar uno arbitrario.
        const frontendUrl = res.getHeader('Access-Control-Allow-Origin');
        if (frontendUrl) res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
    };

    // ============================================
    // RUTAS PARA MICRO-LOGIN-USERS (Nuevo Microservicio de Autenticación)
    // ============================================

    // Rutas de autenticación (públicas y protegidas)
    router.use('/auth', createProxyMiddleware({
        target: SERVICES.LOGIN.baseUrl,
        changeOrigin: true,
        // El alta puede incluir una llamada Admin SDK para crear la identidad
        // corporativa; no cortar el proxy mientras micro-login la completa.
        timeout: 60000,
        proxyTimeout: 60000,
        logLevel: 'debug',
        
        pathRewrite: (path) => {
            // /auth/login -> /api/auth/login
            const newPath = path.replace(/^\/auth/, '/api/auth');
            console.log(`[HPM] Rewriting path from "${path}" to "${newPath}"`);
            return newPath;
        },
        
        onProxyReq: (proxyReq, req, res) => {
            console.log(`🔐 [LOGIN] ${req.method} ${req.originalUrl}`);
            console.log(`🎯 [LOGIN] Target: ${SERVICES.LOGIN.baseUrl}${req.path.replace(/^\/auth/, '/api/auth')}`);
            
            proxyReq.setHeader('X-Service-Name', 'api-gateway');
            proxyReq.setHeader('X-Gateway-Request', 'true');
            
            if (req.body) {
                const bodyData = JSON.stringify(req.body);
                proxyReq.setHeader('Content-Type', 'application/json');
                proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                proxyReq.write(bodyData);
            }
        },
        
        onProxyRes: (proxyRes, req, res) => {
            console.log(`📥 [LOGIN] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            setCorsFromRequest(req, res, proxyRes);
        },
        
        onError: (err, req, res) => {
            console.error('❌ [LOGIN] Error:', err.message);
            if (!res.headersSent) {
                setCorsFromRequest(req, res);
                res.status(503).json({
                    success: false,
                    message: 'Servicio de autenticación no disponible',
                    error: err.message
                });
            }
        }
    }));

    // Rutas de usuarios (protegidas - verificación en microservicio)
    router.use('/users',
        createProxyMiddleware({
            target: SERVICES.LOGIN.baseUrl,
            changeOrigin: true,
            // /users/:id/google-workspace/provision llama a Google Admin SDK.
            timeout: 60000,
            proxyTimeout: 60000,
            
            pathRewrite: (path) => {
                return path.replace(/^\/users/, '/api/users');
            },
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`👤 [USERS] ${req.method} ${req.originalUrl}`);
                
                // Pasar el token de autenticación
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }
                
                if (req.body) {
                    const bodyData = JSON.stringify(req.body);
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    proxyReq.write(bodyData);
                }
            },
            
            onProxyRes: (proxyRes, req, res) => {
                setCorsFromRequest(req, res, proxyRes);
            },
            
            onError: (err, req, res) => {
                console.error('❌ [USERS] Error:', err.message);
                if (!res.headersSent) {
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de usuarios no disponible',
                        error: err.message
                    });
                }
            }
        })
    );

    // Rutas de roles (protegidas - verificación en microservicio)
    router.use('/roles',
        createProxyMiddleware({
            target: SERVICES.LOGIN.baseUrl,
            changeOrigin: true,
            timeout: 10000,
            
            pathRewrite: (path) => {
                return path.replace(/^\/roles/, '/api/roles');
            },
            
            onProxyReq: (proxyReq, req, res) => {
                console.log(`👔 [ROLES] ${req.method} ${req.originalUrl}`);
                
                if (req.headers.authorization) {
                    proxyReq.setHeader('Authorization', req.headers.authorization);
                }
                
                if (req.body) {
                    const bodyData = JSON.stringify(req.body);
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    proxyReq.write(bodyData);
                }
            },
            
            onProxyRes: (proxyRes, req, res) => {
                console.log(`[ROLES] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
                setCorsFromRequest(req, res, proxyRes);
            },

            onError: (err, req, res) => {
                console.error('[ROLES] Error:', err.message);
                if (!res.headersSent) {
                    setCorsFromRequest(req, res);
                    res.status(503).json({
                        success: false,
                        message: 'Servicio de roles no disponible',
                        error: err.message
                    });
                }
            }
        })
    );

    // ============================================
    // RUTAS PARA AUTENTICACIÓN (Backend Ruwark - LEGACY)
    // ============================================

    // Proxy OPTIMIZADO para auth - Configuración mejorada para conexiones estables
    router.use('/api/auth', createProxyMiddleware({
        target: SERVICES.AUTH.baseUrl,
        changeOrigin: true,
        timeout: 60000, // Timeout más largo
        proxyTimeout: 60000, // Timeout específico del proxy
        logLevel: 'debug',
        
        // Configuraciones adicionales para estabilidad
        secure: false,
        ws: false,
        followRedirects: false,
        
        onProxyReq: (proxyReq, req, res) => {
            console.log(`🔗 [AUTH PROXY] ${req.method} ${req.originalUrl}`);
            console.log(`🎯 [AUTH PROXY] Target: ${SERVICES.AUTH.baseUrl}${req.originalUrl}`);
            
            // Headers importantes para el proxy
            proxyReq.setHeader('X-Service-Name', 'api-gateway');
            proxyReq.setHeader('X-Gateway-Request', 'true');
            proxyReq.setHeader('Connection', 'keep-alive');
            
            // Si hay body, asegurar que se envíe correctamente
        },
        
        onProxyRes: (proxyRes, req, res) => {
            console.log(`📥 [AUTH PROXY] ¡RESPUESTA RECIBIDA! Status: ${proxyRes.statusCode}`);
            
            // Asegurar CORS headers en la respuesta usando el origen real del navegador.
            // En desarrollo puede ser localhost:3000, :3001 o :3002; no forzar FRONTEND_URL.
            setCorsFromRequest(req, res, proxyRes);
            
            // Log del contenido si es JSON
            if (proxyRes.headers['content-type']?.includes('application/json')) {
                console.log(`✅ [AUTH PROXY] Respuesta JSON recibida correctamente`);
            }
        },
        
        onError: (err, req, res) => {
            console.error('❌ [AUTH PROXY] Error detallado:', {
                code: err.code,
                message: err.message,
                stack: err.stack?.split('\n')[0] // Solo la primera línea del stack
            });
            
            if (!res.headersSent) {
                res.status(503).json({
                    success: false,
                    message: 'Error en comunicación con servicio de autenticación',
                    error: err.message,
                    code: err.code,
                    timestamp: new Date().toISOString()
                });
            }
        },
        
        onClose: (req, socket, head) => {
            console.log(`🔌 [AUTH PROXY] Conexión cerrada para: ${req.method} ${req.originalUrl}`);
        }
    }));

    return router;
}
