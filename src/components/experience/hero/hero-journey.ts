/**
 * Recorrido arquitectónico de la portada (docs/WEB_EXPERIENCE.md §4.1): configuración pura, sin React ni DOM.
 *
 * Un recorrido es una portada de marca + escenas ordenadas. Cada escena declara su foto (o fotos), el encuadre donde
 * vive en desktop y la transición con la que entra; el motor (`motion/journey.ts`) arma la línea de tiempo a partir de
 * esto, sin conocer ninguna imagen en particular. Sirve igual para un edificio con niveles reales o un desarrollo.
 *
 * Reglas: fotos reales (nunca generadas ni reescaladas), alt real por imagen, textos cortos sin afirmar nada que no
 * conste en la publicación, y la propiedad solo se muestra si los datos dicen que sigue disponible
 * (`getJourneyProperty`); si no, `pickJourney` devuelve el recorrido de respaldo con fotos de marca.
 */

/** Abertura real dentro de una foto (ventana, puerta, arco), en fracciones del ancho/alto de la imagen original. */
export type JourneyAperture = { x: number; y: number; w: number; h: number; shape: "rect" | "arch" };

export type JourneyMedia = {
  src: string;
  width: number;
  height: number;
  alt: string;
  /** object-position (%): qué parte de la foto se prioriza al recortar. */
  focal: { x: number; y: number };
  /** Abertura por la que se entra a la escena siguiente (transición `through`). */
  aperture?: JourneyAperture;
  /** URL de origen en la publicación: el recorrido solo se usa si todas siguen publicadas. */
  sourceUrl?: string;
};

/**
 * - `through`: la foto anterior se acerca hacia su abertura (ventana, puerta, arco) y la escena aparece recortada
 *   con esa forma, que crece hasta el encuadre.
 * - `rise`: recorrido vertical. Las fotos se apilan en una columna que sube (con `levels`: el nivel activo).
 * - `widen`: la composición se abre desde una franja central.
 * - `dusk`: misma vista a otra hora (encuadres equivalentes): la foto nueva se funde sobre la anterior.
 */
export type JourneyTransition = "through" | "rise" | "widen" | "dusk";

/** Encuadre en desktop: `stage` grande (≈ 58 vw), `column` vertical, `close` composición final estable. */
export type JourneyFrame = "stage" | "column" | "close";

export type JourneyScene = {
  id: string;
  /** Nombre corto (indicador de progreso). */
  label: string;
  title: string;
  phrase?: string;
  media: JourneyMedia[];
  frame: JourneyFrame;
  transition: JourneyTransition;
  /** Nivel de cada foto de una escena `rise` (niveles reales: «Planta baja», «Planta alta»; en un edificio, sus pisos). */
  levels?: string[];
  /** Versión estable (sin JS o con movimiento reducido): fila editorial con estas escenas. */
  static?: boolean;
  /** Versión liviana mobile (≤ 767 px). */
  mobile?: boolean;
};

export type JourneyCover = { alt: string; caption: string; aperture: JourneyAperture };

export type Journey = {
  kind: "property" | "brand";
  /** Código de la propiedad protagonista (solo `property`). */
  propertyCode: number | null;
  /** Nombre del recorrido (lista accesible de escenas). */
  name: string;
  cover: JourneyCover;
  scenes: JourneyScene[];
};

/** Portada de marca (LCP): la oficina modular. La abertura es el vidrio de la ventana roja del container. */
export const BRAND_COVER: JourneyCover = {
  alt: "Oficina modular de Lucio López Fleming, con su cartel y estructura roja, al atardecer",
  caption: "Nuestra oficina modular, al atardecer",
  aperture: { x: 0.4725, y: 0.4388, w: 0.1167, h: 0.0975, shape: "rect" },
};

const TIPAL = "/brand/journey/el-tipal-2605";
const ADINCO = "https://static1.adinco.net/1115046_p";

