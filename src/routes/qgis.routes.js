import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { authenticateJWT } from '../middlewares/auth.middleware.js';
import { addServiceToken } from '../middlewares/service-token.middleware.js';

/**
 * @fileoverview Rutas del servicio QGIS
 * @description Maneja renderizado de planos, generación de PDFs y operaciones GIS
 */

export default function createQgisRoutes(SERVICES) {
    const router = express.Router();

    // ============================================
    // RUTAS PARA QGIS-SERVER (Renderizado de Planos)
    // ============================================

    // Health check del QGIS server (público)
    router.use('/qgis/health', createProxyMiddleware({
        target: SERVICES.QGIS.baseUrl,
        changeOrigin: true,
        timeout: 10000,
        
        pathRewrite: (path) => {
            return path.replace(/^\/qgis/, '');
        },
        
        onProxyReq: (proxyReq, req, res) => {
            console.log(`🗺️ [QGIS-HEALTH] ${req.method} ${req.originalUrl}`);
        },
        
        onError: (err, req, res) => {
            console.error('❌ [QGIS-HEALTH] Error:', err.message);
            if (!res.headersSent) {
                res.status(503).json({
                    success: false,
                    error: 'QGIS service unavailable'
                });
            }
        }
    }));

    // Rutas protegidas del QGIS server
    router.use('/qgis', authenticateJWT, addServiceToken, createProxyMiddleware({
        target: SERVICES.QGIS.baseUrl,
        changeOrigin: true,
        timeout: 120000, // 2 minutos para renderizado
        
        pathRewrite: (path) => {
            return path.replace(/^\/qgis/, '');
        },
        
        onProxyReq: (proxyReq, req, res) => {
            console.log(`🗺️ [QGIS] ${req.method} ${req.originalUrl}`);
            console.log(`🎯 [QGIS] Target: ${SERVICES.QGIS.baseUrl}${req.originalUrl.replace(/^\/qgis/, '')}`);
            
            proxyReq.setHeader('X-Service-Name', 'api-gateway');
            proxyReq.setHeader('X-Gateway-Request', 'true');
            // 🔑 PASAR HEADERS DE USUARIO AL QGIS SERVER
            if (req.headers['x-user-id']) {
                proxyReq.setHeader('x-user-id', req.headers['x-user-id']);
                console.log(`👤 Pasando x-user-id: ${req.headers['x-user-id']}`);
            }
            if (req.headers['x-user-email']) {
                proxyReq.setHeader('x-user-email', req.headers['x-user-email']);
                console.log(`📧 Pasando x-user-email: ${req.headers['x-user-email']}`);
            }
            if (req.headers['x-user-role']) {
                proxyReq.setHeader('x-user-role', req.headers['x-user-role']);
                console.log(`🎭 Pasando x-user-role: ${req.headers['x-user-role']}`);
            }
            if (req.headers['x-area-id']) {
                proxyReq.setHeader('x-area-id', req.headers['x-area-id']);
                console.log(`🏢 Pasando x-area-id: ${req.headers['x-area-id']}`);
            }
            // Pasar Authorization header si existe
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
            console.log(`📥 [QGIS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
            
            // Preservar headers para archivos PDF/JPG/Excel
            const contentType = proxyRes.headers['content-type'];
            if (contentType && (contentType.includes('application/pdf') || 
                               contentType.includes('image/') || 
                               contentType.includes('application/vnd.openxmlformats'))) {
                if (proxyRes.headers['content-disposition']) {
                    res.setHeader('Content-Disposition', proxyRes.headers['content-disposition']);
                }
            }
        },
        
        onError: (err, req, res) => {
            console.error('❌ [QGIS] Error:', err.message);
            if (!res.headersSent) {
                res.status(503).json({
                    success: false,
                    error: 'QGIS service error',
                    message: err.message
                });
            }
        }
    }));

    return router;
}