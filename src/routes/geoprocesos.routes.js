import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

/**
 * @fileoverview Rutas del microservicio de geoprocesos (analisis espacial:
 * area/perimetro con Turf.js, parseo KMZ/DWG, metadata IGN, sitios de Cultura,
 * subida de archivos a S3).
 * @description El frontend llama a este servicio con DOS convenciones de
 * prefijo distintas segun el archivo (no es algo que decidamos aca, asi
 * es como quedo escrito en el codigo existente):
 *   - buildApiUrl('/spatial/...') -> ya sale como /api/v1/spatial/... (coincide
 *     exacto con el mount interno de micro-geoprocesos-ruwark).
 *   - api.post('/spatial/...') (instancia axios generica, sin el prefijo
 *     /api/v1 que agrega buildApiUrl) -> sale como /spatial/... a secas.
 * El pathRewrite normaliza el segundo caso agregando /api/v1 antes de
 * reenviar; el primero pasa sin tocar.
 *
 * Nunca estuvo registrado en el gateway; las llamadas devolvian 404
 * "Ruta no encontrada" (fallback generico del router), sin importar el
 * prefijo usado.
 */
export default function createGeoprocesosRoutes(SERVICES) {
    const router = express.Router();

    router.use(['/api/v1/spatial', '/api/v1/sitios', '/spatial', '/sitios'], createProxyMiddleware({
        target: SERVICES.GEOPROCESOS.baseUrl,
        changeOrigin: true,
        timeout: 60000,

        pathRewrite: (path) => {
            if (path.startsWith('/api/v1/')) return path;
            return `/api/v1${path}`;
        },

        onProxyReq: (proxyReq, req) => {
            console.log(`🗺️ [GEOPROCESOS] ${req.method} ${req.originalUrl}`);

            if (req.headers.authorization) {
                proxyReq.setHeader('Authorization', req.headers.authorization);
            }
        },

        onError: (err, req, res) => {
            console.error('❌ [GEOPROCESOS] Error:', err.message);
            if (!res.headersSent) {
                res.status(503).json({
                    success: false,
                    message: 'Servicio de geoprocesos no disponible',
                });
            }
        },
    }));

    return router;
}
