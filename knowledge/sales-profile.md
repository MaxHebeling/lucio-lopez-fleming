---
dominio: leads
titulo: Perfil de búsqueda del cliente
resumen: Qué busca cada cliente (operación, presupuesto, zonas, tipo, dormitorios, plazo, financiación), de dónde sale cada dato y cómo se confirma.
permisos: leads.read_own, leads.read_all
---

## Ver el perfil de búsqueda de un contacto
<!-- ruta: /crm/contactos/[id]; permisos: leads.read_own, leads.read_all -->

En la ficha de un contacto, la tarjeta **Perfil de búsqueda** muestra lo que el cliente busca: **Operación**, **Objetivo**, **Tipo de propiedad**, **Presupuesto**, **Zonas**, **Dormitorios (mínimo)**, **Baños (mínimo)**, **Superficie**, **Prioridades / características**, **Plazo**, **Financiación** y **Notas de la búsqueda**.

Cada dato tiene un estado:

- **Confirmado** (verde): lo cargó o lo confirmó una persona del equipo. Debajo ves quién y cuándo.
- **Sugerido** (amarillo): lo propuso el sistema y todavía nadie lo validó. Debajo ves el origen y la confianza (alta, media o baja).

La lista de campos es cerrada: el perfil solo guarda datos de la propiedad que busca. No hay lugar para datos sensibles (salud, religión, situación familiar, ingresos o documentos) y no deben escribirse en las notas.

Un agente ve el perfil de los contactos que tiene asignados o con un lead u oportunidad asignada a él; con **Ver todos los leads** se ven todos los de la inmobiliaria. La tarjeta aparece si el flag **ai_matching** está encendido.

## De dónde salen los datos sugeridos
<!-- ruta: /crm/contactos/[id]; permisos: leads.read_own, leads.read_all -->

El perfil se completa de a poco, sin interrogar al cliente. Orígenes posibles:

- **Formulario del sitio**: las preguntas opcionales «¿Para cuándo lo buscás?» y «¿Cómo pensás pagar?» de las consultas, y la operación de la ficha consultada.
- **Búsqueda en el sitio (concierge)**: si la persona usó «Contanos qué buscás» en esa pestaña y después envió una consulta, se proponen los filtros que usó (nunca el texto que escribió).
- **Consulta escrita**: los datos que se reconocen en el mensaje de la consulta (por ejemplo «casa de 3 dormitorios hasta USD 200.000»). Con la clave de IA configurada, además los extrae un modelo, validados contra el catálogo real.
- **Conversación**: propuestas hechas desde el asistente.
- **Cargado por el equipo**: lo que carga una persona queda confirmado directamente.

Un dato sugerido nunca pisa uno confirmado y un valor que el equipo descartó no se vuelve a proponer.

## Confirmar, descartar o corregir un dato del perfil
<!-- ruta: /crm/contactos/[id]; permisos: contacts.update -->

En la tarjeta **Perfil de búsqueda**:

1. Si un dato está **Sugerido** y es correcto, tocá **Confirmar**. Si no lo es, tocá **Descartar**.
2. Para cambiar un valor tocá **Editar**, completá el formulario y tocá **Guardar como confirmado**.
3. Para agregar un dato que falta, usá los botones **+ Presupuesto**, **+ Zonas**, etc. de «Agregar dato».
4. Para sacar un dato confirmado tocá **Quitar** (queda en el historial).

Con **Ver historial** ves todos los valores anteriores con su estado (sugerido, confirmado, descartado o reemplazado), su origen y la fecha. Cada cambio queda en la auditoría y recalcula las propiedades compatibles del cliente.
