/** Etiquetas en español de los valores del CRM (una sola fuente para toda la UI). */
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
export const APPOINTMENT_STATUS_LABEL: Record<string, string> = { scheduled: "Programada", confirmed: "Confirmada", completed: "Realizada", cancelled: "Cancelada", no_show: "No asistió" };
export const APPOINTMENT_STATUS_TONE: Record<string, "neutral" | "success" | "danger" | "warning" | "info"> = {
  scheduled: "info",
  confirmed: "success",
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
