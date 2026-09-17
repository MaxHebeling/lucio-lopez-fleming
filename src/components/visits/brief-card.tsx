/**
 * «Antes de la visita» (IA de visitas, Fase 4b). HECHOS registrados por sección, lista explícita de lo NO REGISTRADO
 * y, si hubo IA, su resumen (citando hechos) y sugerencias rotuladas como interpretación.
 */
import { Card, formatDateTime } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-button";
import type { VisitBrief } from "@/server/visits/ai-extension";
import { refreshBriefAction } from "@/app/crm/(panel)/mis-visitas/ai-actions";

const SECTION_TITLE = { cliente: "Cliente", busca: "Qué busca", pregunto: "Qué preguntó", propiedad: "Propiedad" } as const;

export function VisitBriefCard({ appointmentId, brief, canRefresh }: { appointmentId: string; brief: VisitBrief; canRefresh: boolean }) {
  const sections = (Object.keys(SECTION_TITLE) as Array<keyof typeof SECTION_TITLE>).map((s) => ({ key: s, facts: brief.facts.filter((f) => f.section === s) }));
  return (
    <Card
      title="Antes de la visita"
      actions={
        canRefresh ? (
          <ActionButton action={refreshBriefAction.bind(null, { appointmentId })} pendingLabel="Actualizando…" variant="ghost">
            Actualizar
          </ActionButton>
        ) : null
      }
    >
      <div className="flex flex-col gap-4 text-sm" data-testid="visit-brief">
        <p className="font-semibold">{brief.headline}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {sections.map(({ key, facts }) => (
            <section key={key} aria-label={SECTION_TITLE[key]}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone">{SECTION_TITLE[key]}</h3>
              {facts.length ? (
                <ul className="flex flex-col gap-1">
                  {facts.map((f) => (
                    <li key={f.id} className="break-words">
                      {f.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-stone">{key === "busca" ? "Sin datos de lo que busca (lead, oportunidad o notas)." : key === "pregunto" ? "Sin consultas ni mensajes registrados." : "—"}</p>
              )}
            </section>
          ))}
        </div>
        {brief.notRegistered.length ? (
          <section aria-label="No registrado" className="rounded-[var(--radius-md)] border border-warning/30 bg-[#fbf4e6] p-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-warning">No registrado</h3>
            <p className="mt-1 text-ink-2">Si el cliente lo pregunta, no está en la ficha: no lo afirmes, consultalo y respondé después.</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {brief.notRegistered.map((n) => (
                <li key={n} className="rounded-full border border-warning/40 bg-white px-2 py-0.5 text-xs font-semibold text-ink">
                  {n}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {brief.ai ? (
          <section aria-label="Resumen de la IA" className="rounded-[var(--radius-md)] border border-line bg-paper p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone">Resumen de la IA (cita los datos de arriba)</h3>
            <ul className="mt-1 list-disc pl-5">
              {brief.ai.points.map((p, i) => (
                <li key={i}>{p.text}</li>
              ))}
            </ul>
            {brief.ai.interpretation.length ? (
              <>
                <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-stone">Sugerencias de la IA · interpretación, no son datos</h3>
                <ul className="mt-1 list-disc pl-5 text-ink-2">
                  {brief.ai.interpretation.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}
        <p className="text-xs text-stone">{brief.generatedAt ? `Preparado ${formatDateTime(brief.generatedAt)}` : "Armado con los datos actuales"} · solo datos registrados en el CRM.</p>
      </div>
    </Card>
  );
}
