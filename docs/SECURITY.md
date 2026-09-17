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

## Endurecimiento 2026-09 (hallazgos de auditoría sobre datos)

- **Cuentas sin contraseña** (invitaciones pendientes, agentes importados): "olvidé mi contraseña" no las activa; solo una
  invitación de un administrador. Recuperación con piso de tiempo de respuesta (`RESET_MIN_RESPONSE_MS`) y login que
  siempre verifica argon2 (hash real o de relleno), también para cuentas bloqueadas o sin contraseña.
- **Cambio de contraseña obligatorio**: `runAction` y las mutaciones de `apiRoute` con sesión rechazan todo salvo
  `account.change_password` mientras `must_change_password` esté pendiente (no solo la navegación).
- **Capturas no verificadas** (web anónima, portales, email escrito en un chat): sobre un contacto existente no agregan
  emails/teléfonos ni el rol propietario; los datos quedan en `leads.submitted_email/submitted_phone`, con aviso en la
  ficha del contacto y alerta en el lead. Solo el equipo (y el número de WhatsApp, verificado por Meta) completa fichas.
- **Dirección oculta**: la búsqueda pública no usa la calle (índice `properties_public_search_trgm`); Mercado Libre usa la
  misma calle pública que el sitio (`publicStreet`, quita alturas embebidas). El CRM avisa cuando el título o la
  descripción mencionan calle y altura (`src/server/properties/address-leak.ts`); los datos importados no se modifican.
- **Agentes de propiedades**: permiso propio `properties.assign_agents` (no lo tiene `agente`) y solo usuarios del equipo
  activos. Mostrar la dirección exacta de una propiedad publicada exige `properties.publish`.
- **Conversaciones**: sin `leads.read_all` solo se ven y operan las asignadas, las del bot sin asignar, las de leads o
  contactos asignados (`src/server/conversations/scope.ts`); fuera de alcance = 404.
- **IP del cliente**: Vercel → `x-vercel-forwarded-for`/`x-real-ip`; otro proxy → `TRUSTED_PROXY_HOPS`; sin eso, en
  producción no se confía en cabeceras.
- **Storage**: la subida directa verifica tamaño con HEAD antes de descargar y exige `UPLOAD_SIGNING_SECRET` en producción.
  Borrar multimedia elimina el objeto del bucket público (`files.storage_removed_at`; pendientes se reintentan en la
  siguiente baja o con `removeDeletedPublicMedia`).

### Riesgo aceptado: fotos de propiedades no publicadas en el bucket público

La versión optimizada de cada foto se guarda en el bucket público desde la subida, aunque la propiedad sea un borrador o
se despublique (así el sitio, los portales y las redes la sirven sin firmar URLs). La clave incluye un UUID v4
(`properties/<id>/<año>/<mes>/<uuid>.webp`): no es adivinable ni listable si el bucket no permite listado (verificarlo
en el proveedor). Quien ya tuvo la URL puede seguir viéndola hasta que la foto se borre. Las fotos no llevan EXIF/GPS.
Si hiciera falta más (p. ej. obras sin anunciar), la alternativa es subir a privado y copiar al público al publicar
(`property.published`), con el costo de mover objetos al despublicar.

## Reportar una vulnerabilidad

Escribir a la dirección técnica del proyecto (no abrir issue público). Se responde en 72 h.

## Riesgos aceptados / pendientes

Ver `docs/audit/` (auditoría final): cada riesgo residual con su mitigación y responsable.
