---
dominio: virtual-tours
titulo: Guía del tour 360° y captación de propietarios en el sitio
resumen: «Preguntá por esta casa» dentro del tour 360° y el formulario paso a paso «Quiero vender mi propiedad» del home.
permisos:
---

## Qué es «Preguntá por esta casa» dentro del tour 360°
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.read -->

En el tour 360° del sitio aparece el botón **Preguntá**. El visitante escribe, por ejemplo, «¿Dónde está el jardín?» y la guía responde con el camino entre ambientes («Desde el Living podés ir a la Galería…») y un botón **Ir a…** que lo lleva paso a paso con la transición del tour. Si pregunta un dato («¿cuántos dormitorios tiene?»), responde con los datos publicados de la ficha o con los puntos de información del tour.

Si algo no consta, responde «No está registrado en la ficha ni en el tour» y ofrece **Consultar al asesor**. Si no hay una escena exacta (por ejemplo no hay «Jardín»), lo aclara y propone la más cercana (la Galería). Nunca inventa.

Para que la guía funcione bien, poné nombres claros a las escenas y cargá puntos de información en el editor del tour. Se activa con el flag `ai_tour_guide`; con la IA configurada, la IA solo ayuda a entender preguntas escritas de otra forma.

## Captación «Quiero vender mi propiedad» paso a paso
<!-- ruta: /crm/leads; permisos: leads.read_own, leads.read_all -->

En el home del sitio, la sección de propietarios pregunta de a un paso: dónde está la propiedad (y si quiere vender o alquilar), tipo, superficie aproximada, dormitorios, estado, fotos (solo si el almacenamiento está configurado) y contacto. Todo es opcional salvo la ubicación, el nombre y un teléfono o email.

Crea el mismo lead de siempre: fuente web de tasación, interés «Vender su propiedad» (o captación si quiere alquilar), con el mensaje armado con los datos («Superficie aproximada: 180 m²», «Dormitorios: 3», «Estado: Muy bueno»). No se muestran valores ni tasaciones automáticas: el sitio aclara que un asesor contacta para una tasación profesional.

## Fotos enviadas por un propietario en la captación
<!-- ruta: /crm/leads/[id]; permisos: leads.read_own, leads.read_all -->

Si el paso de fotos está habilitado (flag `owner_capture_photos` y almacenamiento S3 configurado), las fotos que envía el propietario aparecen en el lead en **Fotos enviadas por el propietario**. Son privadas: las ve quien puede ver todos los leads o el agente asignado. Las fotos subidas que no se enviaron con el formulario se borran solas a las 24 horas.
