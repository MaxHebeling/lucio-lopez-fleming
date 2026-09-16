/** Etiquetas y tonos compartidos por las pantallas del CRM núcleo. */
export type Tone = "neutral" | "success" | "warning" | "danger" | "brand" | "info";

export const PROPERTY_STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  available: "success",
  reserved: "warning",
  sold: "info",
  rented: "info",
  paused: "warning",
  archived: "neutral",
};

export const SYNC_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente", tone: "warning" },
  syncing: { label: "Sincronizando", tone: "info" },
  synced: { label: "Sincronizada", tone: "success" },
  failed: { label: "Con error", tone: "danger" },
  retrying: { label: "Reintentando", tone: "warning" },
  awaiting_credentials: { label: "Sin credenciales", tone: "neutral" },
  disabled: { label: "Canal desactivado", tone: "neutral" },
};

export const INTEGRATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  disabled: { label: "Desactivada", tone: "neutral" },
  awaiting_credentials: { label: "Esperando credenciales", tone: "neutral" },
  active: { label: "Activa", tone: "success" },
  degraded: { label: "Degradada", tone: "warning" },
  error: { label: "Con error", tone: "danger" },
};

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  dead: { label: "Muertos", tone: "danger" },
  failed: { label: "Fallidos (reintentando)", tone: "warning" },
  queued: { label: "En cola", tone: "info" },
  running: { label: "En ejecución", tone: "info" },
  succeeded: { label: "Completados", tone: "success" },
  cancelled: { label: "Cancelados", tone: "neutral" },
};

export const LEAD_STATUS: Record<string, string> = {
  new: "Nuevo",
  contacted: "Contactado",
  qualified: "Calificado",
  unqualified: "No calificado",
  converted: "Convertido",
  discarded: "Descartado",
};

export const SEVERITY: Record<string, { label: string; tone: Tone }> = {
  error: { label: "Error", tone: "danger" },
  warning: { label: "Advertencia", tone: "warning" },
  info: { label: "Info", tone: "info" },
};

export const LOCATION_KIND: Record<string, string> = {
  country: "País",
  province: "Provincia",
  locality: "Localidad",
  neighborhood: "Barrio",
  gated_community: "Barrio cerrado",
  zone: "Zona",
};
