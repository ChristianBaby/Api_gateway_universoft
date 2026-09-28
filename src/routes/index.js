import express from 'express';
import createRrhhRoutes from './rrhh.routes.js';

// Importar módulos de rutas
import createAuthRoutes from './auth.routes.js';
import createGeneralRoutes from './general.routes.js';
import createOperacionesRoutes from './operaciones.routes.js';
import createVentasRoutes from './ventas.routes.js';
import createTramitadorRoutes from './tramitador.routes.js';
import createClientesRoutes from './clientes.routes.js';
import createCmsRoutes from './cms.routes.js';
import createAiRoutes from './ai.routes.js';
import createQgisRoutes from './qgis.routes.js';
import createGeoprocesosRoutes from './geoprocesos.routes.js';
import createGeometriasRoutes from './geometrias.routes.js';
import createMemoriaDescriptivaRoutes from './memoria-descriptiva.routes.js';
import createContratosIaRoutes from './contratos-ia.routes.js';
import createConsultaRoutes from './consulta.routes.js';
import createGatewayRoutes from './gateway.routes.js';
import createMarketingEditorRoutes from './marketing-editor.routes.js';
import createMarketingVideoRoutes from './marketing-video.routes.js';
import createMarketingPublicacionesRoutes from './marketing-publicaciones.routes.js';
import createWhatsappRoutes from './whatsapp.routes.js';
import createTelefoniaRoutes from './telefonia.routes.js';

/**
 * @fileoverview Router principal del API Gateway
 * @description Organiza todas las rutas de microservicios en módulos separados
 * @version 2.0.0 - Refactorizado para mejor mantenibilidad
 */

// Exportar función que recibe SERVICES como parámetro
export default function createRoutes(SERVICES) {
    const router = express.Router();
    router.use('/', createRrhhRoutes());
    router.use('/', createTelefoniaRoutes());

    // ============================================
    // REGISTRO DE MÓDULOS DE RUTAS
    // ============================================

    console.log('🔧 [GATEWAY] Configurando módulos de rutas...');

    try {
        // 🏢 Microservicio de clientes (ANTES de auth para capturar /auth/clientes/*)
        router.use('/', createClientesRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo de clientes cargado');

        // 🔐 Autenticación y usuarios (después de clientes para no capturar /auth/clientes/*)
        router.use('/', createAuthRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo de autenticación cargado');

        // 📄 Microservicio general
        router.use('/', createGeneralRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo general cargado');

        // ⚙️ Microservicio de operaciones
        router.use('/', createOperacionesRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo de operaciones cargado');

        // 💰 Microservicio de ventas
        router.use('/', createVentasRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo de ventas cargado');

        // 📋 Microservicio Tramitador MINCUL
        router.use('/', createTramitadorRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo de tramitador MINCUL cargado');

        // 🧠 Microservicio CMS Marketing
        router.use('/', createCmsRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo CMS marketing cargado');

        // Microservicio IA Marketing
        router.use('/', createAiRoutes(SERVICES));
        console.log('[GATEWAY] Modulo IA marketing cargado');

        // 🗺️ Servicio QGIS
        router.use('/', createQgisRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo QGIS cargado');

        // 🧭 Microservicio de geoprocesos (analisis espacial, KMZ/DWG, IGN, sitios)
        router.use('/', createGeoprocesosRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo geoprocesos cargado');

        // 📐 Microservicio de geometrias PostGIS (guardado/consulta de poligonos)
        router.use('/', createGeometriasRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo geometrias cargado');

        // 📝 Microservicio de Memoria Descriptiva
        router.use('/', createMemoriaDescriptivaRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo memoria descriptiva cargado');

        // 📄 Scanner de PDF a JSON dinámico para contratos
        router.use('/', createContratosIaRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo scanner de contratos cargado');

        // 🔍 Consultas DNI/RUC (proxy a APIs Perú)
        router.use('/', createConsultaRoutes());
        console.log('✅ [GATEWAY] Módulo consulta DNI/RUC cargado');

        // 🎨 Editor profesional de marketing (proxy seguro a micro-editor-imagen)
        router.use('/', createMarketingEditorRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo marketing editor cargado');

        // 🎬 Video Studio marketing (rutas independientes del editor de imagen)
        router.use('/', createMarketingVideoRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo marketing video cargado');

        // 📣 Distribución de marketing en redes (proxy seguro a micro-publicaciones)
        router.use('/', createMarketingPublicacionesRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo marketing publicaciones cargado');

        // 💬 Bot de WhatsApp (leads, campañas, respuestas, auto-respuestas)
        router.use('/', createWhatsappRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo WhatsApp bot cargado');

        // 🚀 Rutas propias del gateway (info, status, health)
        router.use('/', createGatewayRoutes(SERVICES));
        console.log('✅ [GATEWAY] Módulo de gateway cargado');

        console.log('🎉 [GATEWAY] Todos los módulos cargados correctamente');

    } catch (error) {
        console.error('❌ [GATEWAY] Error cargando módulos de rutas:', error.message);
        throw error;
    }

    // ============================================
    // MIDDLEWARE DE CAPTURA DE RUTAS NO ENCONTRADAS
    // ============================================

    router.use((req, res) => {
        console.log(`❓ [GATEWAY] Ruta no encontrada: ${req.method} ${req.originalUrl}`);
        res.status(404).json({
            success: false,
            message: 'Ruta no encontrada',
            method: req.method,
            path: req.originalUrl,
            timestamp: new Date().toISOString(),
            availableRoutes: {
                documentation: '/',
                status: '/status',
                health: '/health',
                auth: ['/auth/*', '/api/auth/*', '/users/*', '/roles/*'],
                general: ['/api/documents/*', '/api/spreadsheets/*', '/api/notes/*', '/api/publicaciones/*', '/api/enlaces-externos/*'],
                financias: ['/api/financias/*'],
                operaciones: ['/api/operaciones/*'],
                ventas: ['/api/ventas/*', '/api/reportes-ventas/*'],
                clientes: ['/clientes/*'],
                cms: ['/marketing/cms/*'],
                ai: ['/marketing/ai/*'],
                qgis: ['/qgis/*'],
                memoriaDescriptiva: ['/memoria-descriptiva/*'],
                contratosIa: ['/api/contratos-ia/*'],
                marketing: ['/marketing/design-documents/*', '/marketing/templates/*', '/marketing/resources/*', '/marketing/external-assets/vecteezy/*', '/marketing/external-assets/pexels/*', '/marketing/external-assets/youtube-audio/*', '/marketing/external-assets/iconify/*', '/marketing/output-presets/*', '/marketing/fonts/*', '/marketing/exports/*', '/marketing/video-projects/*', '/marketing/video-templates/*', '/marketing/publicaciones/*'],
                whatsapp: ['/api/whatsapp/*']
            }
        });
    });

    // Retornar el router configurado
    return router;
}
