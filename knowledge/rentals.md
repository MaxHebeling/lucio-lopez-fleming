---
dominio: rentals
titulo: Alquileres, cobros, liquidaciones e informes a propietarios
resumen: Cómo cargar y activar contratos de alquiler, registrar y anular cobros, ajustar por índice, liquidar a propietarios, generar informes y gestionar el portal de propietarios.
permisos: rentals.read, reports.read
---

## Ver y buscar contratos de alquiler
<!-- ruta: /crm/alquileres; permisos: rentals.read -->

Los contratos de alquiler (locaciones) administrados están en el menú **Contratos** (`/crm/alquileres`), pantalla «Contratos de alquiler».

1. En **Buscar** escribí código de contrato, propiedad o nombre de una parte (inquilino, locatario, propietario).
2. En **Estado** elegí Borrador, Vigente, Finalizado, Rescindido o Renovado.
3. En **Vencimiento** elegí «Vencen en 60 días» para ver los que terminan pronto.
4. Tocá **Filtrar**, o **Limpiar** para sacar los filtros.

La tabla muestra contrato (con «N vencida(s)» en rojo si hay cuotas atrasadas), propiedad, inquilino/s, estado, vigencia, alquiler vigente y próximo ajuste con su índice. «(para revisar)» indica un ajuste propuesto esperando decisión y «(faltan índices)», que no se pudo calcular. Se muestran hasta 300 contratos.

Tocá el código para abrir la ficha, con las tarjetas **Resumen**, **Partes**, **Cuotas**, **Cobros**, **Ajustes**, **Liquidaciones**, **Documentos** y **Cierre y renovación**. Además, 60 días antes del vencimiento de un contrato vigente el equipo de alquileres recibe el aviso «Contrato por vencer» y se crea la tarea «Gestionar renovación o finalización», si esa automatización está activa.

## Cargar un contrato de alquiler nuevo
<!-- ruta: /crm/alquileres/nuevo; permisos: rentals.manage -->

1. En **Contratos** tocá **Nuevo contrato**.
2. Elegí la **Propiedad** (no aparecen las archivadas). Los propietarios cargados en la propiedad se completan solos.
3. Completá **Propietarios**, **Inquilinos** y **Garantes** (ver la sección sobre partes).
4. Cargá los datos económicos: **Código** (vacío = se genera como ALQ-código de propiedad-AAAAMM), **Inicio** (siempre el día 1 del mes), **Fin**, **Moneda**, **Alquiler inicial**, **Día de vencimiento** (1 a 28), **Honorario administración %**, **Índice de ajuste** y **Ajusta cada**, **Depósito**, **Moneda del depósito**, **Comisión**, **Interés por mora diario %** (informativo) y **Notas internas**.
5. Tocá **Crear contrato (borrador)**.

Reglas que valida el CRM: el fin tiene que ser posterior al inicio; índice y periodicidad van juntos (o ninguno); los índices ICL, CER, IPC y Casa Propia solo ajustan contratos en pesos; no puede repetirse el código.

El contrato queda en **Borrador**: todavía no tiene cuotas. Hoy el CRM no permite editar los datos económicos ni las partes de un borrador desde la ficha: revisalos bien antes de crear. Se genera una cuota por cada mes que empieza antes de la fecha de **Fin** (si el fin es un día 1, la última cuota es la del mes anterior).

## Agregar propietarios, inquilinos y garantes a un contrato
<!-- ruta: /crm/alquileres/nuevo; permisos: rentals.manage -->

En el alta del contrato hay tres bloques de partes: **Propietarios** (locadores), **Inquilinos** (locatarios) y **Garantes** (fiadores).

1. En el bloque, escribí nombre o email en «Buscar por nombre o email» y tocá **Buscar** (mínimo 2 letras).
2. Tocá **Agregar** en el contacto correcto. Así se evita duplicar contactos.
3. Si no existe, tocá **Nuevo contacto**, completá nombre y apellido, email y teléfono, y tocá **Agregar contacto nuevo**. Si el email o teléfono ya existe, se reutiliza ese contacto.
4. Para sacar una parte, tocá **Quitar**.

