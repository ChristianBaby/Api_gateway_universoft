import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { authenticateJWT } from '../middlewares/auth.middleware.js';
import { MICROSERVICE_TOKEN } from '../config/services.js';

/**
 * @fileoverview Rutas del microservicio de Memoria Descriptiva
 * @description Redirige peticiones /memoria-descriptiva/* hacia micro-memoria-descriptiva (puerto 3005)
 * 
 * Cómo funciona:
 *   El frontend llama a:  http://localhost:8080/memoria-descriptiva/api/extract-document
 *   El Gateway quita el prefijo y reenvía a:  http://localhost:3005/api/extract-document
 * 
 * Endpoints disponibles:
 *   GET  /memoria-descriptiva/health              → Health check (público)
 *   POST /memoria-descriptiva/api/extract-document → Extraer datos de PDF/DOCX del cliente
 *   POST /memoria-descriptiva/api/generar-memoria  → Generar memoria descriptiva (TODO Etapa 4)
 *   GET  /memoria-descriptiva/api/descargar-memoria → Descargar archivo generado (TODO Etapa 4)
 */

export default function createMemoriaDescriptivaRoutes(SERVICES) {
    const router = express.Router();

    // ============================================
    // RUTAS PARA micro-memoria-descriptiva
    // ============================================

    // Health check (público, sin autenticación)
    router.use('/memoria-descriptiva/health', createProxyMiddleware({
        target: SERVICES.MEMORIA_DESCRIPTIVA.baseUrl,
        changeOrigin: true,
        timeout: 10000,

        pathRewrite: (path) => {
            // /memoria-descriptiva/health → /health
            return path.replace(/^\/memoria-descriptiva/, '');
        },

        onProxyReq: (proxyReq, req, res) => {
            console.log(`📝 [MEMORIA-DESCRIPTIVA-HEALTH] ${req.method} ${req.originalUrl}`);
        },

        onError: (err, req, res) => {
            console.error('❌ [MEMORIA-DESCRIPTIVA-HEALTH] Error:', err.message);
            if (!res.headersSent) {
                res.status(503).json({
                    success: false,
                    error: 'Servicio de memoria descriptiva no disponible'
                });
            }
        }
    }));

    // Rutas protegidas (requieren JWT)
    router.use('/memoria-descriptiva', authenticateJWT, createProxyMiddleware({
        target: SERVICES.MEMORIA_DESCRIPTIVA.baseUrl,
        changeOrigin: true,
        timeout: 120000, // 2 minutos — la IA puede tardar

        pathRewrite: (path) => {
            // /memoria-descriptiva/api/extract-document → /api/extract-document
            return path.replace(/^\/memoria-descriptiva/, '');
        },

        onProxyReq: (proxyReq, req, res) => {
            console.log(`📝 [MEMORIA-DESCRIPTIVA] ${req.method} ${req.originalUrl}`);
            console.log(`🎯 [MEMORIA-DESCRIPTIVA] Target: ${SERVICES.MEMORIA_DESCRIPTIVA.baseUrl}${req.originalUrl.replace(/^\/memoria-descriptiva/, '')}`);

            proxyReq.setHeader('X-Service-Name', 'api-gateway');
            proxyReq.setHeader('X-Gateway-Request', 'true');
            // Requerido por /api/classify-and-extract (require_service_token del
            // lado de memoria-descriptiva) — el resto de rutas de este micro no
            // lo valida, así que no afecta nada agregarlo siempre.
            proxyReq.setHeader('X-Service-Token', MICROSERVICE_TOKEN);

            // Pasar Authorization header si existe
            if (req.headers.authorization) {
                proxyReq.setHeader('Authorization', req.headers.authorization);
            }

            // IMPORTANTE: NO reescribimos el body aquí.
            // A diferencia de qgis.routes.js que hace JSON.stringify(req.body),
            // nosotros dejamos que http-proxy-middleware maneje el stream directamente.
            // Esto es necesario porque nuestro endpoint recibe archivos (multipart/form-data)
            // y si reescribes el body, se rompe la subida de archivos.
        },

        onProxyRes: (proxyRes, req, res) => {
            console.log(`📥 [MEMORIA-DESCRIPTIVA] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);

            // Preservar headers para archivos descargables (Word, PDF)
            const contentType = proxyRes.headers['content-type'];
            if (contentType && (contentType.includes('application/pdf') ||
                               contentType.includes('application/vnd.openxmlformats'))) {
                if (proxyRes.headers['content-disposition']) {
                    res.setHeader('Content-Disposition', proxyRes.headers['content-disposition']);
                }
            }
        },

        onError: (err, req, res) => {
            console.error('❌ [MEMORIA-DESCRIPTIVA] Error:', err.message);
            if (!res.headersSent) {
                res.status(503).json({
                    success: false,
                    error: 'Error en servicio de memoria descriptiva',
                    message: err.message
                });
            }
        }
    }));

    return router;
}
