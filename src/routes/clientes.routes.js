import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

export default function createClientesRoutes(SERVICES) {
  const router = express.Router();

  // Token compartido por defecto (Debe coincidir con el del microservicio)
  const DEFAULT_MICROSERVICE_TOKEN = "gateway-secret-token-2024";
  const RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

  // Verificación de captcha solo para login de clientes. aqui
  router.post(
    "/auth/clientes/login",
    express.json(),
    express.urlencoded({ extended: true }),
    async (req, res, next) => {
      try {
        const recaptchaToken = req.body?.["g-recaptcha-response"];

        if (!recaptchaToken) {
          return res.status(400).json({
            success: false,
            message: "Captcha requerido",
            error: "CAPTCHA_REQUIRED",
          });
        }

        const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY;
        if (!recaptchaSecret) {
          console.error("❌ [AUTH] RECAPTCHA_SECRET_KEY no configurado");
          return res.status(500).json({
            success: false,
            message: "Configuración de seguridad incompleta",
            error: "RECAPTCHA_NOT_CONFIGURED",
          });
        }

        const params = new URLSearchParams({
          secret: recaptchaSecret,
          response: recaptchaToken,
        });

        if (req.ip) {
          params.append("remoteip", req.ip);
        }

        const googleResponse = await fetch(RECAPTCHA_VERIFY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });

        if (!googleResponse.ok) {
          console.error("❌ [AUTH] Error HTTP validando reCAPTCHA:", googleResponse.status);
          return res.status(502).json({
            success: false,
            message: "No se pudo validar el captcha",
            error: "RECAPTCHA_VERIFICATION_FAILED",
          });
        }

        const verificationResult = await googleResponse.json();
        if (verificationResult.success !== true) {
          const errorCodes = Array.isArray(verificationResult["error-codes"])
            ? verificationResult["error-codes"]
            : [];
          const isExpiredOrDuplicate = errorCodes.includes("timeout-or-duplicate");

          console.warn("⚠️ [AUTH] reCAPTCHA rechazado por Google:", errorCodes);
          return res.status(400).json({
            success: false,
            message: isExpiredOrDuplicate
              ? "Captcha expirado o ya utilizado. Vuelve a validarlo."
              : "Captcha inválido",
            error: "CAPTCHA_INVALID",
            details: errorCodes,
          });
        }

        next();
      } catch (error) {
        console.error("❌ [AUTH] Error verificando reCAPTCHA:", error.message);
        return res.status(500).json({
          success: false,
          message: "Error verificando captcha",
          error: "RECAPTCHA_CHECK_ERROR",
        });
      }
    },
  );

  // Orígenes permitidos para CORS (el gateway inyecta estos headers en las respuestas proxy)
  const GATEWAY_ALLOWED_ORIGINS = [
    'https://ruwark.cloud',
    'https://www.ruwark.cloud',
    'https://core.ruwark.cloud',
    'https://panel.ruwark.cloud',
    'https://appsruwark-frontend-ruwark.v3z7ma.easypanel.host',
    'https://appsruwark-frontend-cliente-ruwark.v3z7ma.easypanel.host',
    'https://appsruwark-panel-cliente.v3z7ma.easypanel.host',
    'https://staging-rwk-frontend-ruwark.nfnbzo.easypanel.host',
    'https://staging-rwk-panel-cliente-ruwark.nfnbzo.easypanel.host',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3002',
  ];

  // Helper: inyecta los headers CORS correctos en la respuesta del microservicio
  function applyCorsHeaders(proxyRes, req) {
    const origin = req.headers.origin;
    if (origin && GATEWAY_ALLOWED_ORIGINS.includes(origin)) {
      proxyRes.headers['access-control-allow-origin'] = origin;
      proxyRes.headers['access-control-allow-credentials'] = 'true';
    }
  }

  // ============================================
  // RUTA PARA OBTENER PLANES (Microservicio Clientes) - PÚBLICA (debiera ir PRIMERO)
  // ============================================
  router.use(
    "/clientes/plans",
    createProxyMiddleware({
      target: SERVICES.CLIENTES.baseUrl,
      changeOrigin: true,
      timeout: 10000,

      pathRewrite: (path) => {
        return path.replace("/clientes/plans", "/api/clientes/plans");
      },

      onProxyReq: (proxyReq, req, res) => {
        console.log(`📦 [PLANS] ${req.method} ${req.originalUrl}`);
        console.log(
          `🎯 [PLANS] Target: ${SERVICES.CLIENTES.baseUrl}${req.path}`,
        );

  

        // Agregar token de microservicio para comunicación segura
        proxyReq.setHeader(
          "X-Microservice-Token",
          process.env.MICROSERVICE_TOKEN || DEFAULT_MICROSERVICE_TOKEN,
        );
        proxyReq.setHeader("X-Service-Name", "api-gateway");
        proxyReq.setHeader("X-Gateway-Request", "true");

        if (req.body) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader("Content-Type", "application/json");
          proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },

      onProxyRes: (proxyRes, req, res) => {
        console.log(
          `📥 [PLANS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`,
        );
        applyCorsHeaders(proxyRes, req);
      },

      onError: (err, req, res) => {
        console.error("❌ [PLANS] Error:", err.message);
        console.error("❌ [PLANS] Target URL:", SERVICES.CLIENTES.baseUrl);
        if (!res.headersSent) {
          res.status(503).json({
            success: false,
            message: "Microservicio de planes no disponible",
            error: err.message,
            service: "micro-clientes-ruwark",
          });
        }
      },
    }),
  );

  // ============================================
  // RUTAS DE AUTENTICACIÓN (expuestas por el gateway en /auth/clientes -> rewrites a /api/clientes/auth)
  // ============================================
  router.use(
    "/auth/clientes",
    createProxyMiddleware({
      target: SERVICES.CLIENTES.baseUrl,
      changeOrigin: true,
      timeout: 10000,

      pathRewrite: (path) => {
        return path.replace(/^\/auth\/clientes/, "/api/clientes/auth");
      },

      onProxyReq: (proxyReq, req, res) => {
        console.log(`🔐 [AUTH] ${req.method} ${req.originalUrl}`);
        console.log(
          `🎯 [AUTH] Target: ${SERVICES.CLIENTES.baseUrl}${req.path}`,
        );

        // Pasar headers de autenticación
        if (req.headers.authorization) {
          proxyReq.setHeader("Authorization", req.headers.authorization);
        }

        // Agregar token de microservicio para comunicación segura
        proxyReq.setHeader(
          "X-Microservice-Token",
          process.env.MICROSERVICE_TOKEN || DEFAULT_MICROSERVICE_TOKEN,
        );
        proxyReq.setHeader("X-Service-Name", "api-gateway");
        proxyReq.setHeader("X-Gateway-Request", "true");

        if (req.body) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader("Content-Type", "application/json");
          proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },

      onProxyRes: (proxyRes, req, res) => {
        console.log(
          `📥 [AUTH] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`,
        );
        applyCorsHeaders(proxyRes, req);
      },

      onError: (err, req, res) => {
        console.error("❌ [AUTH] Error:", err.message);
        console.error("❌ [AUTH] Target URL:", SERVICES.CLIENTES.baseUrl);
        if (!res.headersSent) {
          res.status(503).json({
            success: false,
            message: "Microservicio de autenticación no disponible",
            error: err.message,
            service: "micro-clientes-ruwark",
          });
        }
      },
    }),
  );

  // ============================================
  // RUTAS PARA USUARIOS EXTERNOS (Microservicio LOGIN)
  // ============================================
  router.use(
    "/usuarios_externos",
    createProxyMiddleware({
      target: SERVICES.LOGIN.baseUrl,
      changeOrigin: true,
      timeout: 10000,

      pathRewrite: (path) => {
        return path.replace("/usuarios_externos", "/api/usuarios_externos"); // Reescribir para agregar prefijo /api
      },

      onProxyReq: (proxyReq, req, res) => {
        console.log(`👤 [USUARIOS_EXTERNOS] ${req.method} ${req.originalUrl}`);
        console.log(
          `🎯 [USUARIOS_EXTERNOS] Target: ${SERVICES.LOGIN.baseUrl}${req.path}`,
        );

        // Pasar headers de autenticación
        if (req.headers.authorization) {
          proxyReq.setHeader("Authorization", req.headers.authorization);
        }

        // Agregar token de microservicio para comunicación segura
        proxyReq.setHeader(
          "X-Microservice-Token",
          process.env.MICROSERVICE_TOKEN || DEFAULT_MICROSERVICE_TOKEN,
        );
        proxyReq.setHeader("X-Service-Name", "api-gateway");
        proxyReq.setHeader("X-Gateway-Request", "true");

        if (req.body) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader("Content-Type", "application/json");
          proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },

      onProxyRes: (proxyRes, req, res) => {
        console.log(
          `📥 [USUARIOS_EXTERNOS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`,
        );
        applyCorsHeaders(proxyRes, req);
      },

      onError: (err, req, res) => {
        console.error("❌ [USUARIOS_EXTERNOS] Error:", err.message);
        console.error(
          "❌ [USUARIOS_EXTERNOS] Target URL:",
          SERVICES.LOGIN.baseUrl,
        );
        if (!res.headersSent) {
          res.status(503).json({
            success: false,
            message: "Microservicio de usuarios externos no disponible",
            error: err.message,
            service: "micro-login-users",
          });
        }
      },
    }),
  );

  // ============================================
  // RUTAS DE PROYECTOS (Microservicio Clientes) - PROTEGIDAS (deben ir después de auth)
  // ============================================
  router.use(
    "/clientes/projects",
    createProxyMiddleware({
      target: SERVICES.CLIENTES.baseUrl,
      changeOrigin: true,
      timeout: 30000, // Mayor timeout para subida de archivos

      pathRewrite: (path) => {
        return path.replace("/clientes/projects", "/api/clientes/projects");
      },

      // o si el server.js del microservicio agrega /api globalmente

      onProxyReq: (proxyReq, req, res) => {
        console.log(`XB [PROJECTS] ${req.method} ${req.originalUrl}`);

                console.log(
          `🎯 [PROJECTS] Target: ${SERVICES.CLIENTES.baseUrl}${req.path}`,
        );

        // Pasar headers de autenticación
        // Forward Authorization if present (browser should include it on signed-url PUT)
        if (req.headers.authorization) {
          proxyReq.setHeader('Authorization', req.headers.authorization);
        }

        // Agregar token de microservicio para comunicación segura
        proxyReq.setHeader(
          "X-Microservice-Token",
          DEFAULT_MICROSERVICE_TOKEN,
        );
        proxyReq.setHeader("X-Service-Name", "api-gateway");
        proxyReq.setHeader("X-Gateway-Request", "true");
        // Do NOT read or re-write req.body here — for streaming uploads (PUT to signed URL)
        // we must proxy the raw request body. Only handle parsed bodies for non-proxied routes
        // If some non-stream endpoints require body forwarding, implement per-route handling.
      },

      onProxyRes: (proxyRes, req) => {
        applyCorsHeaders(proxyRes, req);
      },

      onError: (err, req, res) => {
        console.error("Cliente_router [PROJECTS] Error:", err.message);
        res
          .status(503)
          .json({
            success: false,
            message: "Servicio de proyectos no disponible",
          });
      },
    }),
  );




    router.use(
    "/clientes/suscripcion",
    createProxyMiddleware({
      target: SERVICES.CLIENTES.baseUrl,
      changeOrigin: true,
      timeout: 30000, // Mayor timeout para subida de archivos

      pathRewrite: (path, req) => {
        // Usamos req.originalUrl para asegurar que tenemos la ruta completa antes del reemplazo
        return req.originalUrl.replace("/clientes/suscripcion", "/api/clientes/suscripcion");
      },

      // o si el server.js del microservicio agrega /api globalmente

      onProxyReq: (proxyReq, req, res) => {
        console.log(`💳 [SUSCRIPCION] ${req.method} ${req.originalUrl}`);

                console.log(
          `🎯 [SUSCRIPCION] Target: ${SERVICES.CLIENTES.baseUrl}${req.path}`,
        );

        // Pasar headers de autenticación
        if (req.headers.authorization) {
          console.log('🔑 [SUSCRIPCION] Forwarding Authorization header');
          proxyReq.setHeader('Authorization', req.headers.authorization);
        } else {
          console.warn('⚠️ [SUSCRIPCION] No Authorization header found in request!');
        }

        // Agregar token de microservicio para comunicación segura
        // Usamos DEFAULT_MICROSERVICE_TOKEN directamente para asegurar coincidencia con el microservicio (que espera 25 chars)
        const tokenToSend = DEFAULT_MICROSERVICE_TOKEN;
        console.log(`🔐 [SUSCRIPCION] Enviando Token: ${tokenToSend.substring(0, 5)}... (Len: ${tokenToSend.length})`);

        proxyReq.setHeader(
          "X-Microservice-Token",
          tokenToSend,
        );
        proxyReq.setHeader("X-Service-Name", "api-gateway");
        proxyReq.setHeader("X-Gateway-Request", "true");

        // Do NOT read or re-write req.body here — for streaming uploads (PUT to signed URL)
        // we must proxy the raw request body. Only handle parsed bodies for non-proxied routes
        // If some non-stream endpoints require body forwarding, implement per-route handling.
      },

      onProxyRes: (proxyRes, req) => {
        applyCorsHeaders(proxyRes, req);
      },

      onError: (err, req, res) => {
        console.error("Cliente_router [SUSCRIPCION] Error:", err.message);
        res
          .status(503)
          .json({
            success: false,
            message: "Servicio de suscripción no disponible",
          });
      },
    }),
  );



  router.use(
    "/clientes/planes",
    createProxyMiddleware({
      target: SERVICES.CLIENTES.baseUrl,
      changeOrigin: true,
      timeout: 30000, // Mayor timeout para subida de archivos

      pathRewrite: (path) => {
        return path.replace("/clientes/planes", "/api/clientes/planes");
      },

      // o si el server.js del microservicio agrega /api globalmente

      onProxyReq: (proxyReq, req, res) => {
        console.log(`XB [PLANES] ${req.method} ${req.originalUrl}`);

                console.log(
          `🎯 [PLANES] Target: ${SERVICES.CLIENTES.baseUrl}${req.path}`,
        );

        // Pasar headers de autenticación
        // Forward Authorization if present (browser should include it on signed-url PUT)
        if (req.headers.authorization) {
          proxyReq.setHeader('Authorization', req.headers.authorization);
        }

        // Agregar token de microservicio para comunicación segura
        proxyReq.setHeader(
          "X-Microservice-Token",
          DEFAULT_MICROSERVICE_TOKEN,
        );
        proxyReq.setHeader("X-Service-Name", "api-gateway");
        proxyReq.setHeader("X-Gateway-Request", "true");
        // Do NOT read or re-write req.body here — for streaming uploads (PUT to signed URL)
        // we must proxy the raw request body. Only handle parsed bodies for non-proxied routes
        // If some non-stream endpoints require body forwarding, implement per-route handling.
      },

      onProxyRes: (proxyRes, req) => {
        applyCorsHeaders(proxyRes, req);
      },

      onError: (err, req, res) => {
        console.error("Cliente_router [PLANES] Error:", err.message);
        res
          .status(503)
          .json({
            success: false,
            message: "Servicio de planes no disponible",
          });
      },
    }),
  );