Reglas:

- tiene que haber al menos un propietario y un inquilino; los garantes son opcionales (hasta 10 por bloque);
- con **varios propietarios**, cargá el **%** de cada uno (condominio): tienen que sumar 100%. Con uno solo se toma 100%;
- no se puede repetir un contacto en el mismo rol.

Al guardar, cada contacto recibe el rol Propietario, Inquilino o Garante. Crear contactos nuevos requiere además `contacts.create`. Las partes se ven después en la tarjeta **Partes** de la ficha, con email, teléfono, porcentaje y el estado de acceso al portal de cada propietario. Hoy el CRM no permite cambiar las partes de un contrato ya creado.

## Activar un contrato y generar las cuotas
<!-- ruta: /crm/alquileres/[id]; permisos: rentals.manage -->

Un contrato en **Borrador** no genera cuotas ni admite cobros ni liquidaciones. Para ponerlo en marcha:

1. Abrí la ficha del contrato.
2. Tocá **Activar contrato** (arriba a la derecha).
3. Confirmá: «¿Activar el contrato? Se generan las cuotas y la propiedad pasa a alquilada».

Al activar:

- el contrato pasa a **Vigente**;
- se generan todas las cuotas mensuales, una por cada mes desde el inicio hasta antes de la fecha de fin, con el día de vencimiento del contrato;
- si la propiedad estaba Disponible o Reservada, pasa sola a **Alquilada** y el sitio web se actualiza;
- si es una renovación, el contrato anterior pasa a **Renovado**.

El CRM no deja activar si falta propietario o inquilino, o si la propiedad ya tiene otro contrato vigente superpuesto en esas fechas («La propiedad ya tiene el contrato vigente … en esas fechas»). El mensaje final informa cuántas cuotas se generaron. Un proceso diario verifica que todo contrato vigente tenga sus cuotas y marca como **Vencida** cada cuota impaga cuyo vencimiento pasó.

## Subir documentos de un contrato y compartirlos con el propietario
<!-- ruta: /crm/alquileres/[id]; permisos: rentals.manage -->

En la ficha del contrato, tarjeta **Documentos**, se guardan el contrato firmado, addendas, garantías, inventarios y comprobantes.

1. Completá **Título** (mínimo 2 caracteres).
2. Elegí el **Tipo**: Contrato, Addenda, Garantía, Inventario, Comprobante u Otro.
3. En **Archivo (PDF o imagen, hasta 4 MB)** elegí el archivo: PDF, JPG, PNG o WebP.
4. Tildá **Visible para propietarios** si el propietario lo tiene que ver en su portal.
5. Tocá **Subir**. Aparece «Documento subido».

Cada documento muestra tipo, tamaño, fecha y la etiqueta «Visible para propietarios» o «Solo equipo». Tocá el título para descargarlo. Con los botones de la fila podés:

- **Mostrar al propietario** u **Ocultar**, para cambiar la visibilidad en el portal;
- **Eliminar**, con confirmación.

Los documentos son privados: sin la marca de visibilidad solo los ve el equipo con `rentals.read`. Los inquilinos y garantes no tienen acceso a un portal. Si el archivo supera 4 MB o tiene otro formato, el CRM muestra el error arriba de la tarjeta.

## Registrar un cobro de alquiler
<!-- ruta: /crm/alquileres/[id]; permisos: rentals.register_payment -->

Para registrar lo que pagó el inquilino por una cuota (pago del alquiler), desde la ficha del contrato o desde **Cobros**:

