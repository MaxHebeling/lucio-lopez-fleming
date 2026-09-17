# Guía de captura 360° para el fotógrafo

Cómo sacar las panorámicas de una propiedad para que el tour virtual de Lucio López Fleming se vea bien y se cargue sin
retoques. Pensada para imprimir o tener en el teléfono en la visita. Detalles técnicos del sistema: `docs/VIRTUAL_TOURS.md`.

## 1. Equipo

- **Cámara 360° de dos lentes** (tipo Insta360, Ricoh Theta u otra de gama similar): la opción práctica. Que exporte
  foto equirectangular de al menos 5,7K (idealmente 8K) y permita HDR o bracketing.
- **Cámara réflex / sin espejo + cabezal panorámico** (nodal): máxima calidad, más tiempo de captura y de unión
  (stitching). Útil en propiedades de alta gama o con mucho contraste de luz.
- **Trípode o monopié fino** con patas angostas (se ven menos en el nadir) y nivel de burbuja.
- **Disparo remoto**: app del teléfono o temporizador, para salir del cuadro.
- Paño de microfibra (lentes limpias: una huella arruina toda la esfera).

## 2. Altura y posición de la cámara

- Altura de la lente: **1,50–1,60 m** (a la altura de los ojos). En ambientes chicos o con muebles altos (cocinas con
  alacenas, baños) se puede bajar a ~1,40 m. Mantener la misma altura en toda la propiedad.
- Cámara **nivelada** (burbuja centrada): una cámara torcida hace "ondular" el horizonte.
- A **1 m o más** de paredes y muebles. **Nunca en una esquina**: deforma y achica el ambiente.
- Lo más cerca posible del **centro útil** del ambiente, con vista a las puertas o pasos hacia los ambientes vecinos.
- Misma **orientación** en todas las tomas si la cámara lo permite (por ejemplo, el frente de la cámara hacia la entrada
  de la casa): facilita ubicar los puntos de navegación.

## 3. Cuántas escenas y cuáles

Una escena por lugar que el comprador quiere "pisar". Orientativo:

| Siempre | Si existen | Evitar |
| --- | --- | --- |
| Acceso / entrada | Dormitorios secundarios | Depósitos, lavaderos chicos (salvo que sumen) |
| Living | Pasillos relevantes (que conectan ambientes) | Dos tomas casi iguales del mismo ambiente |
| Cocina | Terraza, balcón | Placares abiertos por dentro |
| Comedor | Jardín (una o dos tomas) | |
| Dormitorio principal | Piscina, quincho, parrilla | |
| Baño principal | Vistas especiales (cerros, ventanal) | |

Casa típica: 8 a 14 escenas. Departamento: 5 a 8.

## 4. Conexión entre escenas

- Entre dos escenas conectadas tiene que haber **línea de vista**: desde el living se ve la puerta de la cocina y desde la
  cocina se ve hacia el living. Así el punto de navegación queda "sobre" la puerta real.
- **Puertas abiertas** cuando conectan ambientes; cerradas cuando no aportan (placares, baños de servicio).
- Si un ambiente no se ve desde el anterior (pasillo en L), agregar una escena intermedia en el pasillo.

## 5. Luz

- **HDR o bracketing** (3 a 5 exposiciones): en una 360° entran a la vez ventanas al sol y rincones oscuros.
- Horario: mañana o tarde con luz pareja; evitar sol directo entrando fuerte por los ventanales. Exteriores: cielo
  despejado o nublado parejo, sol a espaldas de la fachada principal si se puede.
- **Luces interiores encendidas y coherentes** en toda la casa (mismo tono cálido/frío). Apagar luces de colores.
- Cortinas abiertas y parejas; persianas a la misma altura.

## 6. Espejos, reflejos y el fotógrafo

- La 360° ve todo: **salir del cuadro** (otro ambiente, detrás de una puerta) y disparar con la app o temporizador.
- Espejos y vidrios: mover la cámara hasta que el trípode no se refleje de frente; en baños, ubicarla en diagonal al espejo.
- Pantallas de TV y monitores **apagados**.

## 7. Preparación del inmueble (antes de llegar)

