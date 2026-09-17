/**
 * Datos institucionales públicos (organización y sucursales) desde la base. Nada hardcodeado que pueda
 * desactualizarse: nombre, año, sedes, horarios y teléfonos salen de lo que carga el equipo.
 */
import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { Executor } from "../db";
import { ORG_SLUG } from "../org";
import { SITE_CACHE_TAGS, SITE_REVALIDATE_SECONDS } from "./revalidate";
import { readPublic } from "./public-data";

export type PublicBranch = {
  slug: string;
  name: string;
  street: string | null;
  city: string | null;
  province: string | null;
  phone: string | null;
  email: string | null;
  schedule: string | null;
  lat: number | null;
  lng: number | null;
  isMain: boolean;
};

export type SiteInfo = {
  name: string;
  foundedYear: number | null;
  branches: PublicBranch[];
  mainPhone: string | null;
  mainEmail: string | null;
  /** WhatsApp general de la inmobiliaria (SITE_WHATSAPP_E164). Sin configurar: null y el sitio ofrece teléfono. */
  whatsappE164: string | null;
  social: { instagram: string; facebook: string };
};

/** Redes publicadas en el sitio anterior (docs/WEB_EXPERIENCE.md §1). */
export const SOCIAL = {
  instagram: "https://www.instagram.com/inmoluciolopezfleming/",
  facebook: "https://www.facebook.com/luciolopezfleming",
} as const;

export async function loadSiteInfo(db: Executor): Promise<SiteInfo> {
  const org = await db.selectFrom("organizations").select(["id", "name", "founded_year"]).where("slug", "=", ORG_SLUG).executeTakeFirst();
  const branches = org
    ? await db
        .selectFrom("branches")
        .select(["slug", "name", "address_street", "address_number", "city", "province", "phone", "email", "schedule", "latitude", "longitude", "is_main"])
        .where("organization_id", "=", org.id)
        .where("is_active", "=", true)
        .orderBy("is_main", "desc")
        .orderBy("name")
        .execute()
    : [];
  const mapped: PublicBranch[] = branches.map((b) => ({
    slug: b.slug,
    name: b.name,
    street: [b.address_street, b.address_number].filter(Boolean).join(" ") || null,
    city: b.city,
    province: b.province,
    phone: b.phone,
    email: b.email,
    schedule: b.schedule,
    lat: b.latitude === null ? null : Number(b.latitude),
    lng: b.longitude === null ? null : Number(b.longitude),
    isMain: b.is_main,
  }));
  const main = mapped.find((b) => b.isMain) ?? mapped[0];
  return {
    name: org?.name ?? "Lucio López Fleming Inmobiliaria",
    foundedYear: org?.founded_year ?? null,
    branches: mapped,
    mainPhone: main?.phone ?? null,
    mainEmail: main?.email ?? null,
    whatsappE164: siteWhatsapp(),
    social: { ...SOCIAL },
  };
}

function siteWhatsapp(): string | null {
  const wa = process.env.SITE_WHATSAPP_E164?.trim();
  return wa && /^\+[1-9]\d{7,14}$/.test(wa) ? wa : null;
}

const siteInfoCached = unstable_cache(
  async () => {
    const { getDb } = await import("../db");
    return loadSiteInfo(getDb());
  },
  ["site", "info", "v2"],
  { tags: [SITE_CACHE_TAGS.info], revalidate: SITE_REVALIDATE_SECONDS },
);

/**
 * Cacheado (etiqueta site:info, se invalida con revalidatePublicSite) y memoizado por render (header, footer y página
 * lo piden a la vez). El WhatsApp sale de la variable de entorno en cada lectura, nunca de la caché.
 */
export const getSiteInfo = cache(async (): Promise<SiteInfo> => ({ ...(await readPublic(siteInfoCached)), whatsappE164: siteWhatsapp() }));