1. En la tarjeta **Cuotas**, en la fila del mes, desplegá **Cobrar (saldo …)**. En **Cobros** (`/crm/alquileres/cobros`) es **Registrar cobro**.
2. **Monto**: viene con el saldo pendiente; cambialo si es un pago parcial.
3. **Fecha**: el día del pago (no puede ser futura).
4. **Medio**: Transferencia, Efectivo, Depósito, Cheque u Otro.
5. **Referencia**: opcional (número de operación, recibo).
6. Tocá **Registrar cobro**. Aparece «Cobro registrado.».

La cuota pasa a **Pagada** o **Pago parcial**. Para otro pago de la misma cuota tocá **Registrar otro cobro**. El monto no puede superar el saldo pendiente, ni se cobran cuotas pagadas o anuladas, ni contratos en borrador. Un doble clic o reenvío no duplica el cobro («Este cobro ya estaba registrado (envío repetido): no se duplicó.»).

El cobro queda en la tarjeta **Cobros** con fecha, período, monto, medio y quién lo registró. Los cobros nunca se borran: solo se anulan. Hoy el CRM no emite recibos al inquilino.

## Ver cuotas pendientes y vencidas de todos los contratos
<!-- ruta: /crm/alquileres/cobros; permisos: rentals.read -->

La pantalla **Cobros** (`/crm/alquileres/cobros`) junta las cuotas por cobrar de todos los contratos (no incluye borradores). Arriba muestra el saldo total de la vista por moneda.

1. Elegí la vista: **Pendientes (40 días)** (cuotas abiertas que vencen en los próximos 40 días, más las atrasadas), **Vencidas** o **Vencen en 10 días**.
2. Para filtrar, escribí en **Buscar** el contrato o la propiedad y tocá **Buscar**.

Cada tarjeta muestra contrato y mes, propiedad e inquilinos, saldo, monto total, fecha de vencimiento y estado (Pendiente, Pago parcial, Vencida). Las vencidas tienen borde rojo. Tocá el código del contrato para ir a la ficha. Con el permiso `rentals.register_payment` podés desplegar **Registrar cobro** directamente en cada cuota.

En la ficha del contrato, si hay atrasos aparece el aviso «N cuota(s) vencida(s) · saldo vencido …». Recordatorio al inquilino: la automatización «Recordatorio de vencimiento al inquilino» encola un aviso por email o WhatsApp unos días antes del vencimiento (3 por defecto, setting `rentals.due_reminder_days`). Sale solo si esa automatización está activa y la mensajería tiene credenciales.

## Anular un cobro registrado por error
<!-- ruta: /crm/alquileres/[id]; permisos: rentals.void_payment -->

Si un cobro se cargó mal (monto, cuota o fecha equivocados), no se borra: se anula con motivo.

1. Abrí la ficha del contrato y bajá a la tarjeta **Cobros**.
2. En la fila del cobro, desplegá **Anular**.
3. Escribí el **Motivo** (mínimo 3 caracteres).
4. Tocá **Anular cobro** y confirmá: «¿Anular este cobro? Queda registrado y no se puede deshacer».

El cobro queda tachado con «Anulado: motivo», y el saldo de la cuota vuelve a abrirse (Pendiente, Pago parcial o Vencida según corresponda). Después cargá el cobro correcto con **Cobrar**.

Si el cobro ya está incluido en una liquidación activa, el CRM no deja anularlo: «El pago está incluido en una liquidación. Cancelá primero la liquidación.» Cancelala desde la tarjeta **Liquidaciones** y después anulá el cobro.

Anular es una operación sensible con permiso propio, `rentals.void_payment`: por defecto solo lo tienen dirección y super administrador (ni administración ni el rol de alquileres). Sin el permiso, el cobro muestra «Vigente». Todo queda en la auditoría.

## Cargar y actualizar los índices de ajuste (ICL, CER, IPC, Casa Propia)
<!-- ruta: /crm/alquileres/indices; permisos: rentals.adjust -->

La pantalla **Índices** (`/crm/alquileres/indices`) muestra el último valor de cada índice y cómo se cargó.

