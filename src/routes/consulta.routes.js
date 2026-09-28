import express from 'express';
import { authenticateJWT } from '../middlewares/auth.middleware.js';

/**
 * @fileoverview Proxy para consultas DNI/RUC via APIs Perú
 * @description El token se queda en el servidor — el frontend NUNCA lo ve.
 * 
 * ¿Por qué un proxy?
 *   Si el frontend llama directo a apisperu.com, el token JWT queda
 *   visible en el navegador (DevTools → Network). Cualquier usuario
 *   podría copiarlo y gastar tu cuota de consultas.
 *   
 *   Con este proxy:
 *   - Frontend llama a: GET /api/consulta/dni/12345678
 *   - Gateway llama a: GET https://dniruc.apisperu.com/api/v1/dni/12345678?token=xxx
 *   - El token "xxx" solo existe en el .env del gateway
 * 
 * Endpoints creados:
 *   GET /api/consulta/dni/:numero  → Consulta datos de persona por DNI
 *   GET /api/consulta/ruc/:numero  → Consulta datos de empresa por RUC
 */

export default function createConsultaRoutes() {
    const router = express.Router();

    const APISPERU_TOKEN = process.env.APISPERU_TOKEN;
    const APISPERU_BASE = 'https://dniruc.apisperu.com/api/v1';

    // ============================================
    // CONSULTA DNI → Persona Natural
    // ============================================
    // Ejemplo: GET /api/consulta/dni/12345678
    // Respuesta: { dni, nombres, apellidoPaterno, apellidoMaterno, codVerifica }

    router.get('/api/consulta/dni/:numero', authenticateJWT, async (req, res) => {
        const { numero } = req.params;

        // Validar que sea un DNI válido (8 dígitos numéricos)
        if (!/^\d{8}$/.test(numero)) {
            return res.status(400).json({
                success: false,
                message: 'El DNI debe tener exactamente 8 dígitos numéricos'
            });
        }

        if (!APISPERU_TOKEN) {
            console.error('❌ [CONSULTA] APISPERU_TOKEN no configurado en .env');
            return res.status(500).json({
                success: false,
                message: 'Servicio de consulta no configurado'
            });
        }

        try {
            const url = `${APISPERU_BASE}/dni/${numero}?token=${APISPERU_TOKEN}`;
            console.log(`🔍 [CONSULTA] DNI ${numero} → apisperu.com`);

            const response = await fetch(url);
            const data = await response.json();

            // Log completo para debug — ver qué devuelve APIs Perú realmente
            console.log(`📦 [CONSULTA] Respuesta cruda para DNI ${numero}:`, JSON.stringify(data));

            // APIs Perú devuelve el objeto directamente si encuentra el DNI
            // Si no encuentra, devuelve { success: false, message: "..." }
            if (data.nombres) {
                console.log(`✅ [CONSULTA] DNI ${numero} → ${data.nombres} ${data.apellidoPaterno}`);
                return res.json({
                    success: true,
                    data: {
                        dni: data.dni,
                        nombres: data.nombres,
                        apellidoPaterno: data.apellidoPaterno,
                        apellidoMaterno: data.apellidoMaterno,
                        codVerifica: data.codVerifica
                    }
                });
            } else {
                console.log(`⚠️ [CONSULTA] DNI ${numero} no encontrado`);
                return res.status(404).json({
                    success: false,
                    message: `No se encontraron datos para el DNI ${numero}`
                });
            }

        } catch (error) {
            console.error(`❌ [CONSULTA] Error consultando DNI ${numero}:`, error.message);
            return res.status(502).json({
                success: false,
                message: 'Error al comunicarse con el servicio de consulta DNI'
            });
        }
    });

    // ============================================
    // CONSULTA RUC → Persona Jurídica / Empresa
    // ============================================
    // Ejemplo: GET /api/consulta/ruc/20123456789
    // Respuesta: { ruc, razonSocial, estado, condicion, direccion, departamento, ... }

    router.get('/api/consulta/ruc/:numero', authenticateJWT, async (req, res) => {
        const { numero } = req.params;

        // El proveedor/SUNAT decide si el RUC existe y está habilitado. El
        // Gateway solo valida la forma para no rechazar series válidas que no
        // empiecen por 10 o 20.
        if (!/^\d{11}$/.test(numero)) {
            return res.status(400).json({
                success: false,
                message: 'El RUC debe tener exactamente 11 dígitos numéricos'
            });
        }

        if (!APISPERU_TOKEN) {
            console.error('❌ [CONSULTA] APISPERU_TOKEN no configurado en .env');
            return res.status(500).json({
                success: false,
                message: 'Servicio de consulta no configurado'
            });
        }

        try {
            const url = `${APISPERU_BASE}/ruc/${numero}?token=${APISPERU_TOKEN}`;
            console.log(`🔍 [CONSULTA] RUC ${numero} → apisperu.com`);

            const response = await fetch(url);
            const data = await response.json();

            if (data.razonSocial) {
                console.log(`✅ [CONSULTA] RUC ${numero} → ${data.razonSocial}`);
                return res.json({
                    success: true,
                    data: {
                        ruc: data.ruc,
                        razonSocial: data.razonSocial,
                        nombreComercial: data.nombreComercial,
                        estado: data.estado,           // ACTIVO, BAJA, etc.
                        condicion: data.condicion,     // HABIDO, NO HABIDO
                        direccion: data.direccion,
                        departamento: data.departamento,
                        provincia: data.provincia,
                        distrito: data.distrito,
                        ubigeo: data.ubigeo
                    }
                });
            } else {
                console.log(`⚠️ [CONSULTA] RUC ${numero} no encontrado`);
                return res.status(404).json({
                    success: false,
                    message: `No se encontraron datos para el RUC ${numero}`
                });
            }

        } catch (error) {
            console.error(`❌ [CONSULTA] Error consultando RUC ${numero}:`, error.message);
            return res.status(502).json({
                success: false,
                message: 'Error al comunicarse con el servicio de consulta RUC'
            });
        }
    });

    // ============================================
    // CONSULTA UBIGEO → Búsqueda por Código (ID)
    // ============================================
    router.get('/api/ventas/ubigeo/:id_ubigeo', authenticateJWT, async (req, res) => {
        const { id_ubigeo } = req.params;

        // Solo permitimos 4 (provincias) o 6 dígitos (distritos)
        if (!/^\d{4}$|^\d{6}$/.test(id_ubigeo)) {
            return res.status(400).json({ success: false, message: 'Formato de ubigeo no válido (debe ser de 4 o 6 dígitos)' });
        }

        try {
            // Limpiar la URL base para evitar dobles slashes
            const baseUrl = process.env.VENTAS_SERVICE_URL.replace(/\/$/, '');
            const targetUrl = `${baseUrl}/api/ubigeo/${id_ubigeo}`;
            
            console.log(`📡 [GATEWAY] Consultando Ubigeo ${id_ubigeo} en: ${targetUrl}`);
            
            // Reenviamos el header de Authorization al microservicio
            const response = await fetch(targetUrl, {
                headers: {
                    'Authorization': req.headers.authorization || ''
                }
            });
            const data = await response.json();
            console.log(`📥 [GATEWAY] Respuesta de Ventas:`, data);
            return res.status(response.status).json(data);

        } catch (error) {
            console.error('❌ [GATEWAY] Error en proxy ubigeo:', error.message);
            return res.status(500).json({ success: false, message: 'Error al consultar la base de datos' });
        }
    });

    return router;
}
