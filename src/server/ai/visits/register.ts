/** Registra la IA de visitas (Fase 4b) en los puntos de extensión del núcleo de visitas. Importar por efecto. */
import { registerVisitAi } from "../../visits/ai-extension";
import { followUpSuggestion, getVisitBriefView, storedReportProposal } from "./service";

registerVisitAi({
  buildVisitBrief: ({ db, actor }, { appointmentId }) => getVisitBriefView(db, actor, appointmentId),
  structureVisitReport: ({ db, actor }, { appointmentId, text }) => storedReportProposal(db, actor, appointmentId, text),
  draftThankYouMessage: async ({ db, actor }, { appointmentId }) => {
    const { loadVisit } = await import("../../visits/access");
    const v = await loadVisit(db, actor, appointmentId);
    const row = await db.selectFrom("visit_ai_outputs").select("content").where("appointment_id", "=", v.id).where("kind", "=", "thanks_draft").executeTakeFirst();
    return row ? ((row.content as { message?: string }).message ?? null) : null;
  },
  suggestFollowUp: ({ db, actor }, { appointmentId }) => followUpSuggestion(db, actor, appointmentId),
});