- **ICL y CER** se descargan todos los días de la API pública del BCRA (flag `rent_index_fetch`, encendido por defecto). La tarjeta **Descarga desde el BCRA** muestra el estado, la última respuesta correcta, el último error y las fallas seguidas. Para forzar la descarga, tocá **Actualizar ahora**.
- **IPC y Casa Propia** se cargan a mano en **Carga manual (IPC / Casa Propia)**:
  1. Elegí el **Índice**: IPC (INDEC) o Casa Propia.
  2. Elegí el **Mes** (no puede ser un mes que todavía no empezó).
  3. Escribí la **Variación mensual %** tal como se publica (por ejemplo 2.1).
  4. Tocá **Guardar valor**.

Verificá el dato contra la publicación oficial antes de guardarlo. Si el mes ya tenía valor, se corrige y queda auditado con el valor anterior. La tabla de abajo lista los valores cargados y quién los cargó. Ver la pantalla requiere `rentals.read`; cargar valores o actualizar, `rentals.adjust`.

Cuando entran valores nuevos del BCRA, el CRM reintenta solo los ajustes que estaban esperando índices.

## Calcular y aplicar un ajuste de alquiler por índice
<!-- ruta: /crm/alquileres/[id]; permisos: rentals.adjust -->

El CRM nunca cambia el alquiler solo: calcula y **propone**, y una persona aplica. En los días previos a cada fecha de ajuste, la automatización «Propuesta de ajuste de alquiler» calcula el ajuste y avisa al equipo de alquileres. También podés hacerlo a mano:

1. Abrí la ficha del contrato (tiene que estar **Vigente** y tener índice).
2. En la tarjeta **Ajustes** tocá **Calcular ajuste del (fecha)**.
3. Revisá el ajuste propuesto: monto anterior → nuevo, índice, factor, valores usados al inicio del período y a la fecha de ajuste (o las variaciones mensuales).
4. Tocá **Aplicar ajuste** y confirmá.

Al aplicar, el **Alquiler vigente** pasa al monto nuevo, las cuotas impagas desde la fecha de ajuste se actualizan («Cuotas actualizadas: N») y se calcula el próximo ajuste. Las cuotas ya pagadas no cambian. El redondeo es a centavos.

Si faltan valores del índice, no se calcula nada y aparece «No se calculó: faltan …» y un aviso en la ficha: cargalos en **Índices** o esperá la descarga del BCRA. Si el alquiler cambió después de calcular, el CRM pide rechazar y recalcular.

## Rechazar un ajuste de alquiler propuesto
<!-- ruta: /crm/alquileres/[id]; permisos: rentals.adjust -->

Si el ajuste propuesto no corresponde (por ejemplo, se acordó con el inquilino no aumentar, o hay que revisar los valores):

1. Abrí la ficha del contrato. Arriba aparece «Hay un ajuste propuesto esperando revisión».
2. En la tarjeta **Ajustes**, en el ajuste en estado **Propuesto**, desplegá **Rechazar**.
3. Escribí el **Motivo** (mínimo 3 caracteres).
4. Si en esa fecha no se va a ajustar, tildá **No ajustar en esta fecha (pasar al próximo período)**.
5. Tocá **Rechazar**.

El ajuste queda **Rechazado** con quién y por qué. Qué pasa después depende de la casilla:

- **sin tildar**: la fecha de ajuste sigue pendiente y vuelve a aparecer **Calcular ajuste del (fecha)** para recalcular a mano. La automatización no vuelve a proponer sola una fecha que una persona rechazó;
- **tildada**: el contrato saltea esa fecha y el **Próximo ajuste** pasa al período siguiente, sin cambiar el alquiler.

Hoy el CRM no permite cargar un monto de ajuste manual distinto del calculado por índice, ni deshacer un ajuste ya aplicado.

## Generar una liquidación a propietarios
<!-- ruta: /crm/alquileres/liquidaciones; permisos: settlements.generate -->

