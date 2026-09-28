import jwt from 'jsonwebtoken';
import { sessionBoundary } from './session.middleware.js';

const JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.trim()
    ? process.env.JWT_SECRET.trim()
    : undefined;

function sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    for (const key of ['authorization', 'cookie', 'x-service-token']) {
        if (sanitized[key]) {
            sanitized[key] = '[redacted]';
        }
    }
    return sanitized;
}

/**
 * Middleware para verificar JWT token
 */
export const authenticateJWT = async (req, res, next) => {
    console.log(`🔐 Verificando autenticación para: ${req.method} ${req.path}`);
    console.log(`📋 Headers completos:`, sanitizeHeaders(req.headers));
    
    // Rutas que no requieren autenticación
    const publicRoutes = [
        '/api/auth/login',
        '/api/auth/register',
        '/health',
        '/status',
        '/auth/clientes/login',
        '/auth/clientes/register',
        // Assets de publicaciones del bot de WhatsApp: un <img>/<video> del
        // navegador no manda Authorization. Nombres de archivo son UUID, no
        // adivinables, y el Gateway igual exige X-Service-Token al reenviar.
        '/api/whatsapp/uploads',
        // Stream SSE del bot de WhatsApp: EventSource no manda Authorization.
        // Se protege con un ticket de un solo uso (ver ticketSSE.ts en el
        // backend), no con el JWT de esta ruta. OJO: no confundir con
        // /api/whatsapp/sse-ticket (nombre distinto a proposito), que SI
        // exige JWT normal — es como se obtiene el ticket.
        '/api/whatsapp/eventos',
    ];

    // Verificar si la ruta es pública
    if (publicRoutes.some(route => req.path.startsWith(route))) {
        console.log(`✅ Ruta pública permitida: ${req.path}`);
        return next();
    }

    // Obtener token del header Authorization o cookies
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.token;
    
    console.log(`🔍 Auth header:`, authHeader ? '[redacted]' : undefined);
    console.log(`🍪 Cookie token:`, cookieToken ? '[redacted]' : undefined);
    
    const token = authHeader?.startsWith('Bearer ') 
        ? authHeader.substring(7)
        : cookieToken;

    console.log(`🎫 Token extraído:`, token ? '[redacted]' : 'NO_TOKEN');

    if (!token) {
        console.log(`❌ No se encontró token para: ${req.method} ${req.path}`);
        return res.status(401).json({
            success: false,
            message: 'Token de acceso requerido',
            error: 'UNAUTHORIZED'
        });
    }

    try {
        if (!JWT_SECRET) {
            return res.status(500).json({
                success: false,
                message: 'JWT_SECRET no configurado en API Gateway',
                error: 'GATEWAY_JWT_SECRET_MISSING'
            });
        }
        // Verificar y decodificar el token
        console.log(`🔓 Verificando token con secret: ${JWT_SECRET ? 'CONFIGURADO' : 'NO_CONFIGURADO'}`);
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        if (decoded.token_use && decoded.token_use !== 'access') throw new Error('Invalid token use');
        if (decoded.sid && (decoded.token_use !== 'access' || decoded.iss !== (process.env.JWT_ISSUER || 'ruwark-login') || decoded.aud !== (process.env.JWT_AUDIENCE || 'ruwark-services'))) throw new Error('Invalid token claims');
        
        // Agregar información del usuario al request
        req.user = decoded;
        
        // Log para trazabilidad
        console.log(`✅ Usuario autenticado: ${decoded.email || decoded.id} - ${req.method} ${req.path}`);
        
        return await sessionBoundary(req, res, next);
    } catch (error) {
        console.error('❌ Error verificando JWT:', error.message);
        console.error('❌ JWT_SECRET configurado:', JWT_SECRET ? 'SÍ' : 'NO');
        
        return res.status(401).json({
            success: false,
            message: 'Token inválido o expirado',
            error: 'INVALID_TOKEN',
        });
    }
};

/**
 * Middleware opcional para verificar roles específicos
 */
export const requireRole = (roles = []) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Usuario no autenticado'
            });
        }

        // Si no se especifican roles, permitir cualquier usuario autenticado
        if (roles.length === 0) {
            return next();
        }

        // Verificar si el usuario tiene alguno de los roles requeridos
        const userRoles = req.user.roles || [];
        const hasRequiredRole = roles.some(role => userRoles.includes(role));

        if (!hasRequiredRole) {
            return res.status(403).json({
                success: false,
                message: 'Permisos insuficientes',
                required: roles,
                current: userRoles
            });
        }

        next();
    };
};

export default { authenticateJWT, requireRole };
