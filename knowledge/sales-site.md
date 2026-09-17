---
dominio: faq
titulo: Búsqueda asistida, preguntas y comparador del sitio
resumen: Qué ven los clientes en el sitio (concierge «Contanos qué buscás», «Preguntale a esta propiedad» y el comparador), qué datos usan y cómo se apagan.
permisos:
---

## «Contanos qué buscás» en el sitio
<!-- ruta: /crm/integraciones; permisos: integrations.read -->

En el buscador del inicio y arriba de los listados el cliente puede escribir lo que busca en sus palabras, por ejemplo «casa 3 dormitorios con jardín hasta USD 180.000 en San Lorenzo». El sitio lo convierte en los filtros reales del buscador (operación, tipo, zona, precio con moneda, dormitorios, baños, superficie, cocheras, características, apto crédito) y muestra los resultados reales con esos filtros, más los chips de lo que entendió («Entendimos: Casa · 3+ dormitorios · hasta USD 180.000 · con jardín»).

Lo que no pudo interpretar lo dice («No pude interpretar: …») y no filtra. Un monto sin moneda no se adivina: el cliente elige dólares o pesos. Zonas y características se validan contra las reales. El texto que escribe el cliente no se guarda. Se controla con el flag **ai_concierge**.

## «Preguntale a esta propiedad»
<!-- ruta: /crm/integraciones; permisos: integrations.read -->

En cada ficha publicada hay un bloque desplegable **✦ Preguntale a esta propiedad**. Responde solo con los datos publicados de esa ficha (dormitorios, baños, superficies, características, precio o «a consultar», expensas, apto crédito, antigüedad, estado y zona). Nunca muestra la dirección exacta si está oculta, ni propietarios, notas o documentos.

Si el dato no está cargado responde «Ese dato no está registrado actualmente.» y ofrece **Consultar a un asesor**, que completa el formulario de consulta real con la pregunta. Si pregunta cuándo visitarla, ofrece **Pedir una visita**. Por eso conviene tener las fichas completas: cada dato cargado es una respuesta. Se controla con el flag **ai_property_qa**.

## Comparador de propiedades
<!-- ruta: /crm/integraciones; permisos: integrations.read -->

En los listados y en las fichas el cliente puede tocar **Comparar** en hasta tres propiedades y ver una tabla con precio, expensas, apto crédito, estado, superficies, ambientes, dormitorios, baños, cocheras, antigüedad, ubicación pública y características, con las diferencias resaltadas y un texto que las explica («La propiedad #… tiene 40 m² cubiertos más que…»). Lo que falta aparece como «Sin dato».

Las páginas de comparación no se indexan en buscadores. Se controla con el flag **site_compare**.

## Apagar las funciones de ventas con IA
<!-- ruta: /crm/integraciones; permisos: integrations.manage -->

En **Integraciones → Feature flags** un administrador puede apagar cada función sin redeploy: **ai_concierge** (búsqueda en lenguaje natural), **ai_property_qa** (preguntas en la ficha), **site_compare** (comparador) y **ai_matching** (perfil de búsqueda, coincidencias, señales de interés, siguiente acción y «Ponme al día»). Al cambiar un flag el sitio se actualiza al instante; apagadas, el sitio y el CRM quedan como antes.

Todo funciona sin la clave de IA con reglas deterministas. Con la clave (ANTHROPIC_API_KEY) se suma un modelo para interpretar mejor textos libres, siempre validado y con un presupuesto diario propio para el sitio.
