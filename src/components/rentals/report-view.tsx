import type { ReportData } from "@/server/reports/service";
import { formatDate, formatDateTime, formatMoney } from "@/components/ui";
import { CONTRACT_STATUS_LABEL, SETTLEMENT_STATUS_LABEL } from "@/server/rentals/schema";
import { PROPERTY_STATUS_LABEL } from "./status";

const CHANNEL_LABEL: Record<string, string> = {
  web: "Sitio web",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "Email",
  portal: "Portales",
  manual: "Carga manual",
  campaign: "Campañas",
  phone: "Teléfono",
  walk_in: "Oficina",
};
const OPERATION_LABEL: Record<string, string> = { sale: "Venta", rent: "Alquiler", temporary_rent: "Alquiler temporario" };

/** Hoja de estilos de impresión: solo el informe, sin navegación, en A4. */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 14mm; }
  body { background: #fff !important; }
  aside, header, nav, .print\\:hidden { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
  .report-sheet { border: 0 !important; box-shadow: none !important; padding: 0 !important; }
  .report-section { break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
}`;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-line px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-stone">{label}</p>
      <p className="text-lg font-bold tabular-nums text-ink">{value}</p>
    </div>
  );
}

export function ReportView({ data, publicBaseUrl }: { data: ReportData; publicBaseUrl?: string }) {
  const empty = data.properties.length === 0 && data.rentals.contracts.length === 0;
  return (
    <article className="report-sheet rounded-[var(--radius-lg)] border border-line bg-white p-5 text-ink sm:p-8">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="font-display text-3xl leading-none">Lucio López Fleming</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-brick">Informe al propietario</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold">{data.owner.name}</p>
          <p className="text-stone">
            Período {formatDate(data.period.start)} al {formatDate(data.period.end)}
          </p>
          <p className="text-xs text-stone">Generado {formatDateTime(data.generatedAt)}</p>
        </div>
      </div>

      {empty ? <p className="mt-6 text-sm text-stone">No hay propiedades ni contratos asociados a este propietario en el período.</p> : null}

      {data.properties.map((p) => (
        <section key={p.id} className="report-section mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">
              {p.title} <span className="text-sm font-normal text-stone">#{p.code}</span>
            </h2>
            <p className="text-sm">
              {PROPERTY_STATUS_LABEL[p.status] ?? p.status} · {p.isPublished ? "Publicada" : "No publicada"}
              {p.publicPath ? (
                <>
                  {" · "}
                  <a href={`${publicBaseUrl ?? ""}${p.publicPath}`} className="underline underline-offset-4">
                    ver publicación
                  </a>
                </>
              ) : null}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Consultas" value={p.inquiries.total} />
            <Stat label="Visitas realizadas" value={p.visits.completed} />
            <Stat label="Visitas agendadas" value={p.visits.scheduled} />
            <Stat label="Visitas canceladas / ausentes" value={p.visits.cancelled + p.visits.noShow} />
          </div>
          {p.inquiries.byChannel.length ? (
            <p className="mt-2 text-xs text-stone">Consultas por canal: {p.inquiries.byChannel.map((c) => `${CHANNEL_LABEL[c.channel] ?? c.channel} ${c.count}`).join(" · ")}</p>
          ) : null}
          {p.priceChanges.length ? (
            <div className="mt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Cambios de precio</h3>
              <ul className="mt-1 text-sm">
                {p.priceChanges.map((c, i) => (
                  <li key={i}>
                    {formatDate(c.date)} · {OPERATION_LABEL[c.operation] ?? c.operation}: {c.previousAmount ? formatMoney(c.previousAmount, c.previousCurrency ?? c.newCurrency) : "sin precio"} →{" "}
                    {c.newAmount ? formatMoney(c.newAmount, c.newCurrency) : "a consultar"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.statusChanges.length ? (
            <div className="mt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Cambios de estado</h3>
              <ul className="mt-1 text-sm">
                {p.statusChanges.map((c, i) => (
                  <li key={i}>
                    {formatDate(c.date)} · {c.from ? (PROPERTY_STATUS_LABEL[c.from] ?? c.from) : "—"} → {PROPERTY_STATUS_LABEL[c.to] ?? c.to}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ))}

      {data.rentals.contracts.length ? (
        <section className="report-section mt-8 border-t border-line pt-6">
          <h2 className="text-lg font-bold">Alquileres</h2>
          <ul className="mt-2 text-sm">
            {data.rentals.contracts.map((c) => (
              <li key={c.code}>
                {c.code} · {c.propertyTitle} · {CONTRACT_STATUS_LABEL[c.status] ?? c.status} · alquiler vigente {formatMoney(c.currentRent, c.currency)}
                {c.sharePct && c.sharePct !== "100.00" ? ` · su parte ${c.sharePct}%` : ""}
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Cuotas con vencimiento en el período</h3>
              {data.rentals.dues.length ? (
                <ul className="mt-1 text-sm">
                  {data.rentals.dues.map((d) => (
                    <li key={d.currency}>
                      {d.count} cuota(s) por {formatMoney(d.amount, d.currency)} · cobrado {formatMoney(d.paid, d.currency)}
                      {d.overdue ? ` · ${d.overdue} vencida(s)` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-stone">Sin vencimientos en el período.</p>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Cobros del período</h3>
              {data.rentals.collected.length ? (
                <ul className="mt-1 text-sm">
                  {data.rentals.collected.map((c) => (
                    <li key={c.currency}>
                      {c.count} cobro(s) por {formatMoney(c.amount, c.currency)} (total del contrato)
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-stone">Sin cobros registrados en el período.</p>
              )}
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Liquidaciones</h3>
            {data.rentals.settlements.length ? (
              <div className="mt-1 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm [&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-0 [&_th:first-child]:pl-0">
                  <thead className="text-xs text-stone">
                    <tr>
                      <th className="py-1">Mes</th>
                      <th>Contrato</th>
                      <th className="text-right">Cobrado</th>
                      <th className="text-right">Honorario</th>
                      <th className="text-right">Deducciones</th>
                      <th className="text-right">Neto</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rentals.settlements.map((s, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="py-1">{s.periodStart.slice(0, 7)}</td>
                        <td>{s.code}</td>
                        <td className="text-right">{formatMoney(s.gross, s.currency)}</td>
                        <td className="text-right">{formatMoney(s.fee, s.currency)}</td>
                        <td className="text-right">{formatMoney(s.deductions, s.currency)}</td>
                        <td className="text-right font-semibold">{formatMoney(s.net, s.currency)}</td>
                        <td>{SETTLEMENT_STATUS_LABEL[s.status] ?? s.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-1 text-sm text-stone">Sin liquidaciones aprobadas en el período.</p>
            )}
          </div>
        </section>
      ) : null}

      <div className="mt-8 border-t border-line pt-3 text-[11px] text-stone">
        Datos tomados del sistema de gestión de Lucio López Fleming Inmobiliaria al momento de generar el informe. Las consultas y visitas se informan como cantidades, sin datos personales de los interesados.
      </div>
    </article>
  );
}
