---
dominio: leads
titulo: Contactos, leads, pipeline y conversaciones
resumen: Cómo gestionar contactos y duplicados, la bandeja de leads, el pipeline de oportunidades, las conversaciones de WhatsApp y las notas.
permisos: contacts.read, leads.read_own, leads.read_all, opportunities.read_own, opportunities.read_all, conversations.read
---

## Buscar un contacto
<!-- ruta: /crm/contactos; permisos: contacts.read -->

La lista de contactos (clientes, propietarios, inquilinos, garantes, proveedores) está en **Contactos** (`/crm/contactos`). Arriba tenés un buscador y filtros:

1. En el campo de búsqueda escribí nombre, email o teléfono.
2. Opcionalmente elegí un **Rol** («Todos los roles», Propietario, Comprador, Interesado, Inquilino, Garante, Proveedor, Otro), una **Etiqueta** y un **Responsable** («Cualquier responsable», «Míos», «Sin responsable» o una persona del equipo).
3. Tocá **Buscar**. Para volver a la lista completa, tocá **Limpiar**.

Cada fila muestra nombre, roles, etiquetas, teléfono y email principales, el responsable («Resp.: …» o «Sin responsable») y la fecha de última actualización. Tocá la fila para abrir la ficha del contacto, donde están los datos, las acciones rápidas (**Llamar**, **WhatsApp**, **Agendar**, **Nueva oportunidad**, **Nueva tarea**), las notas y el **Historial** con leads, oportunidades, citas y actividades vinculadas.

Los botones **Llamar** y **WhatsApp** abren tu teléfono o WhatsApp y dejan registrada la actividad en el historial; el CRM no hace la llamada ni envía el mensaje por vos.

## Crear un contacto nuevo
<!-- ruta: /crm/contactos/nuevo; permisos: contacts.create -->

Para dar de alta a una persona o empresa (cliente, propietario, inquilino, etc.):

1. Entrá a **Contactos** y tocá **Nuevo contacto**.
2. En **Tipo** elegí **Persona** o **Empresa**. Para persona completá **Nombre** y **Apellido** (al menos uno); para empresa, **Razón social**.
3. Cargá **Email** y **Teléfono** (con código de área, por ejemplo 387 y el número). Dejá tildado **Tiene WhatsApp** si corresponde.
4. Marcá los **Roles** (Propietario, Comprador, Interesado, Inquilino, Garante, Proveedor, Otro) y escribí las **Etiquetas** separadas por coma.
5. Elegí el **Responsable** o dejá «Sin responsable».
6. Si tenés permiso para datos privados, podés cargar **Documento** (DNI, CUIT, CUIL, Pasaporte, Otro) y **Número**: tipo y número van juntos.
7. Tocá **Crear contacto**.

Si el email o el teléfono ya existe en otro contacto, el alta se hace igual y el par queda marcado para revisar en duplicados: nada se fusiona solo. No puede haber dos contactos con el mismo documento. En el alta se permite un solo email y un solo teléfono; el resto se agrega desde la ficha.

## Editar los datos de un contacto
<!-- ruta: /crm/contactos/[id]/editar; permisos: contacts.update -->

Para corregir el nombre, cambiar el tipo o reasignar el responsable de un contacto:

1. Abrí la ficha del contacto desde **Contactos**.
2. Tocá **Editar** (arriba a la derecha).
3. Cambiá **Tipo** (Persona o Empresa), **Nombre**, **Apellido**, **Razón social** o **Empresa (opcional)** y el **Responsable**.
4. Si tenés el permiso de datos privados, también ves y podés corregir **Documento** y **Número**.
5. Tocá **Guardar cambios**.

Desde esta pantalla **no** se editan emails, teléfonos, roles ni etiquetas: eso se hace directamente en la ficha (secciones «Datos de contacto» y «Roles y etiquetas»). El nombre no puede quedar vacío: una persona necesita nombre o apellido y una empresa, razón social. Cada cambio queda en la auditoría; el número de documento se registra como «[privado]», nunca en claro.

Si el contacto fue fusionado con otro, al abrirlo el CRM te lleva automáticamente al contacto que se conservó. Hoy el CRM no permite borrar un contacto desde la ficha.

