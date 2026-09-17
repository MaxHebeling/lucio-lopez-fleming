# Base de conocimiento del CRM (Knowledge AI)

Guías operativas del CRM de Lucio López Fleming escritas **a partir del código real** (rutas, formularios, acciones y
permisos). Las consume el copiloto «✦ Asistente IA» (modo Asistente) vía `pnpm ai:knowledge:ingest`, que las trocea
por sección `##` y las indexa con búsqueda full-text en español. Ver `docs/ai/AI_CORE.md`.

## Formato (obligatorio: lo valida el ingestor y un test)

```markdown
---
dominio: properties
titulo: Propiedades
resumen: Una línea que describe el alcance de esta guía.
permisos: properties.read
---

## Crear una propiedad
<!-- ruta: /crm/propiedades/nueva; permisos: properties.create -->

Texto de la sección en español rioplatense (vos)...
```

- **Frontmatter**: `dominio` (uno de: crm, properties, leads, agenda, agents, virtual-tours, marketing, rentals,
  operations, permissions, integrations, faq, visits), `titulo`, `resumen`, `permisos` (por defecto de las secciones; vacío =
  cualquier usuario del equipo).
- **Cada sección `##`** es un fragmento independiente: tiene que entenderse sola (no "como vimos arriba").
- **Comentario de metadatos** en la línea siguiente al título (opcional): `ruta` = pantalla del CRM donde se hace
  (puede llevar `[id]`, p. ej. `/crm/propiedades/[id]/tour`); `permisos` = lista separada por comas; alcanza con tener
  **uno** para ver la sección. Sin `permisos` hereda los del frontmatter.
- Nada inventado: si una función no existe, la guía lo dice ("Hoy el CRM no permite…").
- Sin datos personales, precios, teléfonos ni emails reales.
