/**
 * Portales SIN API pública documentada (Argenprop, Zonaprop). Relevamiento 2026-09 (ver docs/INTEGRATIONS.md):
 * - Argenprop: la integración la habilita el equipo comercial del portal y entrega credenciales propias
 *   (usuario, contraseña, IdVendedor, IdOrigen) a CRMs integrados; la especificación técnica no es pública.
 * - Zonaprop (grupo Navent): publica vía CRMs integradores con credenciales que otorga el ejecutivo de cuenta;
 *   la API de integradores no tiene documentación pública.
 *
 * Por eso este adaptador NO llama a ningún endpoint (no se inventan URLs ni formatos): valida y normaliza la ficha
 * (mapeo puro y testeado de los datos que todo portal pide) y deja la publicación en `awaiting_credentials`
 * hasta contar con el acuerdo comercial y la especificación técnica oficial.
 */
import type { PortalAdapter, PortalFailure, PortalPrepared, PortalProperty } from "./types";
import { orderedPhotos, primaryOperation } from "./types";

/** Ficha normalizada interna (NO es el formato de ningún portal): lo mínimo que exige cualquier aviso. */
export type ListingSheet = {
  reference: string;
  title: string;
  description: string;
  propertyType: string;
  operation: "sale" | "rent" | "temporary_rent";
  price: { currency: "USD" | "ARS"; amount: number | null; hidden: boolean };
  expenses: { currency: "USD" | "ARS"; amount: number } | null;
  location: { hierarchy: string[]; street: string | null; number: string | null; showExactAddress: boolean; latitude: number | null; longitude: number | null };
  surfaces: { totalM2: number | null; coveredM2: number | null; landM2: number | null };
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  ageYears: number | null;
  features: string[];
  photos: string[];
  publicUrl: string;
};

export function buildListingSheet(p: PortalProperty, maxPhotos = 30): PortalPrepared<ListingSheet> {
  const errors: string[] = [];
  const op = primaryOperation(p);
  if (!op) errors.push("La propiedad no tiene operación activa");
  if (!p.locationChain.length) errors.push("Falta la ubicación");
  const photos = orderedPhotos(p, maxPhotos);
  if (!photos.length) errors.push("No hay fotos con URL pública (https)");
  if (errors.length || !op) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      reference: String(p.code),
      title: p.title,
      description: p.description?.trim() || p.title,
      propertyType: p.typeKey,
      operation: op.operation,
      price: { currency: op.currency, amount: op.priceHidden ? null : op.amount, hidden: op.priceHidden },
      expenses: op.expensesAmount !== null ? { currency: op.expensesCurrency ?? op.currency, amount: op.expensesAmount } : null,
      location: {
        hierarchy: [...p.locationChain].reverse().map((l) => l.name),
        street: p.address.street,
        number: p.address.hideExact ? null : p.address.number,
        showExactAddress: !p.address.hideExact,
        latitude: p.address.hideExact ? null : p.address.latitude,
        longitude: p.address.hideExact ? null : p.address.longitude,
      },
      surfaces: { totalM2: p.areas.totalM2, coveredM2: p.areas.coveredM2, landM2: p.areas.landM2 },
      rooms: p.rooms,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      garages: p.garages,
      ageYears: p.ageYears,
      features: p.features,
      photos: photos.map((ph) => ph.url),
      publicUrl: p.publicUrl,
    },
  };
}

function unavailable(name: string): PortalFailure {
  return {
    ok: false,
    reason: "awaiting_credentials",
    error: `${name} no tiene API pública: requiere acuerdo comercial con el portal y su especificación técnica. No se envió nada.`,
  };
}

function agreementOnlyAdapter(channelKey: string, name: string): PortalAdapter {
  return {
    channelKey,
    integrationKey: channelKey,
    name,
    configuration: async () => ({ configured: false, reason: unavailable(name).error }),
    prepare: (p) => buildListingSheet(p),
    publish: async () => unavailable(name),
    update: async () => unavailable(name),
    remove: async () => unavailable(name),
    getStatus: async () => unavailable(name),
  };
}

export const argenpropAdapter = agreementOnlyAdapter("argenprop", "Argenprop");
export const zonapropAdapter = agreementOnlyAdapter("zonaprop", "Zonaprop");
