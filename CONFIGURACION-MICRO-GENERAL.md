# Configuración del API Gateway para Micro-General

Este documento describe cómo se ha configurado el API Gateway para enrutar las peticiones del frontend hacia el microservicio `micro-general`.

## 🔄 Flujo de Comunicación

```
Frontend (localhost:3000)
    ↓
API Gateway (localhost:8080)
    ↓
Micro-General (localhost:3002)
```

## 📋 Rutas Configuradas

### Documentos
- **Frontend:** `http://localhost:3000/api/documents/*`
- **Gateway:** `http://localhost:8080/api/documents/*`
- **Microservicio:** `http://localhost:3002/api/documents/*`

### Hojas de Cálculo
- **Frontend:** `http://localhost:3000/api/spreadsheets/*`
- **Gateway:** `http://localhost:8080/api/spreadsheets/*`
- **Microservicio:** `http://localhost:3002/api/spreadsheets/*`

### Notas Inteligentes (MIGRADO)
- **Frontend:** `http://localhost:3000/api/notes/*`
- **Gateway:** `http://localhost:8080/api/notes/*`
- **Microservicio:** `http://localhost:3002/api/notes/*`

⚠️ **Cambio importante:** Las notas ya NO están en `micro-operaciones` (puerto 3001), ahora están en `micro-general` (puerto 3003).

## 🔧 Configuración del Gateway

### Variables de Entorno

En `.env` del API Gateway:

```env
# Microservicio General
MICRO_GENERAL_URL=http://localhost:3003

# En producción
MICRO_GENERAL_URL=http://micro-general:3003
```

### Archivos Modificados

1. **`src/config/services.js`**
   - Agregada ruta `/api/notes` al servicio GENERAL
   - Removida ruta `/api/notes` del servicio OPERACIONES

2. **`src/routes/index.js`**
   - Agregado proxy para `/api/documents`
   - Agregado proxy para `/api/spreadsheets`
   - Migrado proxy de `/api/notes` de OPERACIONES a GENERAL

## 🔐 Autenticación

El API Gateway pasa el token de autenticación al microservicio:

```javascript
// El gateway reenvía el header Authorization
if (req.headers.authorization) {
    proxyReq.setHeader('Authorization', req.headers.authorization);
}
```

El microservicio `micro-general` valida el token usando su middleware `authMiddleware`.

## 📝 Headers Agregados por el Gateway

El gateway agrega headers adicionales para identificar las peticiones:

```javascript
proxyReq.setHeader('X-Service-Name', 'api-gateway');
proxyReq.setHeader('X-Gateway-Request', 'true');
```

## 🧪 Testing

### 1. Verificar que el Gateway está corriendo

```bash
curl http://localhost:8080
```

Deberías ver la información de servicios, incluyendo:
```json
{
  "services": {
    "general": "http://localhost:3003"
  },
  "endpoints": {
    "general": {
      "documents": "/api/documents",
      "spreadsheets": "/api/spreadsheets",
      "notes": "/api/notes"
    }
  }
}
```

### 2. Probar Notas a través del Gateway

```bash
# Obtener notas (requiere token)
curl -X GET http://localhost:8080/api/notes \
  -H "Authorization: Bearer YOUR_TOKEN"

# Crear nota
curl -X POST http://localhost:8080/api/notes \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Nota de prueba",
    "positionX": 100,
    "positionY": 100
  }'
```

### 3. Verificar Logs del Gateway

El gateway loguea cada petición:

```
🔗 [NOTAS] Proxying GET /api/notes
🎯 [NOTAS] Target: http://localhost:3003/api/notes
📥 [NOTAS] Response 200 for GET /api/notes
```

## 🚀 Deployment

### Docker Compose

```yaml
version: '3.8'
services:
  api-gateway:
    build: ./api-gateway-ruwark
    ports:
      - "8080:8080"
    environment:
      - MICRO_GENERAL_URL=http://micro-general:3003
    depends_on:
      - micro-general

  micro-general:
    build: ./micro-general
    ports:
      - "3003:3003"
    environment:
      - DB_HOST=mysql
      - DB_PORT=3306
      - DB_USER=root
      - DB_PASSWORD=${DB_PASSWORD}
      - DB_NAME=micro_general
    depends_on:
      - mysql

  mysql:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=${DB_PASSWORD}
      - MYSQL_DATABASE=micro_general
    ports:
      - "3306:3306"
```

### Verificación en Producción

```bash
# Health check del gateway
curl https://tu-dominio.com/health

# Health check del microservicio (a través del gateway)
curl https://tu-dominio.com/api/notes/health
```

## 🔍 Troubleshooting

### Error: "Servicio de notas no disponible"

1. Verificar que micro-general esté corriendo:
   ```bash
   curl http://localhost:3003/health
   ```

2. Verificar que MySQL esté accesible desde micro-general

3. Revisar logs del gateway:
   ```bash
   # Buscar errores de conexión
   grep "Error en servicio NOTAS" logs/gateway.log
   ```

### Error: "Token inválido"

El token debe ser válido y no expirado. Verificar:
- JWT_SECRET es el mismo en login y micro-general
- El token no ha expirado
- El formato es `Bearer <token>`

### Timeout

Si las peticiones tardan mucho:
- Verificar que MySQL esté respondiendo rápido
- Aumentar timeout en el proxy del gateway (actualmente 15000ms)
- Revisar índices en las tablas de MySQL

## 📊 Monitoreo

El gateway loguea:
- ✅ Peticiones exitosas
- ❌ Errores de conexión
- ⏱️ Timeouts
- 🔑 Problemas de autenticación

Revisar logs regularmente para detectar problemas.

## 🔄 Rollback

Si necesitas revertir las notas a micro-operaciones:

1. Actualizar `src/config/services.js`:
   ```javascript
   OPERACIONES: {
       routes: ['/api/projects', '/api/tracking', '/api/notes']
   }
   ```

2. Cambiar el proxy en `src/routes/index.js` para apuntar a OPERACIONES

3. Reiniciar el gateway

---

**Última actualización:** 17 de noviembre de 2025