## Agregar o quitar teléfonos y emails de un contacto
<!-- ruta: /crm/contactos/[id]; permisos: contacts.update -->

Un contacto puede tener varios teléfonos y emails. En la ficha, tarjeta **Datos de contacto**:

1. Para sumar un teléfono tocá **Agregar teléfono**, escribí el **Teléfono** con código de área, opcionalmente una **Etiqueta (opcional)** (trabajo, casa…), dejá o sacá **Tiene WhatsApp** y tocá **Agregar**.
2. Para sumar un email tocá **Agregar email**, escribilo y tocá **Agregar**.
3. Para sacar uno, tocá **Quitar** al lado y confirmá.

El primero que se carga queda como **Principal**; si quitás el principal, pasa a serlo el más antiguo que quede. No se puede cargar dos veces el mismo teléfono o email en el mismo contacto. Si el dato nuevo coincide con otro contacto, aparece el aviso «Coincide con … Quedó para revisar en duplicados; no se fusionó».

Los teléfonos marcados con WhatsApp muestran **Abrir WhatsApp**. Los datos de contacto que llegan desde la web o portales sobre un contacto ya existente no se agregan solos a la ficha: quedan en el lead como datos sin verificar para que una persona los revise.

## Cambiar roles y etiquetas de un contacto
<!-- ruta: /crm/contactos/[id]; permisos: contacts.update -->

Los roles indican qué es el contacto para la inmobiliaria y las etiquetas sirven para agrupar y filtrar (por ejemplo, inversores o una zona).

1. Abrí la ficha del contacto.
2. En la tarjeta **Roles y etiquetas** tocá **Editar**.
3. Tildá o destildá los roles: Propietario, Comprador, Interesado, Inquilino, Garante, Proveedor, Otro.
4. En **Etiquetas** escribí los nombres separados por coma. Hay un máximo de 20 etiquetas y 60 caracteres por etiqueta.
5. Tocá **Guardar**.

Las etiquetas nuevas se crean al guardar. Tocando una etiqueta en la ficha vas a la lista de contactos filtrada por esa etiqueta. Algunos roles también se asignan solos: cuando entra una consulta, el contacto queda como Interesado, Inquilino (si busca alquiler) o Propietario (si pide tasación o vender su propiedad, salvo que la consulta llegue sin verificar sobre un contacto que ya existía).

## Ver el documento y datos privados de un contacto
<!-- ruta: /crm/contactos/[id]; permisos: contacts.read_private -->

El documento de identidad (DNI, CUIT, CUIL, pasaporte) es un dato sensible. Solo lo ven y lo editan quienes tienen el permiso `contacts.read_private` (por defecto dirección, administración y el rol de alquileres).

- Con el permiso, en la ficha del contacto el campo **Documento** muestra tipo y número, y en **Nuevo contacto** y **Editar** aparecen los campos **Documento** y **Número** («Dato sensible: solo lo ve quien tiene permiso»).
- Sin el permiso, la ficha muestra «Cargado (sin permiso para verlo)» si el contacto tiene documento, o «—» si no. Tampoco podés cargarlo ni cambiarlo: el servidor rechaza el intento.

El número se guarda sin puntos, espacios ni guiones. No puede haber dos contactos con el mismo documento: si pasa, el CRM avisa «Ya existe un contacto con ese documento». En la auditoría, el cambio de documento queda registrado sin mostrar el número. Si necesitás ver el documento y no tenés el permiso, pedíselo a quien administra los usuarios.

## Revisar y fusionar contactos duplicados
<!-- ruta: /crm/contactos/duplicados; permisos: contacts.merge -->

Cuando una carga coincide por email o teléfono con otro contacto, el CRM no los une solo: crea un posible duplicado para que una persona decida.

1. En **Contactos** tocá **Duplicados** (muestra entre paréntesis cuántos hay abiertos). También podés tocar **Revisar** en el aviso amarillo de la ficha de un contacto.
2. En **Posibles duplicados** elegí un par. Cada uno indica el motivo: Mismo email, Mismo teléfono, Nombre y teléfono parecidos o Mismo documento.
3. Compará **Contacto A** y **Contacto B**: teléfonos, emails, roles, documento, alta y lo vinculado (leads, oportunidades, citas, propiedades, notas).
4. Si son la misma persona, tocá **Conservar este y fusionar** en el que querés mantener y confirmá. Si no lo son, tocá **No son la misma persona**.

