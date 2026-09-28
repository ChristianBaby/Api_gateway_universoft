import { MICROSERVICE_TOKEN } from '../config/services.js';

/**
 * Middleware para agregar token de servicio en peticiones a microservicios
 */
export const addServiceToken = (req, res, next) => {
    // Agregar headers para identificación del Gateway
    req.headers['x-service-name'] = 'api-gateway';
    req.headers['x-service-token'] = MICROSERVICE_TOKEN;
    req.headers['x-gateway-version'] = '1.0.0';
    req.headers['x-request-id'] = generateRequestId();

    // Si hay usuario autenticado, pasar la información
    if (req.user) {
        // El JWT contiene 'usuario_id', no 'id'
        const userId = req.user.usuario_id || req.user.id;
        const userEmail = req.user.email;
        const userRole = req.user.rol;
        const areaId = req.user.area_id;

        console.log(`👤 Datos de usuario para proxy:`, {
            usuario_id: userId,
            email: userEmail,
            rol: userRole,
            area_id: areaId
        });

        // Solo agregar headers si los valores no son undefined
        if (userId) {
            req.headers['x-user-id'] = userId;
        }
        if (userEmail) {
            req.headers['x-user-email'] = userEmail;
        }
        if (userRole) {
            req.headers['x-user-role'] = userRole;
        }
        if (areaId) {
            req.headers['x-area-id'] = areaId;
        }
    }

    console.log(`🔗 Proxy request: ${req.method} ${req.path} → Service Token Added`);
    
    next();
};

/**
 * Middleware para logging de requests entre servicios
 */
export const logServiceRequest = (serviceName) => {
    return (req, res, next) => {
        const startTime = Date.now();
        
        console.log(`📤 [${serviceName}] ${req.method} ${req.path} - Request initiated`);
        
        // Override res.end para loggear la respuesta
        const originalEnd = res.end;
        res.end = function(...args) {
            const duration = Date.now() - startTime;
            console.log(`📥 [${serviceName}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
            originalEnd.apply(this, args);
        };
        
        next();
    };
};

/**
 * Generar ID único para trazabilidad de requests
 */
function generateRequestId() {
    return `gw-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export default { addServiceToken, logServiceRequest };