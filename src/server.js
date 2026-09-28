import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';

// ============================================
// DEBUG - VERIFICAR VARIABLES DE ENTORNO
// ============================================
console.log('🔍 DEBUG - Variables de entorno cargadas:');
console.log('   QGIS_SERVICE_URL:', process.env.QGIS_SERVICE_URL);
console.log('   AUTH_SERVICE_URL:', process.env.AUTH_SERVICE_URL);
console.log('   OPERACIONES_SERVICE_URL:', process.env.OPERACIONES_SERVICE_URL);

// Importar configuración y rutas DESPUÉS de cargar variables
import { GATEWAY_CONFIG, getServices } from './config/services.js';
import createRoutes from './routes/index.js';
import { sessionBoundary } from './middlewares/session.middleware.js';
import { operationsMeetBoundary } from './middlewares/operaciones-meet.middleware.js';
import { createActivityTelemetry } from './middlewares/activity-telemetry.middleware.js';

// Obtener servicios dinámicamente DESPUÉS de cargar variables
const SERVICES = getServices();

console.log('🔍 DEBUG - QGIS Service configurado con URL:', SERVICES.QGIS.baseUrl);
// ============================================
// ============================================

const app = express();
app.use(operationsMeetBoundary());
const PORT = GATEWAY_CONFIG.port;
if (Buffer.byteLength(process.env.JWT_SECRET || '', 'utf8') < 32) {
    throw new Error('JWT_SECRET debe ser una clave aleatoria de al menos 32 bytes, compartida con el login.');
}

// ============================================
// MIDDLEWARES DE SEGURIDAD
// ============================================

// Helmet para seguridad básica aquyi estoy 
// Las miniaturas de Post Studio se guardan en S3 privado y se sirven con URL firmada.
// Permitimos únicamente hosts S3 esperados para que el navegador pueda renderizarlas.
const s3ImageSources = [
    'https://ruwark-storage.s3.amazonaws.com',
    'https://ruwark-storage.s3.us-east-1.amazonaws.com'
];

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "img-src": ["'self'", 'data:', 'blob:', ...s3ImageSources]
        }
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
}));

// CORS - Configuración explícita y permisiva
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'https://ruwark.cloud',
            'https://www.ruwark.cloud',
            'https://core.ruwark.cloud',
            'https://panel.ruwark.cloud',
            'https://appsruwark-frontend-ruwark.v3z7ma.easypanel.host',
            'https://appsruwark-frontend-cliente-ruwark.v3z7ma.easypanel.host',
            'https://appsruwark-panel-cliente.v3z7ma.easypanel.host',
            'https://staging-rwk-frontend-ruwark.nfnbzo.easypanel.host',
            'https://staging-rwk-panel-cliente-ruwark.nfnbzo.easypanel.host',
            'https://staging-rwk-api-gateway-ruwar.nfnbzo.easypanel.host',
            'https://staging-rwk-frontend-ruwark.z05b3r.easypanel.host',
            'https://staging-api-gateway-ruwark.z05b3r.easypanel.host',
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:3002',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:3001',
            'http://127.0.0.1:3002',
            'https://consultaestadotramite.cultura.gob.pe', // Página del Ministerio
            'https://botscrapt.universoftsystems.com' // Panel del bot de WhatsApp (micro-whatsapp-bot)
        ];

        // Permitir peticiones sin origin (Postman, curl, etc.)
        if (!origin) {
            return callback(null, true);
        }

        // Permitir extensiones de Chrome
        const configuredOrigins = [process.env.FRONTEND_URL, ...(process.env.CORS_ORIGINS || '').split(',')].filter(Boolean).map(value => value.trim());
        if (configuredOrigins.includes(origin)) {
            return callback(null, true);
        }

        // Permitir todos los orígenes permitidos
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log('⚠️ CORS: Origen no en lista blanca:', origin);
            console.log('✅ CORS: Orígenes permitidos:', allowedOrigins);
            callback(Object.assign(new Error('Origen no permitido'), { status: 403 }));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Cookie',
        'X-Requested-With',
        'Accept',
        'Origin',
        'Access-Control-Request-Method',
        'Access-Control-Request-Headers',
        'X-Service-Name',
        'X-Service-Token',
        'X-Marca-Usuario-Id',
        'X-Marketing-Brand-User-Id',
        'X-Ruwark-Personal-Editor',
        'X-Active-Marca-Usuario-Id',
        'X-User-Id',
        'X-User-Email',
        'X-User-Role',
        'X-Request-Id',
        'X-Project-Id',
        'X-Presentation-Id',
        'X-Filename',
        'Idempotency-Key'
    ],
    exposedHeaders: ['Authorization', 'Set-Cookie', 'X-Request-Id', 'X-Contrato-Id', 'Content-Disposition'],
    optionsSuccessStatus: 204,
    preflightContinue: false,
    maxAge: 86400 // 24 horas
};