Al fusionar pasan al contacto conservado leads, oportunidades, citas, conversaciones, notas, tareas, emails, teléfonos, roles, etiquetas, propiedades, contratos de alquiler, liquidaciones e informes. El otro queda marcado como fusionado (no se borra) y la operación queda auditada. **No se puede deshacer desde el CRM.** Solo lo pueden hacer quienes tienen `contacts.merge`; sin ese permiso, el aviso de la ficha dice «Avisá a administración».

## Ver la bandeja de leads y filtrarla
<!-- ruta: /crm/leads; permisos: leads.read_own, leads.read_all -->

Los leads (consultas o prospectos) de la web, WhatsApp, portales, redes y cargas manuales están en **Leads** (`/crm/leads`).

- Con `leads.read_all` ves todos; con `leads.read_own` solo los asignados a vos (el encabezado dice «asignados a vos»). Un lead ajeno fuera de tu alcance aparece como inexistente.
- Abrí **Filtros** para buscar por **Nombre**, **Estado** (incluye «Abiertos (nuevo, contactado, calificado)»), **Fuente**, **Prioridad**, **Asignado** (solo si ves todos: «A mí», «Sin asignar» o una persona), **Código de propiedad**, **Desde** y **Hasta**. Tildá **Solo sin responder** para ver los que no tienen primer contacto. Tocá **Aplicar**, o **Limpiar** para sacar los filtros.

Cada fila muestra el contacto, el estado, la prioridad si no es normal, el mensaje, la fuente, qué busca, el código de propiedad, a quién está asignado y la fecha. Los leads abiertos sin primer contacto muestran en rojo «Sin responder · …» con el tiempo de espera. Tocá la fila para abrir el detalle del lead.

## Cargar un lead que llegó por teléfono u oficina
<!-- ruta: /crm/leads/nuevo; permisos: leads.create -->

Las consultas de la web, WhatsApp y portales entran solas. Las que llegan por llamada o en persona se cargan a mano:

1. En **Leads** tocá **Nuevo lead**.
2. Completá **Nombre y apellido** y al menos un **Teléfono** (con código de área, con **Tiene WhatsApp** si aplica) o un **Email**.
3. En **Cómo llegó** elegí «Llamada telefónica», «Se acercó a la oficina» u «Otra vía (carga manual)».
4. En **Busca** elegí Compra, Alquiler, Alquiler temporario, Tasación, Vender su propiedad u Otro.
5. Opcionalmente buscá la **Propiedad consultada (opcional)** por código, título o dirección, y escribí **Qué consultó**.
6. Elegí la **Prioridad** (Baja, Normal, Alta, Urgente) y, si podés asignar, **Asignar a**. Si no tenés permiso de asignar, el lead «Queda asignado a vos».
7. Tocá **Crear lead**.

Si el teléfono o email ya existe, se usa el mismo contacto en lugar de crear otro. Si no elegís a quién asignar y la consulta tiene propiedad, se asigna al agente responsable de esa propiedad.

## Asignar un lead y cambiar su estado o prioridad
<!-- ruta: /crm/leads/[id]; permisos: leads.assign, leads.update -->

En el detalle del lead, la tarjeta **Gestión** tiene tres controles:

1. **Estado**: elegí Nuevo, Contactado, Calificado, No califica o Descartado y tocá **Guardar**. «Convertido» no se elige a mano: se pone solo al convertir el lead en oportunidad, y desde ese momento el estado ya no se puede cambiar.
2. **Prioridad**: Baja, Normal, Alta o Urgente, y **Guardar**.
3. **Asignado a**: elegí la persona del equipo o «Sin asignar» y tocá **Asignar**. Solo aparece con el permiso `leads.assign`; sin él ves a quién está asignado.

Cambiar el estado y la prioridad requiere `leads.update`. Pasar el lead a **Contactado** también registra el primer contacto si todavía no estaba registrado. Al asignar un lead a otra persona, esa persona recibe la notificación «Te asignaron un lead». Solo se puede asignar a usuarios activos del equipo. Todos los cambios quedan en la auditoría.

