---
dominio: operations
titulo: Centro de comando, preguntas de dirección y anomalías
resumen: Vista de dirección que junta los módulos, preguntas al Asistente IA con hechos definidos y la detección de anomalías con evidencia.
permisos: ai.executive
---

## Usar el Centro de comando
<!-- ruta: /crm/centro-de-comando; permisos: ai.executive -->

El **Centro de comando** (menú Operación) junta en una sola pantalla lo más importante de cada módulo, con links para actuar: Resumen de hoy del equipo, Tareas sugeridas por origen, alertas y anomalías con su evidencia, visitas de hoy por etapa, propiedades con clientes compatibles nuevos, seguimientos vencidos por agente, calidad de las publicaciones y salud de la IA (pedidos, errores, respaldo, costo y automatizaciones de IA).

No es otro tablero: cada bloque sale del módulo original (Centro operativo, Tareas, Propiedades, Uso de IA) y el link te lleva ahí. Lo ven dirección y administración. Un agente no tiene acceso.

## Hacer preguntas de dirección al Asistente IA
<!-- ruta: /crm; permisos: ai.executive -->

Abrí **✦ Asistente IA** (Ctrl + I), modo **Analista**. Con permiso de dirección aparecen cuatro consultas rápidas: **¿Cómo estuvo la semana?**, **Leads del mes**, **Seguimientos atrasados** y **Cuellos de botella**. También podés escribir preguntas como «tiempo a primer contacto», «conversión de leads» o «propiedades con más interés».

Cada respuesta muestra **Hechos**: la cifra, su **definición** (qué se cuenta exactamente), el **período** y con qué se compara, y el **origen** (link a la pantalla). Con menos de 5 casos no se muestran porcentajes y con menos de 3 no se calculan medianas: se aclara «muestra chica». Las métricas son de toda la organización.

Sin la clave de IA ves los reportes directos. Con la clave, el asistente además redacta un resumen y una **Interpretación de la IA (no son datos)**; si menciona una cifra que no está en los hechos, se descarta y quedan los datos. La IA no afirma causas.

## Entender las anomalías detectadas
<!-- ruta: /crm/centro-de-comando; permisos: ai.executive, tasks.manage, tasks.read_all -->

Cada hora el CRM revisa situaciones fuera de lo normal con reglas y umbrales fijos. Cada anomalía trae evidencia (los números que la explican) y severidad:

- **Lead sin contactar**: consulta abierta sin primer contacto hace más de 24 h (crítica desde 72 h). Se avisa al agente asignado.
- **Visita finalizada sin seguimiento**: más de 48 h sin tarea de seguimiento.
- **Caída de consultas de una propiedad**: compara la propiedad con su propio historial. Solo se evalúa si está publicada hace más de 10 semanas, tuvo al menos 8 consultas en las 8 semanas anteriores y la caída es fuerte (25 % o menos de lo esperable) y poco probable por azar. No indica la causa.
- **Datos contradictorios**: inconsistencias que ya detecta el informe de calidad (por ejemplo, superficie cubierta mayor que la total).
- **Picos de fallas**: tareas automáticas muertas o errores de la IA muy por encima de lo habitual.

Se resuelven solas cuando la situación desaparece. Los avisos se mandan una sola vez por anomalía y con un máximo diario por persona, para no llenar de notificaciones. Un agente ve solo las suyas; dirección, las de toda la organización.
