import express from 'express';

/**
 * @fileoverview Rutas propias del gateway
 * @description Maneja información del sistema, estado y documentación
 */

export default function createGatewayRoutes(SERVICES) {
    const router = express.Router();

    // ============================================
    // RUTA DE INICIO DEL GATEWAY - DOCUMENTACIÓN
    // ============================================

    router.get('/', (req, res) => {
        res.json({
            success: true,
            message: '🚀 API Gateway Ruwark - Plataforma de Gestión de Proyectos',
            timestamp: new Date().toISOString(),
            version: '2.0.0',
            environment: process.env.NODE_ENV || 'development',
            services: {
                frontend: process.env.FRONTEND_URL || 'http://localhost:3000',
                login: SERVICES.LOGIN.baseUrl,
                auth: SERVICES.AUTH.baseUrl,
                operaciones: SERVICES.OPERACIONES.baseUrl,
                general: SERVICES.GENERAL.baseUrl,
                ventas: SERVICES.VENTAS.baseUrl,
                clientes: SERVICES.CLIENTES.baseUrl,
                cms: SERVICES.CMS.baseUrl,
                qgis: SERVICES.QGIS.baseUrl,
                editorImagen: SERVICES.EDITOR_IMAGEN?.baseUrl,
                publicaciones: SERVICES.PUBLICACIONES?.baseUrl
            },
            endpoints: {
                health: '/health',
                status: '/status',
                // Micro Login Users (NUEVO)
                login: {
                    register: '/auth/register',
                    login: '/auth/login',
                    logout: '/auth/logout',
                    refreshToken: '/auth/refresh-token',
                    verify: '/auth/verify',
                    users: '/users',
                    me: '/users/me',
                    clientes: '/clientes',
                    roles: '/roles'
                },
                // Legacy Auth
                auth: '/api/auth',
                // Micro General (documentos, hojas, notas, publicaciones, enlaces externos)
                general: {
                    documents: '/api/documents',
                    spreadsheets: '/api/spreadsheets',
                    notes: '/api/notes',
                    publicaciones: '/api/publicaciones',
                    enlaces_externos: '/api/enlaces-externos'
                },
                // Micro Ventas (finanzas y ventas)
                ventas: {
                    ventas: '/api/ventas',
                    reportes: '/api/reportes-ventas'
                },
                // Micro Clientes
                clientes: {
                    all: '/clientes'
                },
                // Marketing CMS
                cms: {
                    brands: '/marketing/cms/brands',
                    workspace: '/marketing/cms/workspace',
                    social_channels: '/marketing/cms/social-channels',
                    plannings: '/marketing/cms/plannings',
                    planning_configuration: '/marketing/cms/plannings/:id/configuration',
                    planning_generate: '/marketing/cms/plannings/:id/generate',
                    planning_items: '/marketing/cms/planning-items'
                },
                // Legacy endpoints (esquema public)
                legacy: {
                    projects: '/api/projects (deprecated - usar /api/operaciones/proyectos)',
                    tracking: '/api/tracking'
                },
                // Contrato canónico del nuevo sistema de Operaciones
                operaciones: {
                    proyectos: '/api/operaciones/proyectos',
                    proyectos_stats: '/api/operaciones/proyectos/estadisticas',
                    proyectos_contadores: '/api/operaciones/proyectos/contadores-por-estado',
                    expedientes: '/api/operaciones/expedientes',
                    seguimientos: '/api/operaciones/seguimientos',
                    archivos: '/api/operaciones/archivos',
                    diagrama_gantt: '/api/operaciones/diagrama-gantt',
                    tareas: '/api/operaciones/tareas'
                },
                // QGIS Server
                qgis: {
                    health: '/qgis/health',
                    all: '/qgis/*'
                },
                // Marketing Editor
                marketingEditor: {
                    designDocuments: '/marketing/design-documents',
                    templates: '/marketing/templates',
                    resources: '/marketing/resources',
                    externalAssets: {
                        vecteezy: '/marketing/external-assets/vecteezy',
                        pexels: '/marketing/external-assets/pexels',
                        youtubeAudio: '/marketing/external-assets/youtube-audio',
                        iconify: '/marketing/external-assets/iconify'
                    },
                    outputPresets: '/marketing/output-presets',
                    fonts: '/marketing/fonts',
                    exports: '/marketing/exports'
                },
                // Marketing Publicaciones
                marketingPublicaciones: {
                    providers: '/marketing/publicaciones/providers',
                    connections: '/marketing/publicaciones/connections',
                    programacion: '/marketing/publicaciones/programacion',
                    oauth: '/marketing/publicaciones/oauth/{provider}/callback',
                    jobs: '/marketing/publicaciones/jobs',
                    analytics: '/marketing/publicaciones/analytics/meta/snapshot',
                    analyticsSync: '/marketing/publicaciones/analytics/meta/sync',
                    metrics: '/marketing/publicaciones/metrics/sync',
                    webhooks: '/marketing/publicaciones/webhooks/{provider}'
                }
            },
            note: 'El contrato canónico de Operaciones usa /api/operaciones sin versión en la URL'
        });
    });

    // ============================================
    // RUTA DE ESTADO DEL GATEWAY
    // ============================================

    router.get('/status', (req, res) => {
        res.json({
            success: true,
            message: 'API Gateway funcionando correctamente',
            timestamp: new Date().toISOString(),
            services: {
                auth: {
                    name: SERVICES.AUTH.name,
                    url: SERVICES.AUTH.baseUrl,
                    routes: SERVICES.AUTH.routes
                },
                login: {
                    name: SERVICES.LOGIN.name,
                    url: SERVICES.LOGIN.baseUrl,
                    routes: SERVICES.LOGIN.routes
                },
                general: {
                    name: SERVICES.GENERAL.name,
                    url: SERVICES.GENERAL.baseUrl,
                    routes: SERVICES.GENERAL.routes
                },
                operaciones: {
                    name: SERVICES.OPERACIONES.name,
                    url: SERVICES.OPERACIONES.baseUrl,
                    routes: SERVICES.OPERACIONES.routes
                },
                ventas: {
                    name: SERVICES.VENTAS.name,
                    url: SERVICES.VENTAS.baseUrl,
                    routes: SERVICES.VENTAS.routes
                },
                clientes: {
                    name: SERVICES.CLIENTES.name,
                    url: SERVICES.CLIENTES.baseUrl,
                    routes: SERVICES.CLIENTES.routes
                },
                cms: {
                    name: SERVICES.CMS.name,
                    url: SERVICES.CMS.baseUrl,
                    routes: SERVICES.CMS.routes
                },
                qgis: {
                    name: SERVICES.QGIS.name,
                    url: SERVICES.QGIS.baseUrl,
                    routes: SERVICES.QGIS.routes
                },
                editorImagen: {
                    name: SERVICES.EDITOR_IMAGEN?.name,
                    url: SERVICES.EDITOR_IMAGEN?.baseUrl,
                    routes: SERVICES.EDITOR_IMAGEN?.routes || []
                },
                publicaciones: {
                    name: SERVICES.PUBLICACIONES?.name,
                    url: SERVICES.PUBLICACIONES?.baseUrl,
                    routes: SERVICES.PUBLICACIONES?.routes || []
                }
            },
            version: '2.0.0'
        });
    });

    // ============================================
    // RUTA DE HEALTH CHECK
    // ============================================

    router.get('/health', (req, res) => {
        res.json({
            success: true,
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: '2.0.0'
        });
    });

    return router;
}
