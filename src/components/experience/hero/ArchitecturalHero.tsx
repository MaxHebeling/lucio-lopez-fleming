import type { StaticImageData } from "next/image";
import type { ReactNode } from "react";
import { getSiteJourneyProperty } from "@/server/site/public-data";
import { PROPERTY_JOURNEY, journeySourceUrls, pickJourney } from "./hero-journey";
import type { HeroCta } from "./HeroHeadline";
import { HeroJourney } from "./HeroJourney";

const PROPERTY_PHOTOS = journeySourceUrls(PROPERTY_JOURNEY);

/**
 * Portada del home como recorrido arquitectónico. Server component: decide con datos (caché del sitio, invalidada por
 * los eventos `property.*`) si la propiedad protagonista sigue publicada, disponible y con sus fotos; si no, usa el
 * recorrido de respaldo con fotos de marca y sin link a ninguna ficha.
 */
export async function ArchitecturalHero(props: {
  coverPhoto: StaticImageData;
  kicker: string;
  titleLines: ReactNode[];
  lede: string;
  primary: HeroCta;
  secondary: HeroCta;
  ghost: string | null;
  search: ReactNode;
}) {
  const property = PROPERTY_JOURNEY.propertyCode ? await getSiteJourneyProperty(PROPERTY_JOURNEY.propertyCode, PROPERTY_PHOTOS) : null;
  return <HeroJourney resolved={pickJourney(property)} {...props} />;
}