router.use(
    "/clientes/creditos",
    createProxyMiddleware({
      target: SERVICES.CLIENTES.baseUrl,
      changeOrigin: true,
      timeout: 30000, // Mayor timeout para subida de archivos

      pathRewrite: (path) => {
        return path.replace("/clientes/creditos", "/api/clientes/creditos");
      },

      // o si el server.js del microservicio agrega /api globalmente

      onProxyReq: (proxyReq, req, res) => {
        console.log(`XB [CREDITOS] ${req.method} ${req.originalUrl}`);

                console.log(
          `🎯 [CREDITOS] Target: ${SERVICES.CLIENTES.baseUrl}${req.path}`,
        );

        // Pasar headers de autenticación
        // Forward Authorization if present (browser should include it on signed-url PUT)
        if (req.headers.authorization) {
          proxyReq.setHeader('Authorization', req.headers.authorization);
        }

        // Agregar token de microservicio para comunicación segura
        proxyReq.setHeader(
          "X-Microservice-Token",
          DEFAULT_MICROSERVICE_TOKEN,
        );
        proxyReq.setHeader("X-Service-Name", "api-gateway");
        proxyReq.setHeader("X-Gateway-Request", "true");
        // Do NOT read or re-write req.body here — for streaming uploads (PUT to signed URL)
        // we must proxy the raw request body. Only handle parsed bodies for non-proxied routes
        // If some non-stream endpoints require body forwarding, implement per-route handling.
      },

      onProxyRes: (proxyRes, req) => {
        applyCorsHeaders(proxyRes, req);
      },

      onError: (err, req, res) => {
        console.error("Cliente_router [CREDITOS] Error:", err.message);
        res
          .status(503)
          .json({
            success: false,
            message: "Servicio de creditos no disponible",
          });
      },
    }),
  );

  // ============================================
  // RUTAS DE CHECKOUT (Microservicio Clientes) - PROTEGIDAS
  // ============================================
  router.use(
    "/clientes/checkout",
    createProxyMiddleware({
      target: SERVICES.CLIENTES.baseUrl,
      changeOrigin: true,
      timeout: 30000,

      pathRewrite: (path) => {
        return path.replace("/clientes/checkout", "/api/clientes/checkout");
      },

      onProxyReq: (proxyReq, req) => {
        console.log(`💰 [CHECKOUT] ${req.method} ${req.originalUrl}`);
        console.log(`🎯 [CHECKOUT] Target: ${SERVICES.CLIENTES.baseUrl}${req.path}`);

        if (req.headers.authorization) {
          proxyReq.setHeader("Authorization", req.headers.authorization);
        }

        proxyReq.setHeader("X-Microservice-Token", DEFAULT_MICROSERVICE_TOKEN);
        proxyReq.setHeader("X-Service-Name", "api-gateway");
        proxyReq.setHeader("X-Gateway-Request", "true");

        if (req.body && req.headers['content-type']?.includes('application/json')) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader("Content-Type", "application/json");
          proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },

      onProxyRes: (proxyRes, req) => {
        console.log(`📥 [CHECKOUT] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
        applyCorsHeaders(proxyRes, req);
      },

      onError: (err, req, res) => {
        console.error("❌ [CHECKOUT] Error:", err.message);
        if (!res.headersSent) {
          res.status(503).json({
            success: false,
            message: "Servicio de checkout no disponible",
          });
        }
      },
    }),
  );

  // ============================================
  // RUTAS DE DESCARGAS DE SOFTWARE (Microservicio Clientes) - PROTEGIDAS
  // ============================================
  router.use(
    "/clientes/downloads",
    createProxyMiddleware({
      target: SERVICES.CLIENTES.baseUrl,
      changeOrigin: true,
      timeout: 120000, // 2 minutos para archivos grandes (~150MB)

      pathRewrite: (path) => {
        return path.replace("/clientes/downloads", "/api/clientes/downloads");
      },

      onProxyReq: (proxyReq, req) => {
        console.log(`📥 [DOWNLOADS] ${req.method} ${req.originalUrl}`);
        console.log(`🎯 [DOWNLOADS] Target: ${SERVICES.CLIENTES.baseUrl}${req.path}`);

        if (req.headers.authorization) {
          proxyReq.setHeader("Authorization", req.headers.authorization);
        }

        proxyReq.setHeader("X-Microservice-Token", DEFAULT_MICROSERVICE_TOKEN);
        proxyReq.setHeader("X-Service-Name", "api-gateway");
        proxyReq.setHeader("X-Gateway-Request", "true");
      },

      onProxyRes: (proxyRes, req) => {
        console.log(`📥 [DOWNLOADS] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
        applyCorsHeaders(proxyRes, req);
      },

      onError: (err, req, res) => {
        console.error("❌ [DOWNLOADS] Error:", err.message);
        if (!res.headersSent) {
          res.status(503).json({
            success: false,
            message: "Servicio de descargas no disponible",
          });
        }
      },
    }),
  );


  router.use(
    "/clientes/servicios",
    createProxyMiddleware({
      target: SERVICES.CLIENTES.baseUrl,
      changeOrigin: true,
      timeout: 30000, // Mayor timeout para subida de archivos

      pathRewrite: (path) => {
        return path.replace("/clientes/servicios", "/api/clientes/servicios");
      },

      // o si el server.js del microservicio agrega /api globalmente

      onProxyReq: (proxyReq, req, res) => {
        console.log(`XB [SERVICIOS] ${req.method} ${req.originalUrl}`);

                console.log(
          `🎯 [SERVICIOS] Target: ${SERVICES.CLIENTES.baseUrl}${req.path}`,
        );

        // Pasar headers de autenticación
        // Forward Authorization if present (browser should include it on signed-url PUT)
        if (req.headers.authorization) {
          proxyReq.setHeader('Authorization', req.headers.authorization);
        }

        // Agregar token de microservicio para comunicación segura
        proxyReq.setHeader(
          "X-Microservice-Token",
          DEFAULT_MICROSERVICE_TOKEN,
        );
        proxyReq.setHeader("X-Service-Name", "api-gateway");
        proxyReq.setHeader("X-Gateway-Request", "true");
        // Do NOT read or re-write req.body here — for streaming uploads (PUT to signed URL)
        // we must proxy the raw request body. Only handle parsed bodies for non-proxied routes
        // If some non-stream endpoints require body forwarding, implement per-route handling.
      },

      onProxyRes: (proxyRes, req) => {
        applyCorsHeaders(proxyRes, req);
      },

      onError: (err, req, res) => {
        console.error("Cliente_router [SERVICIOS] Error:", err.message);
        res
          .status(503)
          .json({
            success: false,
            message: "Servicio de servicios no disponible",
          });
      },
    }),
  );


  // ============================================
  // LIBRO DE RECLAMACIONES (Microservicio Clientes) - PÚBLICO
  // ============================================
  router.use(
    "/clientes/libro-reclamaciones",
    createProxyMiddleware({
      target: SERVICES.CLIENTES.baseUrl,
      changeOrigin: true,
      timeout: 30000, // Mayor timeout para subida de archivos

      pathRewrite: (path) => {
        return path.replace("/clientes/libro-reclamaciones", "/api/clientes/libro-reclamaciones");
      },

      onProxyReq: (proxyReq, req) => {
        console.log(`📋 [LIBRO-RECLAMACIONES] ${req.method} ${req.originalUrl}`);
        console.log(`🎯 [LIBRO-RECLAMACIONES] Target: ${SERVICES.CLIENTES.baseUrl}${req.path}`);



        if (req.headers.authorization) {
          proxyReq.setHeader("Authorization", req.headers.authorization);
        }

        proxyReq.setHeader("X-Microservice-Token", DEFAULT_MICROSERVICE_TOKEN);
        proxyReq.setHeader("X-Service-Name", "api-gateway");
        proxyReq.setHeader("X-Gateway-Request", "true");

        // Para FormData (multipart) NO re-serializar el body, dejar que el stream pase directo
        // Solo re-serializar si es JSON
        if (req.body && req.headers['content-type']?.includes('application/json')) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader("Content-Type", "application/json");
          proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },

      onProxyRes: (proxyRes, req) => {
        console.log(`📥 [LIBRO-RECLAMACIONES] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
        applyCorsHeaders(proxyRes, req);
      },

      onError: (err, req, res) => {
        console.error("❌ [LIBRO-RECLAMACIONES] Error:", err.message);
        if (!res.headersSent) {
          res.status(503).json({
            success: false,
            message: "Servicio de libro de reclamaciones no disponible",
          });
        }
      },
    }),
  );

  // ============================================
  // VALIDAR TOKEN DESDE LANDING RUWAY
  // ============================================
  //con correo
  router.post('/auth/clientes/validar-token-desde-landing', 
    express.json(),
    async (req, res) => {
      try {
        console.log('🔄 [API Gateway] Validando token desde landing...');
        
        const { userId, token } = req.body;
        console.log(`📩 Payload recibido  jose  : userId=${userId}, token=${token}`);


        if (!userId || !token) {
          return res.status(400).json({
            success: false,
            message: 'userId y token son requeridos'
          });
        }
        
        //        return path.replace(/^\/auth\/clientes/, "/api/clientes/auth");
        // Reenviar al microservicio de clientes
        const response = await fetch(`${SERVICES.CLIENTES.baseUrl}/api/clientes/auth/validar-token-desde-landing`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Microservice-Token': process.env.MICROSERVICE_TOKEN || DEFAULT_MICROSERVICE_TOKEN,
            'X-Service-Name': 'api-gateway',
            'X-Gateway-Request': 'true'
          },
          body: JSON.stringify({ userId, token })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          return res.status(response.status).json(data);
        }
        
        console.log('✅ [API Gateway] Token validado correctamente');
        res.json(data);
        
      } catch (error) {
        console.error('❌ [API Gateway] Error validando token:', error.message);
        res.status(500).json({
          success: false,
          message: 'Error interno del servidor'
        });
      }
    }
  );

  // ============================================
  // CATCH-ALL /clientes/* (Microservicio Clientes)
  // ============================================
  // Cubre cualquier ruta de micro-planos-ruwark que no tenga un mount
  // específico arriba (proyectos-gis, presentaciones, componentes,
  // plantillas, galeria, media, referidos, dimension-hoja, documents,
  // cupones, billetera, moneda, pagos-gateway, etc). Va DESPUÉS de los
  // mounts específicos para que esos sigan teniendo prioridad.
  router.use(
    "/clientes",
    createProxyMiddleware({
      target: SERVICES.CLIENTES.baseUrl,
      changeOrigin: true,
      timeout: 30000,

      pathRewrite: (path) => {
        return path.replace(/^\/clientes/, "/api/clientes");
      },

      onProxyReq: (proxyReq, req) => {
        console.log(`👥 [CLIENTES-CATCHALL] ${req.method} ${req.originalUrl}`);

        if (req.headers.authorization) {
          proxyReq.setHeader("Authorization", req.headers.authorization);
        }

        proxyReq.setHeader("X-Microservice-Token", DEFAULT_MICROSERVICE_TOKEN);
        proxyReq.setHeader("X-Service-Name", "api-gateway");
        proxyReq.setHeader("X-Gateway-Request", "true");
      },

      onProxyRes: (proxyRes, req) => {
        applyCorsHeaders(proxyRes, req);
      },

      onError: (err, req, res) => {
        console.error("❌ [CLIENTES-CATCHALL] Error:", err.message);
        if (!res.headersSent) {
          res.status(503).json({
            success: false,
            message: "Microservicio de clientes no disponible",
          });
        }
      },
    }),
  );

  // ============================================
  // NUEVAS RUTAS API CLIENTES (Separación clara - v2024)
  // ============================================
  router.use(
    "/api/clientes",
    createProxyMiddleware({
      target: SERVICES.CLIENTES.baseUrl,
      changeOrigin: true,
      timeout: 30000,

      pathRewrite: (path) => {
        // Convierte /api/clientes/proyecto/CODIGO → /api/clientes/obtenerproyecto/CODIGO  
        return path.replace(/^\/api\/clientes\/proyecto/, "/api/clientes/obtenerproyecto");
      },

      onProxyReq: (proxyReq, req, res) => {
        console.log(`👥 [API-CLIENTES] ${req.method} ${req.originalUrl}`);
        console.log(`🎯 [API-CLIENTES] Target: ${SERVICES.CLIENTES.baseUrl}${req.path}`);

        // Pasar headers de autenticación
        if (req.headers.authorization) {
          proxyReq.setHeader("Authorization", req.headers.authorization);
        }

        // Manejar body para requests POST/PUT/PATCH
        if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && req.body) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Type', 'application/json');
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },

      onProxyRes: (proxyRes, req) => {
        console.log(`📥 [API-CLIENTES] Response ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`);
      },

      onError: (err, req, res) => {
        console.error("❌ [API-CLIENTES] Error:", err.message);
        console.error("❌ [API-CLIENTES] Target URL:", SERVICES.CLIENTES.baseUrl);
        if (!res.headersSent) {
          res.status(503).json({
            success: false,
            message: "Microservicio de clientes no disponible",
            error: err.message,
            service: "micro-clientes-ruwark",
          });
        }
      },
    }),
  );

  return router;
}
