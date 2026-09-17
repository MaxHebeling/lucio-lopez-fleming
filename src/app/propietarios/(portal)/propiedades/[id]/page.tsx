import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getOwnerProperty } from "@/server/owners/portal";
import { monthLabel } from "@/server/rentals/dates";
import { Badge, formatDate, formatMoney } from "@/components/ui";
import { PROPERTY_STATUS_LABEL } from "@/components/rentals/status";
import { Empty, Section, UUID } from "../../ui";

const OPERATION_LABEL: Record<string, string> = { sale: "Venta", rent: "Alquiler", temporary_rent: "Alquiler temporario" };

export default async function OwnerPropertyPage({ params }: PageProps<"/propietarios/propiedades/[id]">) {
  const actor = await requireOwnerPage();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  let data;
  try {
    data = await getOwnerProperty(getDb(), actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { property: p, operations, activity, documents } = data;
  const totals = activity.reduce((a, m) => ({ inquiries: a.inquiries + m.inquiries, visits: a.visits + m.visits }), { inquiries: 0, visits: 0 });
  const max = Math.max(1, ...activity.map((m) => Math.max(m.inquiries, m.visits)));

  return (
    <>
      <Link href="/propietarios" className="text-sm underline underline-offset-4">
        ← Inicio
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-ink">{p.title}</h1>
      <p className="mt-1 text-sm text-stone">
        #{p.code} · {p.type_name ?? ""}
        {p.location_name ? ` · ${p.location_name}` : ""}
        {p.address_street ? ` · ${p.address_street} ${p.address_number ?? ""}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge>{PROPERTY_STATUS_LABEL[p.status] ?? p.status}</Badge>
        <Badge tone={p.is_published ? "success" : "neutral"}>{p.is_published ? `Publicada desde ${formatDate(p.published_at)}` : "No publicada"}</Badge>
        {p.is_published ? (
          <Link href={`/propiedades/${p.slug}`} className="text-sm font-semibold text-brick underline underline-offset-4" target="_blank">
            Ver publicación
          </Link>
        ) : null}
      </div>
      {operations.length ? (
        <p className="mt-3 text-sm">
          {operations.map((o) => `${OPERATION_LABEL[o.operation] ?? o.operation}: ${o.price_hidden ? "precio a consultar" : formatMoney(o.amount, o.currency)}`).join(" · ")}
        </p>
      ) : null}

      <Section title="Actividad de los últimos 12 meses">
        <p className="mb-3 text-sm text-ink-2">
          {totals.inquiries} consulta(s) y {totals.visits} visita(s) realizada(s). Se informan cantidades, sin datos de los interesados.
        </p>
        <div className="relative overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-white">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone">
              <tr>
                <th className="px-4 py-2">Mes</th>
                <th className="px-4 py-2">Consultas</th>
                <th className="px-4 py-2">Visitas</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((m) => (
                <tr key={m.month} className="border-t border-line">
                  <td className="whitespace-nowrap px-4 py-2 capitalize">{monthLabel(m.month)}</td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <span className="w-6 text-right tabular-nums">{m.inquiries}</span>
                      <span className="h-2 rounded-full bg-ink" style={{ width: `${(m.inquiries / max) * 100}px` }} aria-hidden />
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <span className="w-6 text-right tabular-nums">{m.visits}</span>
                      <span className="h-2 rounded-full bg-brick" style={{ width: `${(m.visits / max) * 100}px` }} aria-hidden />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Documentos de la propiedad">
        {documents.length === 0 ? (
          <Empty>No hay documentos compartidos para esta propiedad.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-white">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>{d.title}</span>
                <a href={`/propietarios/documentos/propiedad/${d.id}`} className="font-semibold underline underline-offset-4">
                  Descargar
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