/** Casa en Club de Campo El Tipal (Cód. 2605): fotos de su publicación, en el orden de un recorrido real. */
export const PROPERTY_JOURNEY: Journey = {
  kind: "property",
  propertyCode: 2605,
  name: "Recorrido por la casa en Club de Campo El Tipal",
  cover: BRAND_COVER,
  scenes: [
    {
      id: "acceso",
      label: "Acceso",
      title: "Casa en El Tipal",
      phrase: "Club de Campo El Tipal, Salta. Una casa de dos plantas.",
      frame: "stage",
      transition: "through",
      static: true,
      mobile: true,
      media: [
        {
          src: `${TIPAL}/acceso.jpg`,
          width: 1024,
          height: 768,
          alt: "Camino de adoquines hacia la fachada de la casa de dos plantas, con techos de teja y balcones con balaustrada",
          focal: { x: 62, y: 50 },
          // Puerta de entrada con arco, bajo el balcón central.
          aperture: { x: 0.6738, y: 0.5072, w: 0.0449, h: 0.1009, shape: "arch" },
          sourceUrl: `${ADINCO}/68dd47c253786.jpg`,
        },
      ],
    },
    {
      id: "planta-baja",
      label: "Planta baja",
      title: "Hall y living",
      phrase: "La escalera de madera y, al fondo, el living con hogar.",
      frame: "stage",
      transition: "through",
      static: true,
      mobile: true,
      media: [
        {
          src: `${TIPAL}/hall-living.jpg`,
          width: 1024,
          height: 768,
          alt: "Hall de entrada con escalera de madera y baranda de hierro; al fondo, el living con hogar y ventanas en arco",
          focal: { x: 50, y: 55 },
          sourceUrl: `${ADINCO}/68dd47c152665.jpg`,
        },
      ],
    },
    {
      id: "planta-alta",
      label: "Planta alta",
      title: "Dos plantas",
      phrase: "Por la escalera, a la planta alta.",
      frame: "column",
      transition: "rise",
      levels: ["Planta baja", "Planta alta"],
      media: [
        {
          src: `${TIPAL}/escalera.jpg`,
          width: 768,
          height: 1024,
          alt: "Escalera de madera con baranda de hierro forjado que sube a la planta alta",
          focal: { x: 50, y: 50 },
          sourceUrl: `${ADINCO}/68dd47c168527.jpg`,
        },
        {
          src: `${TIPAL}/ventana-arco.jpg`,
          width: 768,
          height: 1024,
          alt: "Ventana en arco de la planta alta con vista al patio de entrada, el portón y el verde del barrio",
          focal: { x: 50, y: 50 },
          // Hoja central del ventanal, con remate en arco.
          aperture: { x: 0.349, y: 0.244, w: 0.2995, h: 0.674, shape: "arch" },
          sourceUrl: `${ADINCO}/68dd47c34643e.jpg`,
        },
      ],
    },
    {
      id: "vista",
      label: "La vista",
      title: "Desde el balcón",
      phrase: "El patio de entrada y el jardín, vistos desde arriba.",
      frame: "stage",
      transition: "through",
      media: [
        {
          src: `${TIPAL}/vista-balcon.jpg`,
          width: 1024,
          height: 768,
          alt: "Vista desde el balcón con balaustrada: patio de entrada de adoquines, canteros con flores blancas y el portón",
          focal: { x: 50, y: 50 },
          sourceUrl: `${ADINCO}/68dd47c38cc7c.jpg`,
        },
      ],
    },
    {
      id: "exterior",
      label: "Exterior",
      title: "Galería y piscina",
      phrase: "Galería con asador y piscina en el jardín.",
      frame: "stage",
      transition: "widen",
      static: true,
      mobile: true,
      media: [
        {
          src: `${TIPAL}/piscina-dia.jpg`,
          width: 1024,
          height: 768,
          alt: "Piscina en el jardín vista desde la galería, con mesa de mármol, bancos curvos y árboles alrededor",
          focal: { x: 55, y: 55 },
          sourceUrl: `${ADINCO}/68dd47c2ba32c.jpg`,
        },
      ],
    },
    {
      id: "cierre",
      label: "De noche",
      title: "Casa en Club de Campo El Tipal",
      frame: "close",
      transition: "dusk",
      static: true,
      mobile: true,
      media: [
        {
          src: `${TIPAL}/piscina-noche.jpg`,
          width: 1024,
          height: 768,
          alt: "La piscina iluminada de noche, con los bancos curvos encendidos y la mesa de mármol en primer plano",
          focal: { x: 50, y: 55 },
          sourceUrl: `${ADINCO}/68dd47c294642.jpg`,
        },
      ],
    },
  ],
};

