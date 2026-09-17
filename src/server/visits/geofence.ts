/**
 * Geofence del check-in (función pura). Verificado si distancia ≤ radio + min(precisión, tope).
 * - Precisión peor que el tope → requiere revisión (no se puede afirmar nada con ese margen).
 * - Propiedad sin coordenadas → requiere revisión con motivo explícito.
 * Nunca bloquea la visita: el resultado es informativo para el equipo.
 */

export type GeoPoint = { lat: number; lng: number };
export type DevicePosition = GeoPoint & { accuracy: number };

export type CheckinVerification = "verified" | "needs_review" | "no_location";
export type CheckinReason =
  | "within_radius"
  | "outside_radius"
  | "low_accuracy"
  | "property_without_coordinates"
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "unsupported"
  | "other";

export const LOCATION_PROBLEM_REASONS = ["permission_denied", "position_unavailable", "timeout", "unsupported", "other"] as const;
export type LocationProblemReason = (typeof LOCATION_PROBLEM_REASONS)[number];

export const CHECKIN_REASON_LABEL: Record<CheckinReason, string> = {
  within_radius: "Dentro del radio de la propiedad",
  outside_radius: "La ubicación quedó fuera del radio de la propiedad",
  low_accuracy: "La precisión del GPS no alcanzó para verificar",
  property_without_coordinates: "La propiedad no tiene coordenadas cargadas",
  permission_denied: "No se dio permiso de ubicación",
  position_unavailable: "El teléfono no pudo obtener la ubicación",
  timeout: "El GPS tardó demasiado",
  unsupported: "El navegador no permite ubicación",
  other: "Otro motivo",
};

const EARTH_RADIUS_M = 6_371_008.8;

/** Distancia en metros (haversine). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Coordenadas de propiedad utilizables (numeric de Postgres llega como string). (0,0) = dato vacío importado. */
export function propertyPoint(lat: string | number | null | undefined, lng: string | number | null | undefined): GeoPoint | null {
  if (lat === null || lat === undefined || lng === null || lng === undefined || lat === "" || lng === "") return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  if (la === 0 && ln === 0) return null;
  return { lat: la, lng: ln };
}

export type GeofenceResult = { status: CheckinVerification; reason: CheckinReason; distanceM: number | null };

export function evaluateGeofence(input: { property: GeoPoint | null; position: DevicePosition; radiusM: number; maxAccuracyM: number }): GeofenceResult {
  const { property, position, radiusM, maxAccuracyM } = input;
  if (!property) return { status: "needs_review", reason: "property_without_coordinates", distanceM: null };
  const distanceM = Math.round(haversineMeters(property, position));
  if (!(position.accuracy >= 0) || position.accuracy > maxAccuracyM) return { status: "needs_review", reason: "low_accuracy", distanceM };
  if (distanceM <= radiusM + Math.min(position.accuracy, maxAccuracyM)) return { status: "verified", reason: "within_radius", distanceM };
  return { status: "needs_review", reason: "outside_radius", distanceM };
}

/** «aprox. 20 m» / «aprox. 1,2 km» para la UI. */
export function formatDistance(m: number | null | undefined): string | null {
  if (m === null || m === undefined || !Number.isFinite(m)) return null;
  if (m < 1000) return `aprox. ${Math.max(1, Math.round(m / 5) * 5)} m`;
  return `aprox. ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(m / 1000)} km`;
}