La liquidación (rendición de cuentas al propietario) resume lo cobrado de un contrato en un mes, descuenta el honorario de administración y las deducciones, y calcula el neto a pagar.

Desde **Liquidaciones** (`/crm/alquileres/liquidaciones`):

1. En **Generar liquidación** elegí el **Contrato** (vigentes o cerrados).
2. Elegí el **Mes**.
3. Opcionalmente cargá **Deducción (opcional)** (por ejemplo, una reparación) y **Monto deducción**.
4. Tocá **Generar para todos los propietarios del contrato**.

Desde la ficha del contrato, en **Liquidaciones** desplegá **Generar liquidación**: ahí, con varios propietarios, podés elegir el **Propietario**. Las deducciones con varios propietarios solo se cargan así, por propietario.

Cómo se calcula: entran los cobros no anulados con fecha hasta fin de mes que no estén en otra liquidación (un cobro cargado tarde entra en la próxima). Con condominio, cada cobro se reparte según el % de cada propietario. Honorario = cobrado × % del contrato. **Neto = cobrado − honorario − deducciones**; no puede quedar negativo.

Se crea en **Borrador**, una por contrato, propietario y mes. El mensaje resume cuántas se generaron, cuántas ya existían y cuántas no tenían cobros. Tocá **Detalle** para ver cada línea.

## Aprobar, marcar pagada o cancelar una liquidación
<!-- ruta: /crm/alquileres/liquidaciones; permisos: settlements.approve, settlements.generate -->

Una liquidación pasa por **Borrador → Aprobada → Pagada**, o puede quedar **Cancelada**.

1. **Aprobar**: en **Liquidaciones** o en la ficha del contrato, tocá **Aprobar** en una liquidación en Borrador. Recién aprobada el propietario la ve en su portal.
2. **Marcar pagada**: cuando le transferiste el neto al propietario, tocá **Marcar pagada** y confirmá «¿Confirmás que se pagó al propietario?».
3. **Cancelar**: en la ficha del contrato, tarjeta **Liquidaciones**, desplegá **Cancelar**, escribí el **Motivo** y tocá **Cancelar liquidación**.

Permisos: aprobar y marcar pagada requieren `settlements.approve` (por defecto solo dirección y super administrador). Cancelar un borrador requiere `settlements.generate`; cancelar una aprobada, `settlements.approve`. Una liquidación **Pagada** no se puede cancelar.

Cancelar libera sus cobros: vuelven a estar disponibles para una nueva liquidación del mismo mes, y recién ahí se pueden anular. Para corregir una liquidación, cancelala y generala de nuevo. Hoy el botón **Cancelar** solo está en la ficha del contrato, no en la lista de **Liquidaciones**. Filtrá la lista por **Estado** y **Mes** con **Filtrar**.

## Finalizar o rescindir un contrato de alquiler
<!-- ruta: /crm/alquileres/[id]; permisos: rentals.manage -->

Cuando un contrato termina (por vencimiento o rescisión anticipada):

1. Abrí la ficha del contrato **Vigente**.
2. En la tarjeta **Cierre y renovación** desplegá **Finalizar o rescindir**.
3. En **Tipo** elegí **Finalización** o **Rescisión**.
4. Elegí la **Fecha efectiva** (no puede ser anterior al inicio del contrato).
5. Escribí el **Motivo**.
6. Tocá **Cerrar contrato** y confirmá: «¿Cerrar el contrato? Las cuotas posteriores sin pagos se anulan».

El contrato pasa a **Finalizado** o **Rescindido** y el motivo queda en el **Resumen** como «Motivo de cierre». Las cuotas de períodos posteriores a la fecha efectiva que no tenían ningún pago pasan a **Anulada** («Cuotas futuras anuladas: N»). El contrato deja de tener próximo ajuste.