app.use(cors(corsOptions));

// Handler explícito para OPTIONS (preflight)
app.options('*', cors(corsOptions));

// Rate limiting global del gateway.
// Login se limita en micro-login-users por intentos fallidos; aquí se omite para no bloquear correos corporativos ni intentos válidos.
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 5000, // margen alto para uso normal detrás del proxy
    skip: (req) => req.method === 'OPTIONS' || ['/auth/login', '/api/auth/login'].includes(req.path),
    message: {
        success: false,
        message: 'Demasiadas peticiones desde esta IP. Intenta de nuevo más tarde.'
    },
    standardHeaders: true,
    legacyHeaders: false
});
app.use(limiter);

// ============================================
// MIDDLEWARES GENERALES
// ============================================

// Morgan para logging
app.use(morgan('combined'));

// Compresión
app.use(compression());

// Cookies antes de rutas/proxies: authenticateJWT puede leer req.cookies sin consumir el body.
app.use(cookieParser());

function sanitizeHeadersForLog(headers) {
    const redacted = {};
    const sensitiveHeaders = new Set([
        'authorization',
        'cookie',
        'set-cookie',
        'x-service-token',
        'service-token',
        'x-user-id',
        'x-user-email',
        'x-user-role',
        'x-marca-usuario-id',
        'x-marketing-brand-user-id',
        'x-active-marca-usuario-id'
    ]);

    for (const [key, value] of Object.entries(headers || {})) {
        redacted[key] = sensitiveHeaders.has(key.toLowerCase()) ? '[REDACTED]' : value;
    }

    return redacted;
}

// Debugging middleware ANTES del parsing
app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.path}`);
    console.log(`📋 Headers seguros:`, sanitizeHeadersForLog(req.headers));
    next();
});

// ============================================
// RUTAS (ANTES del parsing JSON para proxies)
// ============================================

// Health check del Gateway
app.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'API Gateway saludable',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: GATEWAY_CONFIG.name,
        version: GATEWAY_CONFIG.version,
        environment: GATEWAY_CONFIG.environment
    });
});

// Rutas principales (incluye proxies que necesitan raw stream)
app.use(sessionBoundary);
app.use(createActivityTelemetry());
app.use('/', createRoutes(SERVICES));

// Parsing JSON DESPUÉS de los proxies (para rutas que no son proxy)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Debugging middleware DESPUÉS del parsing (para rutas no-proxy)
app.use((req, res, next) => {
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('Solicitud recibida con cuerpo JSON');
    }
    next();
});

// Ruta 404 - No encontrada
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint no encontrado en el API Gateway',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

// ============================================
// MANEJO DE ERRORES
// ============================================

app.use((error, req, res, next) => {
    console.error('❌ Error en API Gateway:', error);

    res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Error interno del servidor',
        error: GATEWAY_CONFIG.environment === 'development' ? error.stack : undefined,
        timestamp: new Date().toISOString()
    });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

const server = app.listen(PORT, () => {
    console.log('\n🚀 ===============================================');
    console.log('🌟 API GATEWAY RUWARK INICIADO');
    console.log('🚀 ===============================================');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🌍 Entorno: ${GATEWAY_CONFIG.environment}`);
    console.log(`🔗 Health Check: http://localhost:${PORT}/health`);
    console.log(`📊 Status: http://localhost:${PORT}/status`);
    console.log('\n🎯 SERVICIOS CONFIGURADOS:');
    console.log(`   🔐 Auth: ${process.env.AUTH_SERVICE_URL || 'http://localhost:5000'}`);
    console.log(`   ⚙️  Operaciones: ${process.env.OPERACIONES_SERVICE_URL || 'http://localhost:3001'}`);
    console.log(`   🌐 Frontend CORS: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
    console.log('\n✅ Gateway listo para recibir peticiones...\n');
});

// Manejo de señales para graceful shutdown
const gracefulShutdown = (signal) => {
    console.log(`\n📴 Recibida señal ${signal}. Cerrando API Gateway...`);
    server.close(() => {
        console.log('✅ API Gateway cerrado correctamente');
        process.exit(0);
    });

    // Forzar cierre después de 10 segundos
    setTimeout(() => {
        console.log('⚠️ Forzando cierre del API Gateway...');
        process.exit(1);
    }, 10000);
};

// Escuchar señales de sistema
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    console.error('❌ Error no capturado en Gateway:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rechazada no manejada en Gateway:', reason);
    process.exit(1);
});




