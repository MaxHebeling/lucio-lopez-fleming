---
dominio: integrations
titulo: Automatizaciones de IA (reacciones a eventos)
resumen: Qué hacen las reacciones de IA cuando pasa algo en el CRM, qué no hacen nunca, cómo se activan y dónde ver si funcionan.
permisos: automations.read, integrations.read, ai.read_usage
---

## Qué hacen las reacciones de IA
<!-- ruta: /crm/automatizaciones; permisos: automations.read -->

Son automatizaciones de sistema (aparecen en **Automatizaciones** con el nombre «IA: …») que reaccionan a hechos del CRM:

- **Visita finalizada**: sugiere al agente cargar el informe y preparar el agradecimiento, y actualiza la siguiente acción del cliente.
- **Propiedad publicada**: prepara borradores de marketing con los datos de la ficha (SEO, WhatsApp, email y guion de Reel; los de Instagram y Facebook los sigue armando «Borradores para redes») y sugiere al responsable revisarlos. Los clientes compatibles los sigue calculando «Ventas: clientes compatibles».
- **Lead nuevo**: deja la siguiente acción en la bandeja del agente asignado (prioridad alta si hay señales fuertes). La calificación la sigue haciendo «Ventas: calificar lead».
- **Informe de visita confirmado**: propone datos del perfil del comprador como **sugeridos** (nunca confirmados) y el seguimiento sugerido.

Nunca envían mensajes a clientes, nunca publican en el sitio, portales ni redes y nunca confirman datos: todo queda como sugerencia o borrador para que una persona decida.

## Activar o desactivar las automatizaciones de IA
<!-- ruta: /crm/integraciones; permisos: integrations.manage -->

Se controlan con el flag **ai_automations** en **Integraciones → Feature flags** (no con el botón de cada automatización). Al apagarlo se desactivan en el momento; al encenderlo se activan (el sistema lo verifica también cada 5 minutos). Mientras están apagadas, los eventos que ocurran no se procesan después.

## Ver si las automatizaciones de IA funcionan
<!-- ruta: /crm/integraciones/ia; permisos: ai.read_usage -->

En **Integraciones → Uso de IA**, la sección **Automatizaciones de IA** muestra por automatización: ejecuciones, con error, omitidas (y cuántas por protección contra loops) y duración p50/p95. También los jobs muertos de IA del período. En **Automatizaciones** cada una muestra ejecuciones, errores, omitidas y duración de los últimos 7 días.

Si una reacción falla, se reintenta sola con espera creciente hasta 5 veces; si sigue fallando queda como job muerto y administración recibe un aviso (se reintenta desde **Sistema → Jobs**).

## Protección contra loops
<!-- ruta: /crm/automatizaciones; permisos: automations.read -->

Lo que emite una automatización queda marcado como derivado de su evento. Una automatización nunca vuelve a correr dentro de su propia cadena de eventos, y una cadena de eventos derivados se corta a la profundidad máxima (3 por defecto). Esas ejecuciones aparecen como **Omitidas** con el motivo «protección contra loops».
