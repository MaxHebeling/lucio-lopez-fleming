# Ubicación en las visitas: qué se registra y qué no

Texto informativo para el equipo de Lucio López Fleming. Explica cuándo la plataforma usa la ubicación del teléfono del
agente, para qué, quién la ve y cuánto tiempo se guarda.

## Para qué se usa

Solo para **confirmar la llegada a una visita**: el cliente puede ver que su asesor llegó y el equipo tiene un registro
simple de que la visita ocurrió donde correspondía. No sirve para medir rendimiento ni para saber dónde está una persona.

## Cuándo se pide

- Únicamente cuando vos tocás **«Confirmar llegada»** en una visita tuya y, después de leer la explicación, tocás
  **«Usar mi ubicación»**. Es **una sola lectura** del GPS del teléfono.
- Solo dentro de la franja de la visita (desde 2 horas antes del inicio hasta 2 horas después del fin, configurable).
- **Nunca** en segundo plano, ni antes de salir, ni durante el trayecto, ni después de la visita. La aplicación no usa
  seguimiento continuo (`watchPosition`) ni guarda historial de ubicaciones.
- «Salgo para allá» **no** registra ubicación: solo cambia el estado.
- Si el navegador pide permiso, podés negarlo. En ese caso (o si no hay señal) usás «Reportar problema de ubicación»:
  se registra la llegada sin coordenadas, con el motivo, y la visita sigue normalmente.

## Qué se guarda

Por cada intento de llegada (máximo 3 por visita):

| Dato | Para qué | Cuánto tiempo |
| --- | --- | --- |
| Latitud, longitud y precisión del GPS | calcular la distancia a la propiedad y poder revisarla si hubo dudas | **30 días** (configurable en `visits.location_retention_days`); después se borran automáticamente |
| Distancia a la propiedad (en metros) | mostrar «aprox. 20 m de la propiedad» | se conserva con la visita |
| Resultado (verificado / para revisar / sin ubicación) y motivo | control operativo | se conserva con la visita |
| Hora del servidor y del teléfono | registro del momento de llegada | se conserva con la visita |

Las coordenadas **solo** existen en esa tabla (`appointment_checkins`). No se copian a la auditoría, al historial de la
visita, a los eventos internos ni a las notificaciones; la base de datos rechaza guardarlas en el historial.

## Quién ve qué

- **El cliente**: solo el estado («Tu asesor está en camino», «ya está en la propiedad · llegada confirmada 10:27»,
  «la visita está en curso»). Nunca tu ubicación ni la distancia. Cuando la visita termina, su enlace deja de mostrar
  cualquier estado.
- **Vos**: el resultado de tu check-in, la distancia y la precisión.
- **Administración y dirección**: lo mismo en el centro operativo (resultado, distancia, horarios de salida y llegada)
  y las alertas cuando un check-in queda para revisión. Las pantallas no muestran coordenadas.
- **Otros agentes**: nada. Cada agente ve solo sus visitas.

## Dictado del informe

El botón «Dictar» usa el reconocimiento de voz que trae el navegador del teléfono, como si escribieras con el teclado:
la plataforma no graba ni guarda audio y solo recibe el texto. Según el navegador, el reconocimiento puede hacerse en el
propio teléfono o en el servicio de voz del fabricante del navegador (por ejemplo, Google en Chrome o Apple en Safari),
con sus propias políticas. Si preferís no usarlo, escribí el informe o usá el micrófono del teclado.

## Posición en vivo

La plataforma **no** comparte la posición del agente en tiempo real con nadie. Si en el futuro se agregara, sería
opcional por visita, solo mientras el agente está en camino, con precisión redondeada, y se borraría al llegar.

## Preguntas o pedidos

Cualquier consulta sobre estos datos, o el pedido de revisar o borrar un registro puntual, se canaliza con dirección.
