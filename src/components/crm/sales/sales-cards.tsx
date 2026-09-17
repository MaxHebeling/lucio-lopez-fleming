"use client";

import Link from "next/link";
import { Badge, Card, Select, Textarea } from "@/components/ui";
import { ActionButton, ActionForm, FormField, SubmitButton } from "@/components/crm/action-form";
import { DialogButton } from "@/components/crm/dialog-button";
import { acceptRecommendationAction, dismissMatchAction, dismissRecommendationAction, snoozeRecommendationAction } from "@/app/crm/(panel)/_sales/actions";
import type { NextActionItem } from "@/server/sales/nba/service";
import type { CompatiblePropertiesResult } from "@/server/sales/matching/service";

const PRIORITY = { high: { label: "Prioridad alta", tone: "danger" }, medium: { label: "Prioridad media", tone: "warning" }, low: { label: "Prioridad baja", tone: "neutral" } } as const;

/** Siguiente acción recomendada: la IA recomienda con reglas explicables; la persona acepta (crea tarea), pospone o descarta. */
export function NextActionsCard({ items, canAccept, canDecide }: { items: NextActionItem[]; canAccept: boolean; canDecide: boolean }) {
  return (
    <Card title="Siguiente acción sugerida">
      {items.length === 0 ? (
        <p className="text-sm text-stone">No hay acciones sugeridas por ahora: no hay consultas sin responder, visitas por coordinar ni datos pendientes.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((r) => {
            const key = { entityType: r.entityType, entityId: r.entityId, ruleKey: r.ruleKey, fingerprint: r.fingerprint };
            return (
              <li key={`${r.ruleKey}-${r.fingerprint}`} className="rounded-[var(--radius-md)] border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">{r.title}</p>
                  <Badge tone={PRIORITY[r.priority].tone}>{PRIORITY[r.priority].label}</Badge>
                </div>
                <p className="mt-1 text-sm text-ink-2">{r.reason}</p>
                {r.evidence.length ? (
                  <details className="mt-1.5 text-xs text-stone">
                    <summary className="cursor-pointer select-none">Por qué</summary>
                    <ul className="mt-1 list-disc pl-4">
                      {r.evidence.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <div className="mt-2.5 flex flex-wrap items-start gap-1.5">
                  {canAccept ? (
                    <ActionButton action={acceptRecommendationAction} input={key} variant="primary" pendingLabel="Creando tarea…">
                      Aceptar y crear tarea
                    </ActionButton>
                  ) : null}
                  {canDecide ? (
                    <>
                      <ActionButton action={snoozeRecommendationAction} input={{ ...key, days: 3 as const }} variant="ghost" pendingLabel="Posponiendo…">
                        Posponer 3 días
                      </ActionButton>
                      <DialogButton label="Descartar" title="Descartar la sugerencia" variant="ghost">
                        {(close) => (
                          <ActionForm action={dismissRecommendationAction} onSuccess={close} aria-label="Descartar sugerencia">
                            {Object.entries(key).map(([k, v]) => (
                              <input key={k} type="hidden" name={k} value={v} />
                            ))}
                            <p className="text-sm text-ink-2">«{r.title}» no vuelve a sugerirse mientras la situación del cliente no cambie. Queda registrado.</p>
                            <FormField name="note" label="Motivo (opcional)">
                              {(p) => <Textarea {...p} maxLength={300} placeholder="Ej.: ya hablamos por teléfono" />}
                            </FormField>
                            <div className="flex justify-end">
                              <SubmitButton variant="danger">Descartar</SubmitButton>
                            </div>
                          </ActionForm>
                        )}
                      </DialogButton>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Propiedades compatibles con el perfil del contacto (coincidencia estimada, explicable). */
export function CompatiblePropertiesCard({ contactId, result, canDismiss }: { contactId: string; result: CompatiblePropertiesResult; canDismiss: boolean }) {
  return (
    <Card title="Propiedades compatibles" actions={result.matchable ? <span className="text-xs text-stone">{result.total} con coincidencia ≥ {result.minScore} %</span> : null}>
      {!result.matchable ? (
        <p className="text-sm text-stone">Para sugerir propiedades faltan datos del perfil: {result.missing.join(" y ").toLowerCase()}.</p>
      ) : result.items.length === 0 ? (
        <p className="text-sm text-stone">Hoy no hay propiedades publicadas y disponibles que coincidan con el perfil{result.dismissed ? ` (${result.dismissed} descartadas)` : ""}.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {result.items.map((p) => (
            <li key={p.propertyId} className="py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={p.crmHref} className="font-semibold text-ink underline-offset-4 hover:underline">
                    #{p.code} · {p.title}
                  </Link>
                  <p className="text-xs text-stone">
                    {[p.typeName, p.zoneLabel, p.price].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Badge tone="info">Coincidencia estimada {p.score} %</Badge>
              </div>
              <p className="mt-1 text-sm text-ink-2">
                {p.matched.length ? <span>Coincide: {p.matched.map((m) => `✓ ${m}`).join(" ")}</span> : null}
                {p.consider.length ? <span className="block text-stone">Considerar: {p.consider.join(", ").toLowerCase()}</span> : null}
                {p.unconfirmed ? <span className="block text-xs text-warning">Usa datos del perfil sin confirmar</span> : null}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Link href={p.publicHref} target="_blank" rel="noopener" className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-semibold text-ink-2 hover:bg-paper-2">
                  Ver en el sitio
                </Link>
                {canDismiss ? (
                  <DialogButton label="Descartar" title={`Descartar #${p.code} para este cliente`} variant="ghost">
                    {(close) => (
                      <ActionForm action={dismissMatchAction} onSuccess={close} aria-label="Descartar propiedad compatible">
                        <input type="hidden" name="contactId" value={contactId} />
                        <input type="hidden" name="propertyId" value={p.propertyId} />
                        <FormField name="reason" label="Motivo">
                          {(fp) => (
                            <Select {...fp} defaultValue="" required>
                              <option value="">Elegí un motivo</option>
                              <option value="price">Precio / presupuesto</option>
                              <option value="location">Ubicación</option>
                              <option value="size">Tamaño</option>
                              <option value="type">Tipo de propiedad</option>
                              <option value="features">Características</option>
                              <option value="other">Otro motivo</option>
                            </Select>
                          )}
                        </FormField>
                        <p className="text-xs text-stone">El motivo alimenta la siguiente acción (por ejemplo, «enviar nuevas opciones» si fue por presupuesto).</p>
                        <div className="flex justify-end">
                          <SubmitButton>Descartar</SubmitButton>
                        </div>
                      </ActionForm>
                    )}
                  </DialogButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 border-t border-line pt-2 text-xs text-stone">Coincidencia estimada según el perfil y los datos publicados: no es una certeza. Nada se envía al cliente automáticamente.</p>
    </Card>
  );
}
