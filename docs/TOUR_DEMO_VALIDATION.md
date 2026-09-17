# Validación de ángulos y geometría — Residencia Demo 360°

Convención verificada (Photo Sphere Viewer): radianes; `yaw` 0 = centro horizontal de la imagen, positivo hacia la derecha (x = W·(0.5 + yaw/2π)); `pitch` positivo hacia arriba (y = H·(0.5 − pitch/π)).

Todos los panoramas están orientados con el **centro de la imagen hacia el norte** del modelo (arriba en `plano.svg`); por lo tanto `yaw` equivale al rumbo horario desde el norte del plano (derecha = este).

## Método

1. Para cada hotspot se toma un punto 3D real en el modelo (centro de la abertura o del objeto señalado; en los de navegación la altura se elige para un pitch de −0,17 a −0,36 rad según la distancia).
2. `yaw`/`pitch` se calculan desde la posición de cámara (altura 1,55 m) con `atan2(dx, dy)` y `atan2(dz, dist_horizontal)`.
3. Se renderiza con Cycles un panorama de prueba 2048×1024 (cámara equirectangular, latitud −90..90, longitud −180..180) con la escena sin luz y una esfera emisiva de color distinto en cada punto (radio ≈ 0,55° angulares, invisible a rayos difusos/reflejos para que no aparezca reflejada), más 8 esferas blancas a 0,5 m de la cámara y a su misma altura (horizonte).
4. Se detectan los píxeles de cada color (clasificación por tono en sRGB + componente conexa mayor, promedio circular en x para tolerar la costura) y se convierte el centroide a yaw/pitch con la convención de arriba.
5. Error = distancia angular entre la dirección esperada y la medida. Tolerancia exigida: ≤ 1,5°.

**Error máximo: 0.198°** sobre 25 hotspots (0 sin detectar).

## Hotspots

| Escena | Tipo | Hotspot | yaw esperado | pitch esperado | x,y esperado (px) | yaw medido | pitch medido | x,y medido (px) | error (°) |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| entrada | scene | Ir al living | 0.0000 | -0.3410 | 1024.0, 623.1 | 0.0001 | -0.3413 | 1024.0, 623.2 | 0.019 |
| entrada | info | Puerta pivotante | 3.1416 | -0.0997 | 2048.0, 544.5 | 3.1415 | -0.0994 | 2048.0, 544.4 | 0.017 |
| living | scene | Volver a la entrada | 2.5088 | -0.3266 | 1841.8, 618.5 | 2.5087 | -0.3264 | 1841.7, 618.4 | 0.017 |
| living | scene | Ir a la cocina | -1.8797 | -0.3403 | 411.3, 622.9 | -1.8795 | -0.3404 | 411.4, 623.0 | 0.014 |
| living | scene | Ir al comedor | -0.7071 | -0.2917 | 793.5, 607.1 | -0.7072 | -0.2915 | 793.5, 607.0 | 0.015 |
| living | scene | Ir al pasillo | 1.7460 | -0.2022 | 1593.1, 577.9 | 1.7459 | -0.2016 | 1593.1, 577.7 | 0.033 |
| living | scene | Salir a la galería | -0.1153 | -0.2425 | 986.4, 591.1 | -0.1150 | -0.2426 | 986.5, 591.1 | 0.014 |
| living | info | Hogar a leña | 1.1462 | -0.1148 | 1397.6, 549.4 | 1.1461 | -0.1164 | 1397.6, 549.9 | 0.089 |
| living | info | Vista al jardín | 0.7352 | 0.0552 | 1263.6, 494.0 | 0.7345 | 0.0549 | 1263.4, 494.1 | 0.044 |
| cocina | scene | Volver al living | 0.4860 | -0.3179 | 1182.4, 615.6 | 0.4858 | -0.3185 | 1182.3, 615.8 | 0.036 |
| cocina | info | Isla de cocina | -1.1240 | -0.2217 | 657.6, 584.3 | -1.1237 | -0.2183 | 657.7, 583.2 | 0.198 |
| comedor | scene | Volver al living | 0.9576 | -0.3600 | 1336.1, 629.3 | 0.9576 | -0.3603 | 1336.1, 629.4 | 0.016 |
| comedor | info | Mesa para seis | -1.3143 | -0.2185 | 595.6, 583.2 | -1.3144 | -0.2180 | 595.6, 583.1 | 0.026 |
| pasillo | scene | Volver al living | -1.5708 | -0.3431 | 512.0, 623.8 | -1.5708 | -0.3428 | 512.0, 623.7 | 0.020 |
| pasillo | scene | Suite principal | 1.2661 | -0.2685 | 1436.7, 599.5 | 1.2664 | -0.2684 | 1436.8, 599.5 | 0.015 |
| dormitorio | scene | Volver al pasillo | 2.8181 | -0.2552 | 1942.6, 595.2 | 2.8177 | -0.2552 | 1942.4, 595.2 | 0.022 |
| dormitorio | scene | Ir al baño | 2.1094 | -0.3436 | 1711.6, 624.0 | 2.1095 | -0.3429 | 1711.6, 623.8 | 0.042 |
| dormitorio | info | Vista al jardín | -0.5934 | 0.0193 | 830.6, 505.7 | -0.5934 | 0.0191 | 830.6, 505.8 | 0.013 |
| bano | scene | Volver a la suite | -1.7879 | -0.3600 | 441.2, 629.3 | -1.7874 | -0.3590 | 441.4, 629.0 | 0.064 |
| bano | info | Bañera exenta | 0.2285 | -0.3987 | 1098.5, 642.0 | 0.2285 | -0.3989 | 1098.5, 642.0 | 0.007 |
| galeria | scene | Volver al living | 2.8906 | -0.3594 | 1966.2, 629.2 | 2.8913 | -0.3599 | 1966.4, 629.3 | 0.048 |
| galeria | scene | Ir a la piscina | -0.5296 | -0.3154 | 851.4, 614.8 | -0.5296 | -0.3133 | 851.4, 614.1 | 0.119 |
| galeria | info | Galería cubierta | 1.5592 | -0.1839 | 1532.2, 572.0 | 1.5596 | -0.1838 | 1532.4, 571.9 | 0.026 |
| piscina | scene | Volver a la galería | 2.2823 | -0.3273 | 1767.9, 618.7 | 2.2820 | -0.3277 | 1767.8, 618.8 | 0.023 |
| piscina | info | Solárium | 0.7293 | -0.1158 | 1261.7, 549.8 | 0.7295 | -0.1152 | 1261.8, 549.6 | 0.038 |

