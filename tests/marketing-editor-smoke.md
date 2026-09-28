# Marketing editor Gateway smoke checks

Automated Gateway route/header checks exist in `api-gateway-ruwark/tests/marketing-editor.routes.test.js`.
Run them with:

```bash
npm run test:marketing-editor
```

The smoke checks below are still useful after setting safe local values for `JWT_SECRET`, `MICROSERVICE_TOKEN`, and `MICRO_EDITOR_IMAGEN_URL` or with the localhost fallback service on port 4008. Do not print real tokens in shared logs.

## Route mapping

1. Start `micro-editor-imagen` on `http://localhost:4008`.
2. Start the Gateway from `api-gateway-ruwark/`.
3. Use a valid JWT whose payload includes a trusted brand-membership field such as `marca_usuario_id`, `marcaUsuarioId`, `marcaUsuario.id`, or `brandMembershipId`.
4. Verify these public routes proxy to the matching internal `/v1/*` routes:
   - `GET /marketing/design-documents/{id}/draft` -> `/v1/design-documents/{id}/draft`
   - `GET /marketing/templates` -> `/v1/templates`
   - `GET /marketing/resources` -> `/v1/resources`
   - `GET /marketing/external-assets/iconify/search` -> `/v1/external-assets/iconify/search`
   - `GET /marketing/output-presets` -> `/v1/output-presets`
   - `POST /marketing/exports` -> `/v1/exports`

Example shape, with token value intentionally omitted:

```bash
curl -i http://localhost:8080/marketing/templates \
  -H 'Authorization: Bearer <JWT_WITH_BRAND_SCOPE>'
```

## Header safety

- Send forged browser headers (`X-Service-Token`, `X-User-Id`, `X-Marca-Usuario-Id`) and confirm the Gateway overwrites/removes them before proxying.
- Use a JWT without brand membership and confirm Gateway responds `403` with `BRAND_SCOPE_DENIED`.
- Confirm logs show route, status, and `requestId`, but do not print Authorization, service-token values, or full trusted identity headers.
