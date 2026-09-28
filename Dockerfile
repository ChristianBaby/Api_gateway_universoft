# API Gateway - Dockerfile
FROM node:20-alpine

# Información del mantenedor
LABEL maintainer="Ruwark Development Team"
LABEL description="API Gateway para el sistema Ruwark"

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de configuración de npm
COPY package*.json ./

# Instalar dependencias
RUN npm install --omit=dev

# Copiar código fuente
COPY . .

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs
RUN adduser -S gateway -u 1001

# Cambiar propietario de los archivos
RUN chown -R gateway:nodejs /app
USER gateway

# Exponer puerto
EXPOSE ${PORT:-8080}

# Variables de entorno
ENV NODE_ENV=production
ENV PORT=${PORT:-8080}
# Timeout específico para proxy de micro-publicaciones.
# EasyPanel puede sobreescribirlo con la variable del mismo nombre.
ENV MICRO_PUBLICACIONES_TIMEOUT_MS=180000
# Timeout específico para Video Studio: exportar MP4 puede tardar más por multipart + S3.
ENV MICRO_EDITOR_VIDEO_TIMEOUT_MS=180000
ENV MICRO_EDITOR_IMAGEN_TIMEOUT_MS=1800000

# Health check dinámico
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); \
               const port = process.env.PORT || 8080; \
               const options = { host: 'localhost', port: port, path: '/health' }; \
               const req = http.request(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); \
               req.on('error', () => process.exit(1)); \
               req.end();"

# Comando de inicio
CMD ["node", "src/server.js"]