- Orden y limpieza: camas hechas, mesadas despejadas, sin ropa ni toallas usadas, tapas de inodoro bajas.
- **Objetos personales y datos sensibles fuera de vista**: documentos, facturas, sobres con direcciones, agendas,
  pizarras, fotos familiares, títulos y diplomas con nombres, medicamentos, llaves, alarmas y cámaras de seguridad a la vista.
- Sin personas ni **mascotas** en toma; autos fuera de la cochera o del frente (y ninguna **patente** visible).
- Numeración de la casa o carteles con la dirección: si la propiedad publica "dirección oculta", no deben verse.

## 8. Exportación

- Formato **equirectangular 2:1** (por ejemplo 8192 × 4096, 7680 × 3840 o 6080 × 3040). El CRM rechaza otras proporciones.
- **JPG sRGB**, calidad 85–90. Ancho entre **6000 y 8192 px**; tamaño máximo por archivo **15 MB**.
- **Sin marca de agua** ni logos del software; sin textos agregados.
- **Nadir parcheado** (el trípode tapado con un parche neutro o el suelo clonado). No usar logos en el nadir.
- Horizonte recto y costuras (stitching) revisadas en puertas, marcos y líneas rectas.
- No hace falta sacar los metadatos: el sistema elimina EXIF/GPS al subir.

**Nombre de archivo**: `prop-{código}-{ambiente}-360.jpg`, en minúsculas, sin espacios ni tildes. Ejemplos:
`prop-001-living-360.jpg`, `prop-001-dormitorio-principal-360.jpg`, `prop-3021-jardin-360.jpg`.

## 9. Checklist en obra

- [ ] Lentes limpias, batería y memoria de sobra.
- [ ] Casa preparada (§7), luces encendidas, TV apagada, puertas según §4.
- [ ] Trípode nivelado a 1,50–1,60 m, a más de 1 m de paredes, nunca en esquinas.
- [ ] HDR/bracketing activado; misma orientación de cámara en todas las tomas.
- [ ] Recorrido planificado: entrada → living → cocina → comedor → pasillos → dormitorios → baños → exteriores.
- [ ] Revisar cada toma en el teléfono antes de mover el trípode: reflejos, personas, datos sensibles, horizonte.
- [ ] Anotar el orden y qué ambiente conecta con cuál (sirve para los puntos de navegación).

## 10. Carga en el CRM y publicación (paso a paso)

1. Entrá al CRM → **Propiedades** → abrí la ficha → sección **Tour virtual 360°** → **Crear tour** → «Propio» → **Crear tour**.
2. En **Agregar escena**: escribí el nombre del ambiente (tal como lo va a leer el visitante: «Living», «Cocina»…),
   elegí la panorámica y tocá **Subir escena**. Repetí en el orden del recorrido (se puede reordenar con las flechas).
3. Elegí la **escena inicial** (normalmente la entrada) con «Inicial».
4. Para cada escena, en el visor: girá hasta la vista de frente que querés que vea el visitante al llegar y tocá
   **Usar vista actual como vista inicial**.
5. **Puntos de navegación**: girá la vista hasta que la cruz quede sobre la puerta que lleva al otro ambiente, elegí
   «Navegación» y el destino, y tocá **Agregar en el centro de la vista**. Hacé lo mismo del otro lado (ida y vuelta).
   Opcional: puntos de «Información» (hogar a leña, orientación, materiales) con un texto corto y verificado.
6. **Plano** (opcional pero recomendado): subí una imagen del plano (JPG/PNG/WebP) y, con cada escena elegida, hacé clic
   en el plano donde se sacó la foto.
7. **Recorrido guiado**: marcá las escenas y el orden de la visita ideal y **Guardar recorrido**.
8. **Previsualizar**: recorré el tour como lo verá un visitante (no registra estadísticas).
9. **Publicar tour**: si falta algo, el CRM lo lista (escena inicial oculta, un punto que lleva a una escena oculta…).
   El tour se ve en el sitio cuando **la propiedad también está publicada**.

¿Algo salió mal? Se puede ocultar una escena, mover o borrar puntos y volver a publicar sin perder el resto. Si el CRM
avisa que el almacenamiento no está configurado, todavía no se pueden subir archivos: consultá con quien administra el sistema.
