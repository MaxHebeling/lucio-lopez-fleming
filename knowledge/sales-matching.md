---
dominio: leads
titulo: Propiedades y clientes compatibles
resumen: Cómo se calcula la coincidencia estimada entre un cliente y una propiedad, dónde se ve y qué hace el sistema al publicar o cambiar un precio.
permisos: leads.read_own, leads.read_all
---

## Ver las propiedades compatibles de un cliente
<!-- ruta: /crm/contactos/[id]; permisos: leads.read_own, leads.read_all -->

En la ficha del contacto, la tarjeta **Propiedades compatibles** lista las propiedades publicadas y disponibles que coinciden con su **Perfil de búsqueda**, ordenadas por **Coincidencia estimada**.

Cada una explica por qué: «Coincide: ✓ Presupuesto ✓ 3 dormitorios ✓ Jardín» y «Considerar: superficie menor a la preferida». Si usa datos sugeridos que nadie confirmó, lo avisa. Es una estimación con los datos cargados, nunca una certeza.

Para que haya coincidencias el perfil necesita qué busca (**Operación** o **Tipo de propiedad**) y dónde o cuánto (**Zonas** o **Presupuesto**). Si falta, la tarjeta dice qué completar.

## Cómo se calcula la coincidencia estimada
<!-- ruta: /crm/contactos/[id]; permisos: leads.read_own, leads.read_all -->

Primero se aplican filtros obligatorios: la propiedad tiene que estar publicada y **disponible** (no reservada), tener la operación buscada, el tipo buscado y un precio dentro del presupuesto con una tolerancia del 10 % (si el precio está oculto no se descarta: se marca «Precio a consultar»).

Después se ponderan las preferencias que el cliente expresó: presupuesto, zonas, dormitorios, superficie, características y baños. El puntaje es el porcentaje de lo que coincide sobre lo que pidió; si vio la propiedad en el sitio suma un poco. Se listan las que superan el 55 %.

La tolerancia y el puntaje mínimo los ajusta un administrador (settings `ai.matching.budget_tolerance_pct` y `ai.matching.min_score`).

## Descartar una propiedad para un cliente
<!-- ruta: /crm/contactos/[id]; permisos: contacts.update -->

Si al cliente no le interesa una propiedad compatible:

1. En **Propiedades compatibles**, tocá **Descartar** al lado de la propiedad.
2. Elegí el **Motivo** (Precio / presupuesto, Ubicación, Tamaño, Tipo de propiedad, Características u Otro motivo).
3. Tocá **Descartar**.

La propiedad deja de aparecer para ese cliente y el descarte queda en el historial y en la auditoría. Si fue por presupuesto y aparecen opciones nuevas compatibles, la siguiente acción sugerida propone «Enviar nuevas opciones».

## Ver los clientes compatibles de una propiedad
<!-- ruta: /crm/propiedades/[id]; permisos: leads.read_own, leads.read_all -->

En la ficha de una propiedad del CRM, la tarjeta **Clientes compatibles** muestra los contactos cuyo perfil coincide, con el porcentaje y la explicación. Un agente ve solo sus clientes («Tus clientes»); con **Ver todos los leads** se ven los de todo el equipo. Solo se calcula si la propiedad está publicada y disponible.

## Qué pasa al publicar una propiedad o cambiar su precio
<!-- ruta: /crm/propiedades/[id]; permisos: leads.read_own, leads.read_all -->

Cuando una propiedad se publica o cambia su precio, el sistema calcula en segundo plano los clientes compatibles, los guarda (con puntaje, motivos y versión del cálculo) y avisa al agente responsable de cada cliente con una notificación en **Avisos**: «N clientes compatibles con la propiedad #…». El aviso no se repite en el mismo día.

El sistema **nunca contacta al cliente**: no envía mensajes, emails ni WhatsApp. Decidís vos a quién ofrecerla.
