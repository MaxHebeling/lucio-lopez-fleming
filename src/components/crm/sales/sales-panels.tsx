import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import type { IntentSignal, IntentLevel } from "@/server/sales/signals/rules";
import type { LeadSummary } from "@/server/sales/qualification/summary";
import type { CompatibleClient } from "@/server/sales/matching/service";

const LEVEL = { high: { label: "Alta", tone: "danger" }, medium: { label: "Media", tone: "warning" }, low: { label: "Baja", tone: "neutral" } } as const;

/** Señales de interés explicables (solo hechos registrados; sesiones del sitio vinculadas al enviar una consulta). */
export function IntentSignalsCard({ level, signals, linkedSessions }: { level: IntentLevel | null; signals: IntentSignal[]; linkedSessions: number }) {
  return (
    <Card title="Señales de interés" actions={level ? <Badge tone={LEVEL[level].tone}>Interés {LEVEL[level].label.toLowerCase()}</Badge> : null}>
      {signals.length ? (
        <ul className="flex flex-col gap-1.5 text-sm text-ink-2">
          {signals.map((s) => (
            <li key={`${s.key}-${s.propertyCode ?? ""}`} className="flex gap-2">
              <span aria-hidden className="text-brick">
                •
              </span>
              {s.label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stone">Sin señales registradas.</p>
      )}
      <p className="mt-2 text-xs text-stone">
        {linkedSessions ? `${linkedSessions} ${linkedSessions === 1 ? "sesión del sitio vinculada" : "sesiones del sitio vinculadas"} al enviar consultas.` : "Ninguna sesión del sitio vinculada."} Solo se vinculan al enviar una consulta.
      </p>
    </Card>
  );
}

/** Resumen del lead: lo capturado + perfil, con origen y estado, y lo que falta averiguar (sin interrogatorio). */
export function LeadQualificationCard({ summary, contactHref }: { summary: LeadSummary; contactHref: string }) {
  return (
    <Card title="Resumen del lead" actions={<Badge tone={summary.completeness >= 67 ? "success" : summary.completeness >= 34 ? "warning" : "neutral"}>{summary.completeness} % completo</Badge>}>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {summary.rows.map((r) => (
          <div key={r.key} className="min-w-0">
            <dt className="text-xs text-stone">{r.label}</dt>
            <dd className={r.value ? "break-words text-ink" : "text-stone"}>
              {r.value ?? "Sin dato"}
              {r.note ? <span className={`block text-xs ${r.confirmed ? "text-success" : "text-warning"}`}>{r.note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {summary.missing.length ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone">Para averiguar en la conversación</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {summary.missing.map((m) => (
              <li key={m}>
                <Badge>{m}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-stone">
        Los datos sugeridos se confirman en el{" "}
        <Link href={`${contactHref}#perfil`} className="font-semibold underline underline-offset-4">
          perfil del contacto
        </Link>
        .
      </p>
    </Card>
  );
}

/** Clientes compatibles con una propiedad (match inverso), solo los contactos que el usuario puede ver. */
export function CompatibleClientsCard({ items, total, scope, available, minScore }: { items: CompatibleClient[]; total: number; scope: "own" | "all"; available: boolean; minScore: number }) {
  return (
    <Card title="Clientes compatibles" actions={<span className="text-xs text-stone">{scope === "own" ? "Tus clientes" : "Todo el equipo"}</span>}>
      <div id="clientes-compatibles" className="scroll-mt-24" />
      {!available ? (
        <p className="text-sm text-stone">Se calculan cuando la propiedad está publicada y disponible.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-stone">Ningún cliente{scope === "own" ? " tuyo" : ""} tiene un perfil compatible (coincidencia ≥ {minScore} %).</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((c) => (
            <li key={c.contactId} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={c.href} className="font-semibold text-ink underline-offset-4 hover:underline">
                  {c.name}
                </Link>
                <span className="flex items-center gap-1.5">
                  {c.status === "dismissed" ? <Badge>Descartada por el cliente</Badge> : null}
                  {c.notifiedAt ? <Badge tone="neutral">Aviso enviado al agente</Badge> : null}
                  <Badge tone="info">{c.score} %</Badge>
                </span>
              </div>
              <p className="mt-0.5 text-xs text-ink-2">
                {c.matched.length ? `Coincide: ${c.matched.map((m) => `✓ ${m}`).join(" ")}` : null}
                {c.consider.length ? <span className="block text-stone">Considerar: {c.consider.join(", ").toLowerCase()}</span> : null}
                {c.unconfirmed ? <span className="block text-warning">Perfil con datos sin confirmar</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
      {total > items.length ? <p className="mt-2 text-xs text-stone">Mostrando {items.length} de {total}.</p> : null}
      <p className="mt-3 border-t border-line pt-2 text-xs text-stone">Coincidencia estimada. Nadie es contactado automáticamente: decidí vos a quién ofrecerla.</p>
    </Card>
  );
}
