---
dominio: visits
titulo: IA de visitas: brief, informe asistido y seguimiento
resumen: Brief «Antes de la visita» con lo NO REGISTRADO, propuesta de campos del informe, variante del agradecimiento y seguimiento sugerido.
permisos: visits.operate, visits.monitor
---

## Brief «Antes de la visita»
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate, visits.monitor -->

En el detalle de una visita programada aparece **Antes de la visita** con los datos registrados en el CRM, separados en **Cliente**, **Qué busca** (consulta, oportunidad, presupuesto y notas), **Qué preguntó** (consultas web y mensajes recientes del contacto) y **Propiedad** (precio, ambientes, superficies, características, tour).

Se prepara solo al crear o reasignar la visita y se actualiza unas 2 horas antes. Con **Actualizar** lo rehacés en el momento. Se activa con el flag `ai_visit_brief`.

Si la IA está configurada, se suma un **Resumen de la IA** que cita los datos de arriba y **Sugerencias de la IA** rotuladas como interpretación (no son datos). Si la IA menciona una cifra que no está en los datos, se descarta y queda el brief sin IA.

## Qué significa «No registrado» en el brief de la visita
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate, visits.monitor -->

El recuadro **No registrado** lista datos que el cliente suele preguntar y que la ficha no tiene: gastos o expensas, escritura (si no hay documento cargado), orientación, antigüedad, estado de conservación, apta crédito, mascotas, superficie, cocheras y servicios. Si te lo preguntan, no lo afirmes: consultalo y respondé después. Completarlo en la ficha lo saca de la lista.

## Proponer los campos del informe con IA
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate -->

Con la visita finalizada, escribí o dictá cómo fue en **¿Cómo fue la visita?**. Si la IA está configurada (flag `ai_followup`), tocá **Proponer campos con IA**: aparece una propuesta con interés, aspectos positivos, objeciones, siguiente paso y fecha de seguimiento. **Revisá y confirmá**: con **Usar estos campos** se copian al formulario, y nada se guarda hasta que confirmás el informe. Sin IA, el botón no aparece y el informe se completa a mano como siempre.

## Redactar una variante del agradecimiento con IA
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate -->

En **Agradecimiento**, con la IA configurada, **Redactar una variante con IA** propone un mensaje breve con el nombre del cliente, el tuyo, la propiedad y los aspectos positivos del informe confirmado. Se carga en el cuadro para que lo edites; se guarda y se envía como siempre (nada se envía solo). Si la variante incluye cifras o promesas que no constan, se descarta y te pide usar la plantilla.

## Seguimiento sugerido después de la visita
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate -->

Con el informe confirmado, **Seguimiento** muestra una **Sugerencia** con fecha, título y motivo: interés alto a 24 horas, medio a 2 días, bajo a una semana (o la fecha que pusiste en el informe), el siguiente paso («Coordinar segunda visita», «Seguimiento de oferta»…) y si hubo objeción de precio. Podés cambiar la fecha y el título. La tarea se crea **solo** cuando tocás **Crear tarea de seguimiento**.

## Brief en el centro operativo
<!-- ruta: /crm/centro-operativo; permisos: visits.monitor -->

En el tablero del centro operativo, la columna **Brief / cierre** muestra «Brief listo» y cuántos datos no registrados tiene cada visita que todavía no terminó. Tocalo para abrir la visita.
