/** DTOs del copiloto «✦ Asistente IA» (servidor ↔ panel). Sin tipos del proveedor ni de la base. */
import { z } from "zod";
import type { ToolItem } from "../core/registry";

export const COPILOT_MODES = ["assistant", "analyst"] as const;
export type CopilotMode = (typeof COPILOT_MODES)[number];

export const copilotAskSchema = z
  .object({
    mode: z.enum(COPILOT_MODES),
    question: z.string().trim().max(1000).optional(),
    quickQueryId: z
      .string()
      .regex(/^[a-z_]{2,40}$/)
      .optional(),
    /** Ruta actual del CRM (el servidor re-valida el registro antes de usarlo). */
    path: z.string().max(300).optional(),
    conversationId: z.uuid().optional(),
  })
  .refine((v) => (v.question?.length ?? 0) >= 2 || Boolean(v.quickQueryId), { message: "Escribí una pregunta", path: ["question"] });
export type CopilotAskInput = z.input<typeof copilotAskSchema>;

export const copilotStatusSchema = z.object({ path: z.string().max(300).optional() });

export const copilotFeedbackSchema = z.object({
  messageId: z.uuid(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().trim().max(1000).optional(),
});
export type CopilotFeedbackInput = z.input<typeof copilotFeedbackSchema>;

export type CopilotFactGroup = {
  title: string;
  summary: string;
  items: ToolItem[];
  total: number;
  truncated: boolean;
  source: { label: string; href: string | null };
  scope: "own" | "all" | null;
  period?: string | null;
};

export type GuideExcerpt = { heading: string; document: string; excerpt: string; href: string | null };

/** ai = redactado por el modelo (validado) · guide = fragmentos de la guía sin modelo · data = datos directos del CRM */
export type GeneratedBy = "ai" | "guide" | "data";

export type CopilotAnswer = {
  conversationId: string;
  messageId: string;
  mode: CopilotMode;
  text: string;
  guide: GuideExcerpt[];
  facts: CopilotFactGroup[];
  interpretation: string[];
  generatedBy: GeneratedBy;
  /** Estado honesto cuando la IA no respondió (sin clave, presupuesto, falla, guarda). */
  notice: string | null;
  suggestion: { mode: CopilotMode; label: string; quickQueryId?: string } | null;
};

export type CopilotStatus = {
  aiConfigured: boolean;
  budgetExhausted: boolean;
  notice: string | null;
  screen: { moduleLabel: string | null; entityLabel: string | null; entityIgnored: boolean } | null;
  quickQueries: Array<{ id: string; label: string }>;
  knowledgeReady: boolean;
  shortcut: string;
};
