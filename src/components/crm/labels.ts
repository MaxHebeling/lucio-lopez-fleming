/** Etiquetas y tonos en español de los valores del CRM (una sola fuente para toda la UI). */
export const CONTACT_ROLE_LABEL: Record<string, string> = {
  owner: "Propietario",
  buyer: "Comprador",
  prospect: "Interesado",
  tenant: "Inquilino",
  guarantor: "Garante",
  supplier: "Proveedor",
  other: "Otro",
};

export const DOCUMENT_TYPE_LABEL: Record<string, string> = { dni: "DNI", cuit: "CUIT", cuil: "CUIL", passport: "Pasaporte", other: "Otro" };

export const LEAD_STATUS_LABEL: Record<string, string> = {
  new: "Nuevo",
  contacted: "Contactado",
  qualified: "Calificado",
  unqualified: "No califica",
  converted: "Convertido",
  discarded: "Descartado",
};

export const LEAD_STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "brand" | "info"> = {
  new: "warning",
  contacted: "info",
  qualified: "success",
  unqualified: "neutral",
  converted: "brand",
  discarded: "neutral",
};

export const PRIORITY_LABEL: Record<string, string> = { low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente" };
export const PRIORITY_TONE: Record<string, "neutral" | "warning" | "danger" | "info"> = { low: "neutral", normal: "neutral", high: "warning", urgent: "danger" };

export const INTEREST_LABEL: Record<string, string> = {
  sale: "Compra",
  rent: "Alquiler",
  temporary_rent: "Alquiler temporario",
  appraisal: "Tasación",
  sell_my_property: "Vender su propiedad",
  other: "Otro",
};

export const OPERATION_LABEL: Record<string, string> = { sale: "Venta", rent: "Alquiler", temporary_rent: "Alquiler temporario" };

export const OPP_STATUS_LABEL: Record<string, string> = { open: "Abierta", won: "Ganada", lost: "Perdida", paused: "Pausada" };
export const OPP_STATUS_TONE: Record<string, "neutral" | "success" | "danger" | "warning" | "info"> = { open: "info", won: "success", lost: "danger", paused: "warning" };

export const TASK_KIND_LABEL: Record<string, string> = { task: "Tarea", call: "Llamada", meeting: "Reunión", follow_up: "Seguimiento", email: "Email", whatsapp: "WhatsApp" };
export const TASK_STATUS_LABEL: Record<string, string> = { open: "Pendiente", done: "Hecha", cancelled: "Cancelada" };

export const APPOINTMENT_KIND_LABEL: Record<string, string> = { visit: "Visita", call: "Llamada", meeting: "Reunión", follow_up: "Seguimiento" };
export const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Programada",
  confirmed: "Confirmada",
  en_route: "En camino",
  checked_in: "Check-in",
  in_progress: "En curso",
  completed: "Realizada",
  cancelled: "Cancelada",
  no_show: "No asistió",
};
export const APPOINTMENT_STATUS_TONE: Record<string, "neutral" | "success" | "danger" | "warning" | "info"> = {
  scheduled: "info",
  confirmed: "success",
  en_route: "info",
  checked_in: "success",
  in_progress: "warning",
  completed: "neutral",
  cancelled: "danger",
  no_show: "warning",
};

export const DUPLICATE_REASON_LABEL: Record<string, string> = {
  same_email: "Mismo email",
  same_phone: "Mismo teléfono",
  similar_name_and_phone: "Nombre y teléfono parecidos",
  same_document: "Mismo documento",
};

export const FIRST_CONTACT_CHANNEL_LABEL: Record<string, string> = { call: "Llamada", whatsapp: "WhatsApp", email: "Email", in_person: "En persona", other: "Otro" };

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