/** Respaldo sin propiedad: la inmobiliaria por dentro (fotos y textos propios de la marca). */
export const BRAND_JOURNEY: Journey = {
  kind: "brand",
  propertyCode: null,
  name: "Recorrido por la inmobiliaria",
  cover: BRAND_COVER,
  scenes: [
    {
      id: "oficina",
      label: "La oficina",
      title: "Asesoramiento personalizado",
      phrase: "Cada operación, conversada en la oficina.",
      frame: "stage",
      transition: "through",
      static: true,
      mobile: true,
      media: [
        {
          src: "/brand/photos/oficina-escritorio.jpg",
          width: 2400,
          height: 1004,
          alt: "Tres integrantes de la inmobiliaria revisan una carpeta en el escritorio de la oficina",
          focal: { x: 50, y: 50 },
        },
      ],
    },
    {
      id: "oficio",
      label: "El oficio",
      title: "Sobre los planos",
      phrase: "Comercialización de inmuebles y lotes en Salta y el país.",
      frame: "stage",
      transition: "widen",
      static: true,
      mobile: true,
      media: [
        {
          src: "/brand/photos/trabajo-planos.jpg",
          width: 2400,
          height: 1004,
          alt: "Asesor de la inmobiliaria trabajando sobre el plano de un loteo",
          focal: { x: 50, y: 50 },
        },
      ],
    },
    {
      id: "cierre",
      label: "El equipo",
      title: "Tu próximo buen negocio",
      frame: "close",
      transition: "widen",
      static: true,
      mobile: true,
      media: [
        {
          src: "/brand/photos/equipo-planos.jpg",
          width: 1366,
          height: 607,
          alt: "Equipo de la inmobiliaria reunido alrededor de una mesa con planos",
          focal: { x: 50, y: 50 },
        },
      ],
    },
  ],
};

/** URLs de origen de las fotos del recorrido (para verificar en la base que siguen publicadas). */
export function journeySourceUrls(journey: Journey): string[] {
  return journey.scenes.flatMap((s) => s.media.map((m) => m.sourceUrl).filter((u): u is string => Boolean(u)));
}

/** Fotos de la propiedad protagonista (URL de origen), constante para que la caché por render las reconozca. */
export const PROPERTY_JOURNEY_PHOTOS = journeySourceUrls(PROPERTY_JOURNEY);

export type JourneyPropertyData = { code: number; slug: string; bedrooms: number | null; bathrooms: number | null; coveredAreaM2: number | null };

export type ResolvedJourney = {
  journey: Journey;
  /** Solo con la propiedad disponible: ficha real y datos registrados. */
  property: (JourneyPropertyData & { href: string; specs: string[] }) | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Recorrido de la propiedad si los datos la confirman disponible (mismo código), si no el de marca. */
export function pickJourney(property: JourneyPropertyData | null, journey: Journey = PROPERTY_JOURNEY): ResolvedJourney {
  if (!property || journey.kind !== "property" || property.code !== journey.propertyCode) return { journey: BRAND_JOURNEY, property: null };
  const specs = [
    property.bedrooms ? plural(property.bedrooms, "dormitorio", "dormitorios") : null,
    property.bathrooms ? plural(property.bathrooms, "baño", "baños") : null,
    property.coveredAreaM2 ? `${new Intl.NumberFormat("es-AR").format(property.coveredAreaM2)} m² cubiertos` : null,
  ].filter((s): s is string => Boolean(s));
  return { journey, property: { ...property, href: `/propiedades/${property.slug}`, specs } };
}
