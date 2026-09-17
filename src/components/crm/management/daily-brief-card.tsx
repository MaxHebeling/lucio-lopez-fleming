import Link from "next/link";
import type { DailyBriefView } from "@/server/ai/brief/service";
import { formatDateTime } from "@/components/ui";

const TONE: Record<"danger" | "warning" | "info", string> = {
  danger: "text-danger",
  warning: "text-warning",
  info: "text-ink",
};

/**
 * «Resumen de hoy» al tope del Tablero. Componente de servidor (sin JS propio): conteos reales con link a la lista
 * filtrada; la redacción con IA (si hay clave) va rotulada y separa hechos de interpretación.
 */
export function DailyBriefCard({ brief, refreshAction, headingLevel = 2 }: { brief: DailyBriefView; refreshAction?: () => Promise<void>; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const own = brief.items.length > 0 && brief.items.every((i) => i.scope === "own");
  return (
    <section aria-labelledby="resumen-de-hoy" className="rounded-[var(--radius-lg)] border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <H id="resumen-de-hoy" className="font-display text-xl leading-tight text-ink">
            Resumen de hoy
          </H>
          <p className="mt-0.5 text-sm text-ink-2">
            {brief.greeting}
            {brief.name ? `, ${brief.name}` : ""}.{" "}
            {brief.items.length
              ? own
                ? "Esto es lo tuyo que necesita atención."
                : "Esto es lo que necesita atención en el equipo."
              : "Todo al día: no hay visitas para hoy ni pendientes que destacar en lo que podés ver."}
          </p>
        </div>
        {refreshAction ? (
          <form action={refreshAction}>
            <button type="submit" className="rounded-[var(--radius-md)] border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:border-ink hover:text-ink">
              Actualizar
            </button>
          </form>
        ) : null}
      </div>

      {brief.narrative ? (
        <div className="mt-3 rounded-[var(--radius-md)] bg-paper px-3 py-2 text-sm">
          <p>
            <span className="font-semibold">Hechos: </span>
            {brief.narrative.hechos}
          </p>
          {brief.narrative.interpretacion.length ? (
            <p className="mt-1 text-ink-2">
              <span className="font-semibold">Interpretación de la IA (no son datos): </span>
              {brief.narrative.interpretacion.join(" ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {brief.items.length ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {brief.items.map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="flex h-full items-center gap-3 rounded-[var(--radius-md)] border border-line px-3 py-2 hover:border-ink">
                <span className={`min-w-8 text-2xl font-bold tabular-nums ${TONE[i.tone]}`}>{i.count.toLocaleString("es-AR")}</span>
                <span className="text-sm font-semibold text-ink">{i.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-stone">
        <span>Calculado {formatDateTime(brief.computedAt)} con datos del CRM{brief.narrative ? " · redacción con IA verificada contra los conteos" : ""}.</span>
        {brief.items.length ? (
          <details>
            <summary className="cursor-pointer select-none font-semibold text-ink-2">¿Cómo se calcula?</summary>
            <ul className="mt-1 list-disc pl-4">
              {brief.items.map((i) => (
                <li key={i.key}>
                  <span className="font-semibold">{i.label}:</span> {i.definition}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}