## Registrar el primer contacto y cumplir el SLA de respuesta
<!-- ruta: /crm/leads/[id]; permisos: leads.update -->

El SLA de primera respuesta mide cuánto tarda el equipo en contactar un lead nuevo. Por defecto son 120 minutos (setting `leads.first_response_sla_minutes`).

1. Abrí el lead. En la tarjeta **Contactar** usá **Llamar** o **WhatsApp** (abren tu teléfono y registran la actividad).
2. Después tocá **Registrar primer contacto**, elegí el **Medio** (Llamada, WhatsApp, Email, En persona, Otro), agregá un **Comentario (opcional)** y tocá **Registrar**.

El primer contacto se registra una sola vez: el botón desaparece y la tarjeta muestra «Primer contacto: fecha y hora». Si el lead estaba en Nuevo pasa a Contactado. También cuenta como primer contacto pasar el estado a Contactado o responder desde una conversación de WhatsApp vinculada al lead. Tocar solo **Llamar** o **WhatsApp** no lo registra.

En el tablero (`/crm`), el bloque **Leads** (o **Mis leads**) muestra «Nuevos en el período», «Sin responder», «Fuera de SLA (… min)» y, si ves todos, «Sin asignar».

## Revisar datos de contacto sin verificar de una consulta web
<!-- ruta: /crm/leads/[id]; permisos: leads.read_own, leads.read_all -->

Cuando una consulta llega por un canal no verificado (formulario web, portales, un email escrito en un chat) y coincide con un contacto que ya existe, el email o teléfono nuevo **no** se agrega a la ficha: podría ser de otra persona y después se usaría para invitaciones y recordatorios.

En ese caso el lead muestra el aviso **Datos de contacto enviados sin verificar**, con el **Email enviado** y/o **Teléfono enviado**, y en el historial del contacto queda la actividad «Consulta con datos de contacto sin verificar».

Qué hacer:

1. Confirmá con la persona (por el teléfono que ya está en la ficha, por ejemplo) que el dato es suyo.
2. Si lo es, abrí el contacto con **Ver contacto** y agregalo con **Agregar email** o **Agregar teléfono** (requiere `contacts.update`).
3. Si no lo es, no lo uses; si sospechás que son dos personas distintas, revisá la sección de duplicados.

La excepción es el número de WhatsApp de un mensaje entrante: lo verifica Meta y sí se agrega a la ficha.

## Convertir un lead en oportunidad
<!-- ruta: /crm/leads/[id]; permisos: opportunities.update -->

Cuando un lead avanza (quiere visitar, negociar o tasar), convertilo en oportunidad para seguirlo en el pipeline.

1. Abrí el lead desde **Leads**.
2. En la tarjeta **Contactar** tocá **Convertir en oportunidad**.
3. Elegí el **Pipeline**. Viene sugerido según lo que busca: Compra va a Ventas, Alquiler y Alquiler temporario a Alquileres, Tasación y Vender su propiedad a Captación y tasaciones.
4. Tocá **Crear oportunidad**.

La oportunidad toma el contacto, la propiedad y el responsable del lead, arranca en la primera etapa abierta del pipeline y el lead pasa a **Convertido**. Te lleva directo a la ficha de la oportunidad. Necesitás `leads.update` y `opportunities.update`. El botón no aparece si el lead está **Descartado**. Si el lead ya tiene oportunidad, en su lugar ves el botón **Oportunidad (estado)** para abrirla: cada lead genera una sola oportunidad.

## Crear una oportunidad desde un contacto
<!-- ruta: /crm/pipeline/nueva; permisos: opportunities.update -->

Si no hay un lead previo (por ejemplo, un cliente de la cartera), creá la oportunidad directamente:

1. Entrá a **Pipeline** y tocá **Nueva oportunidad**, o desde la ficha de un contacto tocá **Nueva oportunidad** (viene con el contacto cargado).
2. Buscá el **Contacto** por nombre, email o teléfono.
3. Elegí el **Pipeline** (Ventas por defecto).
4. Opcionalmente escribí un **Título (opcional)**; si lo dejás vacío se arma con el contacto y la propiedad.
5. Buscá la **Propiedad (opcional)**, cargá **Moneda** (USD o ARS), **Presupuesto desde** y **Hasta**, **Zonas**, **Dormitorios mín.** y **Qué busca**.
6. Si podés asignar, elegí el **Responsable** («Yo» por defecto).
7. Tocá **Crear oportunidad**.

