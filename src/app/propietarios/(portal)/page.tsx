import Link from "next/link";
import { requireOwnerPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { ownerDashboard } from "@/server/owners/portal";
import { monthLabel } from "@/server/rentals/dates";
import { Badge, formatDate, formatMoney } from "@/components/ui";
import { ContractStatus, PROPERTY_STATUS_LABEL, ReportStatus, SettlementStatus } from "@/components/rentals/status";
import { Empty, Section } from "./ui";

export default async function OwnerHome() {
  const actor = await requireOwnerPage();
  const { properties, contracts, settlements, reports } = await ownerDashboard(getDb(), actor);
  const first = actor.fullName.split(" ")[0];

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold text-ink">Hola, {first}</h1>

      <Section title="Tus propiedades">
        {properties.length === 0 ? (
          <Empty>No hay propiedades asociadas a tu cuenta. Si creés que es un error, contactanos.</Empty>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {properties.map((p) => (
              <li key={p.id}>
                <Link href={`/propietarios/propiedades/${p.id}`} className="block rounded-[var(--radius-lg)] border border-line bg-white p-4 transition-colors hover:border-ink">
                  <p className="font-semibold text-ink">{p.title}</p>
                  <p className="mt-0.5 text-xs text-stone">
                    #{p.code} · {p.type_name ?? ""}
                    {p.location_name ? ` · ${p.location_name}` : ""}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    <Badge>{PROPERTY_STATUS_LABEL[p.status] ?? p.status}</Badge>
                    <Badge tone={p.is_published ? "success" : "neutral"}>{p.is_published ? "Publicada" : "No publicada"}</Badge>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Contratos de alquiler">
        {contracts.length === 0 ? (
          <Empty>No tenés contratos de alquiler administrados por la inmobiliaria.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {contracts.map((c) => (
              <li key={c.id}>
                <Link href={`/propietarios/contratos/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-line bg-white p-4 hover:border-ink">
                  <span className="min-w-0">
                    <span className="block font-semibold">{c.property_title}</span>
                    <span className="block text-xs text-stone">
                      Contrato {c.code} · {formatDate(c.start_date)} al {formatDate(c.end_date)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-sm">
                    <span className="font-semibold">{formatMoney(c.current_rent, c.currency)}</span>
                    <ContractStatus status={c.status} />
                    {c.overdue_count > 0 ? <Badge tone="danger">{c.overdue_count} cuota(s) vencida(s)</Badge> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
        <Section
          title="Liquidaciones"
          action={
            settlements.length ? (
              <Link href="/propietarios/liquidaciones" className="text-sm underline underline-offset-4">
                Ver todas
              </Link>
            ) : null
          }
        >
          {settlements.length === 0 ? (
            <Empty>Todavía no hay liquidaciones aprobadas.</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-white">
              {settlements.map((s) => (
                <li key={s.id}>
                  <Link href={`/propietarios/liquidaciones/${s.id}`} className="flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-paper">
                    <span className="capitalize">
                      {monthLabel(s.period_start)}
                      <span className="block text-xs normal-case text-stone">{s.property_title}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-semibold">{formatMoney(s.net_amount, s.currency)}</span>
                      <SettlementStatus status={s.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section
          title="Informes"
          action={
            reports.length ? (
              <Link href="/propietarios/informes" className="text-sm underline underline-offset-4">
                Ver todos
              </Link>
            ) : null
          }
        >
          {reports.length === 0 ? (
            <Empty>Cuando la inmobiliaria te envíe un informe, lo vas a ver acá.</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-white">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link href={`/propietarios/informes/${r.id}`} className="flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-paper">
                    <span>
                      {formatDate(r.period_start)} al {formatDate(r.period_end)}
                      <span className="block text-xs text-stone">{r.property_title ?? "Todas tus propiedades"}</span>
                    </span>
                    <ReportStatus status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