Las cuotas vencidas anteriores siguen abiertas: se pueden cobrar y liquidar igual. Hoy el CRM no cambia solo el estado de la propiedad al cerrar el contrato: si vuelve a estar disponible, actualizala desde la ficha de la propiedad.

## Renovar un contrato de alquiler
<!-- ruta: /crm/alquileres/[id]; permisos: rentals.manage -->

La renovación crea un contrato **nuevo** vinculado al anterior, con las mismas partes.

1. Abrí la ficha del contrato **Vigente**.
2. En **Cierre y renovación** desplegá **Renovar (nuevo contrato vinculado)**.
3. Revisá los datos: vienen precargados el inicio (fecha de fin del actual), la moneda, el alquiler vigente, el día de vencimiento, el honorario, el índice y la periodicidad, y el interés por mora.
4. Ajustá **Fin**, **Alquiler inicial** y lo que cambie; el **Código** vacío se genera solo.
5. Tocá **Crear renovación (borrador)**.

Te lleva al contrato nuevo, en **Borrador**. Los propietarios, inquilinos y garantes se copian del anterior. La renovación tiene que empezar cuando termina el actual o después, y solo puede haber una renovación en borrador o vigente por contrato.

Después, en el contrato nuevo, tocá **Activar contrato**: se generan sus cuotas y el contrato anterior pasa a **Renovado**. En el **Resumen** cada uno muestra el vínculo al otro («Renovación» y «Renueva a»). La tarjeta **Cierre y renovación** solo aparece en contratos vigentes.

## Generar un informe para un propietario
<!-- ruta: /crm/informes; permisos: reports.generate -->

Los informes a propietarios resumen la actividad de sus propiedades en un período, solo con datos registrados en el CRM (nada estimado). Están en el menú **Informes** (`/crm/informes`).

1. En **Generar informe** elegí el **Propietario** (contactos con propiedades o contratos como propietario).
2. En **Propiedad** elegí una o dejá «Todas sus propiedades».
3. Revisá **Desde** y **Hasta** (por defecto, el mes anterior completo).
4. Si ya existe uno igual sin enviar y querés actualizarlo, tildá **Si ya existe y no se envió, regenerarlo con los datos de hoy**.
5. Tocá **Generar informe**.

El informe incluye, por propiedad: estado y publicación, consultas por canal, visitas (realizadas, programadas, canceladas, no asistió), cambios de precio y de estado. En **Alquileres**: contratos, cuotas con vencimiento en el período, cobros del período y liquidaciones aprobadas o pagadas.

Hay un solo informe por propietario, propiedad y período: si ya existía, se muestra el existente. Para guardarlo o imprimirlo tocá **Descargar PDF**. La lista muestra propietario, alcance, período, estado (Generado, En cola de envío, Enviado, Entregado, Falló el envío, Email sin configurar) y fecha.

## Enviar un informe al propietario
<!-- ruta: /crm/informes/[id]; permisos: reports.generate -->

El propietario ve el informe en su portal recién cuando se le envía.

1. Abrí el informe desde **Informes**.
2. Tocá **Enviar a (email del acceso)** y confirmá: «¿Enviar el informe al propietario? Lo va a poder ver en el portal».
3. Aparece «Envío encolado: el propietario recibe un email con el link al portal».

El estado pasa a **En cola de envío** y se actualiza cada hora a **Enviado** o **Entregado**. Para enviar, el propietario tiene que tener acceso activo al portal:

- sin acceso, aparece «El propietario no tiene acceso al portal: invitalo para poder enviarle el informe» con el formulario **Invitar al portal**;
- con el acceso desactivado, hay que reactivarlo desde la ficha del contrato.

Si el email no salió porque falta configurar el envío, el informe queda en **Email sin configurar** y podés tocar **Reenviar a …** cuando esté configurado. Lo mismo si falló. Un informe **Enviado** o **Entregado** no se reenvía. Hoy el CRM solo permite regenerar un informe en estado **Generado**: uno ya encolado o enviado no se regenera.

