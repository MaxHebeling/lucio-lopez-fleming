---
dominio: crm
titulo: Resumen de hoy y Tareas sugeridas
resumen: Qué muestra la tarjeta «Resumen de hoy» del Tablero, cómo se calcula cada número y cómo usar la bandeja «Tareas sugeridas» (aceptar, posponer, descartar).
permisos: dashboard.read
---

## Qué es el Resumen de hoy
<!-- ruta: /crm; permisos: dashboard.read -->

Arriba de todo en el **Tablero** aparece la tarjeta **Resumen de hoy**: un saludo según la hora de Salta y los números del día que necesitan atención, cada uno con un link a la lista filtrada. Solo aparecen los que tienen algo (un cero no se muestra).

Puede incluir: visitas programadas para hoy, leads nuevos con señales de alta intención sin contactar, clientes que necesitan seguimiento, propiedades nuevas que coinciden con compradores activos, seguimientos vencidos, visitas próximas sin agente activo, incidencias abiertas en visitas, anomalías detectadas y publicaciones con calidad baja.

Cada persona ve lo suyo según su rol: un agente ve lo asignado a él; administración y dirección ven el equipo. Si todo está al día, la tarjeta lo dice.

## Cómo se calcula cada número del Resumen de hoy
<!-- ruta: /crm; permisos: dashboard.read -->

Todos los números salen de datos reales del CRM. Abrí **¿Cómo se calcula?** al pie de la tarjeta para leer la definición exacta de cada uno (por ejemplo, «seguimientos vencidos» = tareas abiertas de tipo seguimiento con vencimiento anterior a ahora).

El resumen se guarda unos minutos para no recalcular en cada visita al Tablero. Se recalcula solo cuando cambia algo relevante (por ejemplo, al aceptar una tarea sugerida) o cuando tocás **Actualizar** (como máximo una vez por minuto).

Con la clave de IA cargada, arriba de los números aparecen 2 o 3 líneas redactadas: **Hechos** (solo con las cifras del resumen) e **Interpretación de la IA (no son datos)**. Si la redacción menciona una cifra que no está en el resumen, se descarta y quedan los números.

## Usar la bandeja de Tareas sugeridas
<!-- ruta: /crm/tareas-sugeridas; permisos: tasks.manage, tasks.read_all -->

En **Tareas sugeridas** se juntan en un solo lugar las sugerencias que antes estaban repartidas: siguiente acción de ventas, cierre de visitas (cargar el informe, crear el seguimiento, preparar el agradecimiento), alertas del centro operativo, leads sin asignar, fichas con calidad baja, borradores de marketing para revisar y anomalías.

Cada sugerencia muestra prioridad (alta, media o baja), origen, el motivo, el registro al que se refiere (con link) y un desplegable **Por qué** con la evidencia. Están ordenadas por prioridad y, dentro de la misma prioridad, por urgencia y antigüedad.

Filtros: **Mías / Equipo** (Equipo solo con permiso para ver las tareas de todos), **Pendientes / Pospuestas**, origen y prioridad. **Actualizar sugerencias** recalcula la bandeja en el momento (como máximo una vez cada 2 minutos); igual se actualiza sola cada 5 minutos y cada hora.

## Aceptar, posponer o descartar una tarea sugerida
<!-- ruta: /crm/tareas-sugeridas; permisos: tasks.manage -->

1. **Aceptar y crear tarea**: crea la tarea real en **Tareas**, vinculada al registro, con vencimiento y prioridad según la sugerencia. Si la sugerencia era de otra persona del equipo, la tarea queda a su nombre. Aceptar dos veces, o aceptar la misma sugerencia desde el lead y desde la bandeja, no duplica la tarea. El seguimiento de una visita se crea con el mismo servicio que el botón «Crear tarea de seguimiento» de la visita.
2. **Posponer**: elegí hasta qué fecha (desde mañana, hasta 90 días). La sugerencia vuelve ese día a las 8:00.
3. **Descartar**: podés dejar un motivo (opcional). No vuelve a sugerirse mientras la situación no cambie.

Todo queda registrado en la auditoría. Nada se envía a clientes: las sugerencias solo ayudan a decidir.

## Por qué no veo una sugerencia
<!-- ruta: /crm/tareas-sugeridas; permisos: tasks.manage, tasks.read_all -->

- Ya se resolvió: si la situación desaparece (por ejemplo, se confirmó el informe de la visita), la sugerencia se cierra sola.
- Está pospuesta: mirá la pestaña **Pospuestas**.
- No está en tu alcance: un agente ve solo lo asignado a él y, en ventas, solo clientes que puede ver. Si reasignan un lead, la sugerencia deja de verse al instante.
- Tu rol no incluye ese módulo (por ejemplo, las alertas del centro operativo son para quien monitorea visitas y las asignaciones, para quien asigna leads).
- La función está apagada: un administrador puede revisar el flag `ai_task_center` en Integraciones.
