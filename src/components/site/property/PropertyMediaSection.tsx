"use client";

import { lazy, Suspense, type ComponentProps } from "react";

/**
 * Carga diferida de las pestañas de medios (y la portada del tour). La ficha importa este envoltorio mínimo; el JS de
 * pestañas/tour vive en un chunk aparte que solo se descarga en las fichas que lo renderizan (con tour publicado).
 * React.lazy (sin next/dynamic, que sumaba su runtime a todas las fichas). Se renderiza también en el servidor: el HTML
 * inicial ya trae galería y pestañas; en el cliente ese bloque se hidrata cuando llega su chunk.
 */
const PropertyMediaTabs = lazy(() => import("./PropertyMediaTabs").then((m) => ({ default: m.PropertyMediaTabs })));

export default function PropertyMediaSection(props: ComponentProps<typeof PropertyMediaTabs>) {
  return (
    <Suspense fallback={props.photos}>
      <PropertyMediaTabs {...props} />
    </Suspense>
  );
}
