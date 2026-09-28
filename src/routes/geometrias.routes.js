import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

/**
 * @fileoverview Rutas del microservicio de geometrias PostGIS (guardado y
 * consulta de poligonos/lineas dibujados en el editor: por-capas, bulk,
 * polygon/:id, deactivate, vertices, decompose, etc).
 * @description micro-geometrias-ruwark monta sus rutas en TRES prefijos
 * identicos ('/', '/api/v1/geometria', '/api/v1/geometrias'), y el frontend
 * usa dos de esas tres convenciones segun el archivo:
 *   - buildApiUrl('/geometria/...') -> sale como /api/v1/geometria/...
 *     (coincide exacto, sin rewrite).
 *   - RAW_API_BASE_URL + '/geometrias/...' -> sale como /geometrias/...
 *     a secas (hay que sacar el prefijo para que matchee el mount raiz).
 *
 * Nunca estuvo registrado en el gateway; las llamadas devolvian 404
 * "Ruta no encontrada" (fallback generico del router), sin importar el
 * prefijo usado.
 */
export default function createGeometriasRoutes(SERVICES) {
    const router = express.Router();

    router.use(['/api/v1/geometria', '/api/v1/geometrias'], createProxyMiddleware({
        target: SERVICES.GEOMETRIAS.baseUrl,
        changeOrigin: true,
        timeout: 60000,

        onProxyReq: (proxyReq, req) => {
            console.log(`📐 [GEOMETRIAS] ${req.method} ${req.originalUrl}`);

            if (req.headers.authorization) {
                proxyReq.setHeader('Authorization', req.headers.authorization);
            }
        },

        onError: (err, req, res) => {
            console.error('❌ [GEOMETRIAS] Error:', err.message);
            if (!res.headersSent) {
                res.status(503).json({
                    success: false,
                    message: 'Servicio de geometrias no disponible',
                });
            }
        },
    }));

    router.use('/geometrias', createProxyMiddleware({
        target: SERVICES.GEOMETRIAS.baseUrl,
        changeOrigin: true,
        timeout: 60000,

        pathRewrite: (path) => path.replace(/^\/geometrias/, ''),

        onProxyReq: (proxyReq, req) => {
            console.log(`📐 [GEOMETRIAS] ${req.method} ${req.originalUrl}`);

            if (req.headers.authorization) {
                proxyReq.setHeader('Authorization', req.headers.authorization);
            }
        },

        onError: (err, req, res) => {
            console.error('❌ [GEOMETRIAS] Error:', err.message);
            if (!res.headersSent) {
                res.status(503).json({
                    success: false,
                    message: 'Servicio de geometrias no disponible',
                });
            }
        },
    }));

    return router;
}