## Horizonte

Desvío vertical máximo del centroide de las 8 esferas de horizonte respecto de y = H/2 (en grados):

| Escena | esferas detectadas | desvío máx (°) |
|---|---:|---:|
| entrada | 8 | 0.028 |
| living | 8 | 0.028 |
| cocina | 8 | 0.028 |
| comedor | 8 | 0.028 |
| pasillo | 8 | 0.028 |
| dormitorio | 8 | 0.028 |
| bano | 8 | 0.028 |
| galeria | 8 | 0.028 |
| piscina | 8 | 0.028 |

La cámara se coloca siempre nivelada (rotación X = 90°, sin roll), por lo que el horizonte es recto y las verticales convergen solo en los polos, como en cualquier equirectangular.

## Imágenes finales: proporción y costura

Costura = diferencia media absoluta de luminancia (0–255) entre la primera y la última columna; referencia = misma medida entre dos columnas contiguas en el centro de la imagen.

| Escena | tamaño | 2:1 | costura (col. W−1 ↔ 0) | ref. centro | ref. col. 0 ↔ 1 |
|---|---|---|---:|---:|---:|
| entrada | 4096×2048 | sí | 2.10 | 1.43 | 1.02 |
| living | 4096×2048 | sí | 1.63 | 1.60 | 0.85 |
| cocina | 4096×2048 | sí | 26.58 | 1.40 | 7.77 |
| comedor | 4096×2048 | sí | 2.04 | 1.46 | 1.08 |
| pasillo | 4096×2048 | sí | 2.47 | 0.70 | 1.45 |
| dormitorio | 4096×2048 | sí | 6.93 | 2.27 | 0.72 |
| bano | 4096×2048 | sí | 1.81 | 0.89 | 0.70 |
| galeria | 4096×2048 | sí | 1.45 | 1.21 | 0.51 |
| piscina | 4096×2048 | sí | 3.04 | 0.56 | 1.49 |

Nota: en `cocina` la costura cae exactamente sobre el marco negro de la ventana de la mesada (por eso también la diferencia entre las columnas 0 y 1 es alta). Se verificó visualmente uniendo los bordes derecho e izquierdo: la imagen es continua. Cycles genera la proyección equirectangular completa (−180..180°), así que no hay costura geométrica.

## Posición en el plano

`plan.x`/`plan.y` se obtienen de la posición mundo de la cámara con la misma transformación usada para dibujar `plano.svg` (1 m = 10 unidades, norte arriba). Comprobación: el punto cae dentro del polígono `room-{slug}`.

| Escena | cámara (m) | plan.x | plan.y | punto SVG | dentro del ambiente |
|---|---|---:|---:|---|---|
| entrada | 12.00, 2.05 | 0.4245 | 0.8731 | 126.5, 254.5 | sí |
| living | 10.35, 6.75 | 0.3691 | 0.7118 | 110.0, 207.5 | sí |
| cocina | 6.60, 3.35 | 0.2433 | 0.8285 | 72.5, 241.5 | sí |
| comedor | 6.65, 8.55 | 0.2450 | 0.6501 | 73.0, 189.5 | sí |
| pasillo | 18.40, 5.75 | 0.6393 | 0.7461 | 190.5, 217.5 | sí |
| dormitorio | 20.95, 11.25 | 0.7248 | 0.5575 | 216.0, 162.5 | sí |
| bano | 24.70, 10.40 | 0.8507 | 0.5866 | 253.5, 171.0 | sí |
| galeria | 9.30, 13.45 | 0.3339 | 0.4820 | 99.5, 140.5 | sí |
| piscina | 5.70, 17.95 | 0.2131 | 0.3276 | 63.5, 95.5 | sí |

## Distancia mínima de cámara a paredes y muebles

Medida con ray casting horizontal en 72 direcciones a alturas 0,1–2,9 m sobre la geometría evaluada del .blend.

| Escena | distancia mínima (m) | objeto más cercano |
|---|---:|---|
| entrada | 1.27 | w0o0_leaf |
| living | 1.36 | liv_sofa_backframe |
| cocina | 1.05 | k_low_s_f16 |
| comedor | 1.04 | wall12_s1 |
| pasillo | 1.18 | wall15_s0 |
| dormitorio | 1.62 | b_bench_r |
| bano | 1.15 | w17o0_leaf |
| galeria | 1.98 | gal_planter0 |
| piscina | 3.11 | gal_planter0 |
