/**
 * Panel «Calidad de la publicación» de la ficha del CRM (servidor). Muestra el informe determinista del job
 * `ai.property_quality`: porcentaje, faltantes accionables con link a la sección exacta y avisos. No modifica nada.
 */
import Link from "next/link";
import { Badge, Card, formatDateTime } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-button";
import type { QualityView } from "@/server/ai/property/quality";
import type { Finding, PriceCheck } from "@/server/ai/property/quality-rules";
import { recomputeQualityAction } from "@/app/crm/(panel)/propiedades/[id]/ai-actions";

const SEVERITY: Record<Finding["severity"], { label: string; tone: "danger" | "warning" | "info" }> = {
  error: { label: "Importante", tone: "danger" },
  warning: { label: "A revisar", tone: "warning" },
  info: { label: "Sugerencia", tone: "info" },
};

function scoreTone(score: number) {
  return score >= 80 ? { bar: "bg-success", text: "text-success", label: "Buena" } : score >= 55 ? { bar: "bg-warning", text: "text-warning", label: "Mejorable" } : { bar: "bg-danger", text: "text-danger", label: "Baja" };
}

function SectionLink({ href, children }: { href: string | null; children: string }) {
  if (!href) return null;
  const cls = "shrink-0 text-xs font-semibold underline underline-offset-4 hover:text-brick";
  // Las anclas de la misma ficha se resuelven con <a> (scroll en la página); el resto navega.
  return href.startsWith("#") ? (
    <a href={href} className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

function localHref(href: string | null, propertyId: string): string | null {
  if (!href) return null;
  const same = `/crm/propiedades/${propertyId}#`;
  return href.startsWith(same) ? href.slice(same.length - 1) : href;
}

function priceNote(p: PriceCheck | undefined): string | null {
  if (!p) return null;
  if (p.status === "insufficient_sample") return `Precio: sin comparación por falta de muestra (${p.sample} comparables del mismo tipo, operación, moneda y zona; se necesitan ${p.minSample}).`;
  if (p.status === "in_range") return `Precio por m² dentro del rango de ${p.sample} comparables (no es una tasación).`;
  return null;
}

export function QualityPanel({ propertyId, report, canRecompute }: { propertyId: string; report: QualityView | null; canRecompute: boolean }) {
  if (!report) {
    return (
      <Card title="Calidad de la publicación">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-stone">Todavía no se calculó el informe de esta ficha. Se calcula solo al guardar cambios y cada noche.</p>
          {canRecompute ? (
            <ActionButton action={recomputeQualityAction.bind(null, propertyId)} pendingLabel="Calculando…">
              Calcular ahora
            </ActionButton>
          ) : null}
        </div>
      </Card>
    );
  }
  const tone = scoreTone(report.score);
  const missing = report.criteria.filter((c) => !c.ok);
  const notices = report.findings.filter((f) => !f.code.startsWith("missing_"));
  const media = report.mediaSummary as QualityView["mediaSummary"] & { priceCheck?: PriceCheck };
  const note = priceNote(media.priceCheck);
  return (
    <Card
      title="Calidad de la publicación"
      actions={
        canRecompute ? (
          <ActionButton action={recomputeQualityAction.bind(null, propertyId)} pendingLabel="Recalculando…" variant="ghost">
            Recalcular
          </ActionButton>
        ) : null
      }
    >
      <div className="flex flex-col gap-5" data-testid="quality-panel">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <p className="flex items-baseline gap-2">
            <span className={`text-4xl font-bold tabular-nums ${tone.text}`}>{report.score}</span>
            <span className="text-sm text-stone">/ 100 · {tone.label}</span>
          </p>
          <div className="min-w-48 flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-paper-2" role="meter" aria-valuenow={report.score} aria-valuemin={0} aria-valuemax={100} aria-label={`Calidad de la publicación: ${report.score} de 100`}>
              <div className={`h-full ${tone.bar}`} style={{ width: `${report.score}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-stone">
              Completitud {report.completenessScore}/100{report.score < report.completenessScore ? ` · −${report.completenessScore - report.score} por avisos` : ""} · Actualizado {formatDateTime(report.computedAt)}
              {report.stale ? " · hay cambios posteriores: se recalcula en segundo plano" : ""}
            </p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section aria-labelledby={`q-missing-${propertyId}`}>
            <h3 id={`q-missing-${propertyId}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone">
              Qué falta ({missing.length})
            </h3>
            {missing.length ? (
              <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-md)] border border-line">
                {missing.map((c) => (
                  <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>
                      {c.label} <span className="text-xs text-stone">· {c.weight} pts</span>
                    </span>
                    <SectionLink href={localHref(c.href, propertyId)}>Completar</SectionLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-success">No falta nada de lo que mide el score.</p>
            )}
          </section>
          <section aria-labelledby={`q-notices-${propertyId}`}>
            <h3 id={`q-notices-${propertyId}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone">
              Avisos ({notices.length})
            </h3>
            {notices.length ? (
              <ul className="flex flex-col gap-2">
                {notices.map((f, i) => (
                  <li key={`${f.code}-${i}`} className="rounded-[var(--radius-md)] border border-line px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-semibold">
                        <Badge tone={SEVERITY[f.severity].tone} className="mr-1.5 align-[1px]">
                          {SEVERITY[f.severity].label}
                        </Badge>
                        {f.title}
                      </span>
                      <SectionLink href={localHref(f.href, propertyId)}>Revisar</SectionLink>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-ink-2">{f.detail}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">Sin inconsistencias ni problemas detectados.</p>
            )}
          </section>
        </div>

        <p className="text-xs text-stone">
          Fotos: {media.images} · {media.analyzed} analizadas{media.external ? ` · ${media.external} externas sin analizar` : ""}
          {note ? ` · ${note}` : ""} Reglas explicadas en la guía del CRM («Calidad de la publicación»). El informe nunca modifica la ficha.
        </p>
      </div>
    </Card>
  );
}
