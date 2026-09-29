// Configuración de microservicios disponibles
// Función que se evalúa dinámicamente para leer las variables de entorno

function isProductionLike() {
    return ['production', 'prod', 'staging'].includes(String(process.env.NODE_ENV || '').trim().toLowerCase());
}

function readEnv(name, fallback, { requiredInProduction = false } = {}) {
    const value = process.env[name];
    if (value && String(value).trim()) {
        return String(value).trim();
    }
    if (requiredInProduction && isProductionLike()) {
        throw new Error(`[CONFIG] ${name} es requerido en producción. Configúralo en Easypanel.`);
    }
    return fallback;
}

function readAnyEnv(names, fallback, { requiredInProduction = false, label = names[0] } = {}) {
    for (const name of names) {
        const value = process.env[name];
        if (value && String(value).trim()) {
            return String(value).trim();
        }
    }
    if (requiredInProduction && isProductionLike()) {
        throw new Error(`[CONFIG] ${label} es requerido en producción. Configura una de: ${names.join(', ')}`);
    }
    return fallback;
}

export const getServices = () => ({
    AUTH: {
        name: 'backend-ruwark',
        baseUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:4000',
        routes: ['/api/auth', '/api/users', '/api/areas']
    },
    LOGIN: {
        name: 'micro-login-users',
        baseUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:4000',
        routes: ['/auth', '/users', '/usuarios_externos', '/roles']
    },
    OPERACIONES: {
        name: 'micro-operaciones-ruwark',
        baseUrl: process.env.OPERACIONES_SERVICE_URL || 'http://localhost:4002',
        routes: ['/api/projects', '/api/tracking', '/api/operaciones']
    },
    VENTAS: {
        name: 'micro-ventas-ruwark',
        baseUrl: process.env.VENTAS_SERVICE_URL || 'http://localhost:4003',
        routes: ['/api/ventas', '/api/financias', '/api/facturacion', '/api/reportes-ventas', '/ventas']
    },
    TRAMITADOR: {
        name: 'micro-tramitador-mincul',
        baseUrl: process.env.TRAMITADOR_SERVICE_URL || 'http://localhost:4013',
        routes: ['/api/tramites']
    },
    GENERAL: {
        name: 'micro-general',
        baseUrl: process.env.GENERAL_SERVICE_URL || 'http://localhost:4001',
        routes: ['/api/documents', '/api/spreadsheets', '/api/notes', '/api/publicaciones', '/api/enlaces-externos']
    },
    CLIENTES: {
        name: 'micro-clientes-ruwark',
        baseUrl: process.env.CLIENTES_SERVICE_URL || 'http://localhost:7000',
        routes: ['/api/clientes', '/api/contactos', '/api/interacciones', '/api/segmentos', '/api/reportes']
    },
    CMS: {
        name: 'micro-cms',
        baseUrl: readEnv('CMS_SERVICE_URL', 'http://localhost:4007', { requiredInProduction: true }),
        routes: ['/marketing/cms']
    },
    AI: {
        name: 'ruwark-micro-ia',
        baseUrl: readAnyEnv(['RUWARK_MICRO_IA_URL', 'CEREBRO_IA_SERVICE_URL', 'AI_SERVICE_URL'], 'http://localhost:4011', {
            requiredInProduction: true,
            label: 'RUWARK_MICRO_IA_URL',
        }),
        routes: ['/marketing/ai']
    },
    GEOPROCESOS: {
        name: 'micro-geoprocesos-ruwark',
        baseUrl: process.env.GEOPROCESOS_SERVICE_URL || 'http://localhost:4017',
        routes: ['/api/v1/spatial', '/api/v1/sitios', '/spatial', '/sitios']
    },
    GEOMETRIAS: {
        name: 'micro-geometrias-ruwark',
        baseUrl: process.env.GEOMETRIAS_SERVICE_URL || 'http://localhost:4016',
        routes: ['/geometrias', '/api/v1/geometria', '/api/v1/geometrias']
    },
    QGIS: {
        name: 'qgis-server',
        baseUrl: process.env.QGIS_SERVICE_URL || 'http://localhost:5000',
        routes: ['/render-pdf', '/render-with-kmz', '/render-preview-pdf', '/extract-coordinates', '/extract-location', '/extract-boundaries', '/extract-boundaries-coords', '/check-heritage', '/generate-excel', '/get-default-zoom', '/api/generar-memoria-formulario', '/api/preview-memoria-datos', '/api/descargar-memoria', '/health']
    },
    MEMORIA_DESCRIPTIVA: {
        name: 'micro-memoria-descriptiva',
        baseUrl: process.env.MEMORIA_DESCRIPTIVA_SERVICE_URL || 'http://localhost:3005',
        routes: ['/api/extract-document', '/api/extract-documents', '/api/generar-memoria', '/api/descargar-memoria', '/health']
    },
    SCANNER_CONTRATOS: {
        name: 'micro-scanner-contratos',
        baseUrl: process.env.SCANNER_CONTRATOS_SERVICE_URL || 'http://localhost:4012',
        routes: ['/api/contratos-ia']
    },
    EDITOR_IMAGEN: {
        name: 'micro-editor-imagen',
        baseUrl: process.env.MICRO_EDITOR_IMAGEN_URL || process.env.EDITOR_IMAGEN_SERVICE_URL || process.env.EDITOR_IMAGEN_URL || 'http://localhost:4008',
        routes: [
            '/marketing/design-documents',
            '/marketing/templates',
            '/marketing/resources',
            '/marketing/external-assets/vecteezy',
            '/marketing/external-assets/pexels',
            '/marketing/external-assets/youtube-audio',
            '/marketing/external-assets/iconify',
            '/marketing/output-presets',
            '/marketing/fonts',
            '/marketing/exports'
        ]
    },
    VIDEO_STUDIO: {
        name: 'micro-editor-video',
        baseUrl: readAnyEnv(
            ['MICRO_EDITOR_VIDEO_URL', 'VIDEO_STUDIO_SERVICE_URL', 'MICRO_EDITOR_IMAGEN_URL', 'EDITOR_IMAGEN_SERVICE_URL', 'EDITOR_IMAGEN_URL'],
            'http://localhost:4008',
        ),
        routes: ['/marketing/video-projects', '/marketing/video-templates']
    },
    PUBLICACIONES: {
        name: 'micro-publicaciones',
        baseUrl: readAnyEnv(['MICRO_PUBLICACIONES_URL', 'PUBLICACIONES_SERVICE_URL'], 'http://localhost:4010', {
            requiredInProduction: true,
            label: 'MICRO_PUBLICACIONES_URL',
        }),
        routes: [
            // Regla de oro CMS/Publicaciones:
            // marca, keyMeta y canales pertenecen a /marketing/cms/*, no a publicaciones.
            '/marketing/publicaciones/providers',
            '/marketing/publicaciones/connections',
            '/marketing/publicaciones/programacion',
            '/marketing/publicaciones/analytics',
            '/marketing/publicaciones/oauth',
            '/api/tiktok/oauth',
            '/marketing/publicaciones/jobs',
            '/marketing/publicaciones/metrics',
            '/marketing/publicaciones/webhooks'
        ]
    },
    WHATSAPP: {
        name: 'micro-whatsapp-bot',
        baseUrl: readEnv('WHATSAPP_SERVICE_URL', 'http://localhost:3000'),
        routes: ['/api/whatsapp']
    }
});

// Para compatibilidad hacia atrás, exportamos SERVICES como una función
export const SERVICES = getServices();

// Token para comunicación entre servicios. En producción no debe tener fallback hardcodeado.
export const MICROSERVICE_TOKEN = readEnv('MICROSERVICE_TOKEN', 'universoft-dev-only-cambiame', { requiredInProduction: true });

// Configuración del Gateway
export const GATEWAY_CONFIG = {
    port: process.env.PORT || 8080,
    name: 'ruwark-api-gateway',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
};

export default { SERVICES, MICROSERVICE_TOKEN, GATEWAY_CONFIG };
