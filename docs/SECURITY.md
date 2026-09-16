# Seguridad

## Controles implementados

- **Autenticación**: argon2id (OWASP), sesiones con token aleatorio de 256 bits guardado como sha256, cookie httpOnly +
  SameSite=Lax + Secure, vida máxima absoluta 14 días, revocación al cambiar/restablecer contraseña, bloqueo tras 5 intentos
  (15 min), rate limit por IP, respuestas y tiempos iguales para usuarios inexistentes, reset de un solo uso atómico.
- **Autorización**: RBAC en base (7 roles, 50+ permisos) verificado en cada servicio y página; alcance "propio/todos" en
  leads y oportunidades; portal de propietarios filtrado por el contacto del actor; tests de IDOR y aislamiento.
- **Datos**: constraints y exclusiones en la base; auditoría append-only; pagos no borrables; DTO públicos con columnas
  explícitas; dirección exacta oculta por defecto; archivos privados solo con URL firmada/ruta autorizada; subida de
  archivos validada por firma real, tamaño y sin metadatos EXIF/GPS.
- **Web**: CSP restrictiva, HSTS, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy; CRM y portal
  con `noindex`; Server Actions con verificación de origen (Next); formularios públicos con honeypot, rate limit e idempotencia.
- **Integraciones**: webhooks firmados (HMAC) e idempotentes; secretos solo en entorno; timeouts, reintentos acotados y
  circuit breaker; IA sin acceso a datos privados ni capacidad de inventar inventario (herramientas sobre la base + guardas).
- **Supabase**: RLS deny-all y revoke a `anon`/`authenticated` en cada migración.
- **Operación**: logger con redacción de secretos/PII; errores públicos sin detalles internos; escaneo de secretos y
  `pnpm audit` en CI; dependencias con versión exacta y lockfile.

## Reportar una vulnerabilidad

Escribir a la dirección técnica del proyecto (no abrir issue público). Se responde en 72 h.

## Riesgos aceptados / pendientes

Ver `docs/audit/` (auditoría final): cada riesgo residual con su mitigación y responsable.