Sin el permiso `opportunities.assign` la oportunidad queda a tu nombre. Para convertir un lead existente, usá **Convertir en oportunidad** desde su ficha, así no se duplica.

## Mover una oportunidad de etapa en el pipeline
<!-- ruta: /crm/pipeline; permisos: opportunities.update -->

El pipeline (`/crm/pipeline`) es un tablero kanban por etapas. Arriba elegís el pipeline: Ventas, Alquileres o Captación y tasaciones. Si ves todas las oportunidades, podés filtrar por **Agente** y tocar **Filtrar**.

Tres formas de mover una oportunidad:

1. **Arrastrar y soltar** la tarjeta en otra columna.
2. En la tarjeta, elegir la etapa en el menú desplegable y tocar **Mover** (sirve en celular y con teclado).
3. En la ficha de la oportunidad, tarjeta **Etapa**: elegir **Mover a etapa**, agregar un **Comentario (opcional)** y tocar **Mover**.

Si la llevás a una etapa de pérdida, se pide el **Motivo de la pérdida** y se confirma con **Marcar perdida**. Cada tarjeta muestra responsable y días en la etapa. Las oportunidades cerradas se siguen viendo 30 días en el tablero. Cada cambio queda en el **Historial de etapas** con fecha, persona y comentario. Al agendar o completar una visita vinculada, la oportunidad avanza sola a «Visita programada» o «Visita realizada» si estaba en una etapa anterior.

## Marcar una oportunidad como ganada, perdida o pausada
<!-- ruta: /crm/pipeline/[id]; permisos: opportunities.update -->

En la ficha de la oportunidad, tarjeta **Etapa**, están los botones de cierre:

1. **Ganada**: cargá **Moneda** y **Valor de cierre (opcional)**, un **Comentario (opcional)** y tocá **Confirmar**. La oportunidad pasa a la etapa ganada del pipeline (Cerrado, Contrato firmado o Autorización firmada, según el pipeline).
2. **Perdida**: escribí el **Motivo (obligatorio)** y tocá **Marcar perdida**. El motivo queda visible en el detalle.
3. **Pausar** (solo si está abierta): escribí **Motivo o fecha de retome (opcional)** y tocá **Pausar**.

Para reabrir una oportunidad cerrada o pausada, movela a una etapa abierta con **Mover a etapa**: vuelve a estado Abierta.

Para editar los datos usá **Editar** (arriba): **Título**, **Operación**, **Propiedad**, presupuesto, **Cierre estimado**, zonas y requisitos, y **Guardar**. Para cambiar quién la lleva, en la tarjeta **Responsable** elegí la persona y tocá **Asignar** (requiere `opportunities.assign`); la persona recibe la notificación «Te asignaron una oportunidad».

## Atender la bandeja de conversaciones de WhatsApp
<!-- ruta: /crm/conversaciones; permisos: conversations.read -->

En **Conversaciones** (`/crm/conversaciones`) están los chats de WhatsApp Business de la inmobiliaria. La pantalla se actualiza sola cada 30 segundos.

- Pestañas: **Abiertas** (las que atiende el asistente o una persona), **Asistente**, **Persona** y **Cerradas**.
- Botones de filtro: **Asignadas a mí** y **Sin responder** (el último mensaje es del cliente).
- Buscador por nombre o teléfono y botón **Buscar**. **Ver anteriores** carga más.

Cada conversación muestra nombre o número, la etiqueta «Sin responder», el modo (Asistente, Persona, Cerrada), el último mensaje, el estado de envío, a quién está asignada y, si fue derivada, el motivo.

Con `leads.read_all` ves todas. Sin ese permiso ves solo las asignadas a vos, las que todavía atiende el asistente sin asignar, y las vinculadas a un lead o contacto tuyo. Arriba aparecen avisos si WhatsApp no tiene credenciales («Las respuestas quedan registradas pero no se envían»), si el envío real está desactivado o si el asistente de IA está apagado. Hoy el CRM no permite iniciar una conversación nueva de WhatsApp: se crean cuando el cliente escribe.

