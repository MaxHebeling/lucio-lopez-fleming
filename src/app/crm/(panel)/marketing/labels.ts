export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

export const POST_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Borrador", tone: "neutral" },
  in_review: { label: "En revisión", tone: "info" },
  approved: { label: "Aprobada", tone: "success" },
  scheduled: { label: "Programada", tone: "info" },
  publishing: { label: "Publicando", tone: "info" },
  published: { label: "Publicada", tone: "success" },
  failed: { label: "Con error", tone: "danger" },
  rejected: { label: "Rechazada", tone: "warning" },
};

export const CHANNEL_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook" };

export const GENERATED_BY: Record<string, string> = { template: "Plantilla", ai: "IA", human: "Editado por el equipo" };