## Invitar a un propietario al portal de propietarios
<!-- ruta: /crm/alquileres/[id]; permisos: users.manage, reports.generate -->

El portal de propietarios (`/propietarios`) funciona solo por invitación. Se invita desde la ficha de un contrato (tarjeta **Partes**) o desde un informe.

1. En la tarjeta del propietario, que dice «Sin acceso al portal», desplegá **Invitar al portal**.
2. Escribí el **Email de acceso** y repetilo en **Repetí el email**. Verificalo con el propietario: no se toma de la ficha del contacto.
3. Tocá **Enviar invitación**. Aparece «Invitación encolada para … (válida 72 h)».

El propietario recibe un email con un link para definir su contraseña («Bienvenido: definí tu contraseña»). Mientras no la defina, la ficha muestra «invitación pendiente»; después, el último ingreso.

Si la invitación venció, tocá **Reenviar invitación a (email)**. El contacto tiene que figurar como propietario de alguna propiedad o contrato, y el email no puede pertenecer a otro usuario. Invitar requiere `users.manage` o `reports.generate`.

## Desactivar o cambiar el email de acceso de un propietario al portal
<!-- ruta: /crm/alquileres/[id]; permisos: users.manage -->

Desde la tarjeta **Partes** de la ficha del contrato, en el propietario con acceso:

**Desactivar el acceso** (por ejemplo, si dejó de trabajar con la inmobiliaria):

1. Desplegá **Desactivar acceso al portal**.
2. Opcionalmente escribí el **Motivo (opcional)**.
3. Tocá **Desactivar acceso** y confirmá. Se cierran sus sesiones y los links pendientes dejan de servir. La ficha muestra «Acceso desactivado».

Para devolverlo, tocá **Reactivar acceso** y confirmá.

**Cambiar el email de acceso**:

1. Desplegá **Cambiar email de acceso**.
2. Escribí **Email nuevo** y **Repetí el email nuevo**.
3. Tocá **Cambiar email** y confirmá. Se cierran las sesiones abiertas y el propietario entra con el email nuevo y su misma contraseña. Si tenía una invitación o un link de contraseña pendiente, deja de servir: reenviá la invitación.

Estas acciones requieren `users.manage` (el rol de alquileres no lo tiene por defecto). Si el propietario olvidó la contraseña no hace falta nada de esto: en `/propietarios/login` tiene **Olvidé mi contraseña**, que le manda un link válido por 1 hora. El email nuevo no puede pertenecer a otro usuario.

## Qué ve el propietario en el portal de propietarios
<!-- permisos: rentals.read, reports.read -->

El portal (`/propietarios`) es privado: cada propietario ve solo la información de sus propiedades. Entra con email y contraseña en `/propietarios/login`. Menú: **Inicio**, **Liquidaciones**, **Documentos**, **Informes** y **Cuenta**.

- **Inicio**: sus propiedades (estado y si está publicada), sus contratos de alquiler (alquiler vigente, estado, cuotas vencidas) y las últimas liquidaciones e informes.
- **Propiedad**: actividad de los últimos 12 meses y documentos de la propiedad marcados como visibles.
- **Contrato**: cuotas, ajustes aplicados y documentos del contrato visibles para propietarios. No ve contratos en borrador.
- **Liquidaciones**: solo las **Aprobadas** y **Pagadas**, con cobrado, honorario, deducciones y neto.
- **Documentos**: los documentos que el equipo marcó como visibles, para descargar.
- **Informes**: solo los **Enviados** o **Entregados**.
- **Cuenta**: **Cambiar contraseña** (mínimo 10 caracteres, con letras y números).

No ve borradores de liquidación, informes sin enviar, documentos «Solo equipo», notas internas ni datos de otros propietarios. Hoy el propietario no puede cargar datos, pagar ni escribir mensajes desde el portal. El portal se puede apagar entero con el flag `owner_portal`; en ese caso muestra que no está disponible.