## Tomar una conversación y responder por WhatsApp
<!-- ruta: /crm/conversaciones/[id]; permisos: conversations.reply -->

1. Abrí la conversación desde **Conversaciones**.
2. Tocá **Tomar conversación** (o **Reabrir y tomar** si estaba cerrada). Queda en modo Persona, asignada a vos, y el asistente deja de contestar.
3. Escribí en **Responder por WhatsApp** (hasta 4096 caracteres) y tocá **Enviar**. Si respondés sin tomarla, la conversación pasa a modo Persona igual (queda asignada a vos si no tenía responsable).
4. El mensaje queda «En cola» y su estado se actualiza: Enviando, Enviado, Entregado, Leído, Falló o «Sin credenciales: no enviado».

Otras acciones en el encabezado:

- **Devolver al asistente**: vuelve al modo Asistente.
- **Cerrar**: la pasa a Cerradas; para escribir de nuevo hay que tomarla.
- **Reintentar envío** en un mensaje fallido. Si el resultado fue incierto aparece **Verifiqué que no llegó: reenviar**: revisá antes en WhatsApp para no duplicar.
- **Enviar plantilla aprobada**: WhatsApp solo deja escribir libremente hasta 24 h después del último mensaje del cliente («Ventana de 24 h»). Con la ventana cerrada, solo se puede mandar esa plantilla, y el botón aparece solo si hay una configurada.

Responder registra el primer contacto del lead vinculado si faltaba. La columna derecha muestra contacto, lead, datos recogidos, resumen del asistente y propiedades mencionadas.

## Cómo funciona el asistente de WhatsApp y cuándo deriva a una persona
<!-- ruta: /crm/conversaciones/[id]; permisos: conversations.read -->

El asistente virtual (IA) responde consultas de WhatsApp solo con datos reales del CRM: busca propiedades publicadas (disponibles o reservadas), da detalles sin inventar precios ni direcciones ocultas y anota lo que busca el cliente en **Datos recogidos** y en el lead. Siempre se presenta como asistente virtual. Si el cliente pide visitar, crea una **tarea** para un asesor: nunca confirma una cita.

Deriva la conversación a una persona (modo Persona) cuando:

- el cliente pide hablar con alguien, negocia u ofrece, quiere reservar o señar, reclama, habla de documentación o muestra intención fuerte de cierre;
- tiene baja confianza, falla dos veces seguidas o su respuesta tenía datos no verificados (se descarta);
- se agotó el presupuesto diario de IA, no hay credenciales o el asistente está apagado;
- llega un audio, foto o archivo, que no puede leer.

Al derivar, el cliente recibe un aviso fijo de que lo va a atender una persona, y se notifica al agente asignado (de la conversación, del lead o del contacto) o a administración, con un resumen. El motivo se ve como «Derivada: …». En modo Persona la IA no responde. Hoy el asistente y el envío real nacen apagados (flags `whatsapp_ai_bot` y `outbound_whatsapp`) y se activan desde Integraciones.

## Agregar una nota a un contacto, lead u oportunidad
<!-- ruta: /crm/contactos/[id]; permisos: contacts.update, leads.update, opportunities.update, agenda.manage -->

Las notas internas registran qué pasó, qué pidió el cliente y los próximos pasos. Solo las ve el equipo. Se pueden agregar en la ficha de un contacto, de un lead (`/crm/leads/[id]`), de una oportunidad (`/crm/pipeline/[id]`) y de una cita de la agenda.

1. Abrí la ficha y bajá a la tarjeta **Notas (cantidad)**.
2. Escribí en **Nueva nota** (hasta 10.000 caracteres).
3. Tocá **Agregar nota**.

La nota aparece arriba de la lista con autor, fecha y hora, y queda en la auditoría. El permiso para escribir depende de la ficha: `contacts.update` en contactos, `leads.update` en leads, `opportunities.update` en oportunidades y `agenda.manage` en citas. Sin ese permiso ves las notas pero no el formulario.

Hoy el CRM no permite editar ni borrar una nota ya guardada. Si fusionás dos contactos duplicados, las notas del contacto fusionado pasan al que se conserva.
