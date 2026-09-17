---
dominio: leads
titulo: Siguiente acción sugerida, señales de interés y resumen del lead
resumen: Qué sugiere el CRM hacer con cada cliente, por qué, cómo aceptar o descartar una sugerencia, cómo leer las señales de interés y usar «Ponme al día».
permisos: leads.read_own, leads.read_all
---

## Usar la siguiente acción sugerida
<!-- ruta: /crm/leads/[id]; permisos: leads.read_own, leads.read_all -->

En el lead, en la ficha del contacto y en la oportunidad aparece la tarjeta **Siguiente acción sugerida** con hasta tres sugerencias, cada una con prioridad (alta, media o baja), el motivo y un desplegable **Por qué** con los hechos que la explican.

Sugerencias posibles: **Contactar hoy** (consulta sin responder y señales de interés fuertes), **Responder la consulta**, **Coordinar visita** (pidió visita y no hay una agendada), **Hacer el seguimiento de la visita**, **Enviar nuevas opciones** (hay compatibles nuevas o descartó por presupuesto), **Pedir confirmación de presupuesto**, **Revisar datos sugeridos del perfil** y **Retomar el contacto** (oportunidad sin movimiento).

La sugerencia es una recomendación: la decisión es tuya.

## Aceptar, posponer o descartar una sugerencia
<!-- ruta: /crm/leads/[id]; permisos: tasks.manage -->

En la tarjeta **Siguiente acción sugerida**:

1. **Aceptar y crear tarea**: crea una tarea real a tu nombre (en **Tareas**), vinculada al lead, contacto u oportunidad, con vencimiento según la prioridad. Aceptar dos veces no duplica la tarea.
2. **Posponer 3 días**: la oculta por tres días.
3. **Descartar**: podés escribir un **Motivo (opcional)** y tocar **Descartar**. No vuelve a sugerirse mientras la situación del cliente no cambie.

Cada decisión queda registrada. Una decisión tomada desde el lead vale también en la ficha del contacto.

## Leer las señales de interés
<!-- ruta: /crm/contactos/[id]; permisos: leads.read_own, leads.read_all -->

La tarjeta **Señales de interés** de la ficha del contacto muestra un nivel (alta, media o baja) y la lista de hechos que lo explican: solicitó visita, volvió a una propiedad en días distintos, hizo el tour 360°, preguntó por disponibilidad o visita, comparó propiedades.

Las señales del sitio salen de la navegación de esa persona solo desde el momento en que **envió una consulta** desde esa pestaña del navegador; antes son anónimas. Si el navegador pide «Do Not Track», no se vincula nada. Sin hechos registrados dice «Sin señales registradas».

## Resumen del lead
<!-- ruta: /crm/leads/[id]; permisos: leads.read_own, leads.read_all -->

La tarjeta **Resumen del lead** junta en un solo lugar nombre, canales de contacto, origen, propiedad consultada, objetivo, presupuesto, zona, tipo, dormitorios, plazo, financiación y necesidades, con el estado de cada dato (confirmado o sugerido y su origen) y un porcentaje de completitud.

En «Para averiguar en la conversación» aparecen los datos clave que faltan (por ejemplo, plazo o forma de pago): preguntalos de a poco, sin interrogatorio. Los datos sugeridos se confirman en el perfil del contacto.

## Ponme al día con un cliente
<!-- ruta: /crm/contactos/[id]; permisos: leads.read_own, leads.read_all -->

Con la ficha de un contacto o un lead abierta, abrí **✦ Asistente IA** (Ctrl + I), elegí el modo **Analista** y tocá **Ponme al día con este cliente**. Muestra, con su origen: perfil de búsqueda (confirmado o sugerido), señales de interés, propiedades consultadas, próxima visita y visitas realizadas con su informe confirmado, descartes con motivo, tareas pendientes y la siguiente acción sugerida.

Solo muestra lo que podés ver con tu rol. Sin la clave de IA son los datos directos; con la clave, el asistente además los redacta, separando los hechos de su interpretación.
