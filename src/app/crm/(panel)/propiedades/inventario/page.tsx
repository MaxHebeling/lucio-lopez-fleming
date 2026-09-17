import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { getInventoryAnalysis } from "@/server/ai/property/inventory";
import { Alert, Badge, EmptyState, PageHeader, Table, formatDate } from "@/components/ui";

export const metadata: Metadata = { title: "Análisis de inventario" };

/**
 * Análisis de inventario: publicaciones con días publicadas, consultas y visitas desde que se publicaron, calidad y
 * oportunidades de revisión (sin afirmar causas). Solo lectura.
 */
export default async function InventoryPage({ searchParams }: PageProps<"/crm/propiedades/inventario">) {
  const actor = await requireStaffPage("properties.read");
  const sp = await searchParams;
  const only = sp.oportunidades === "1";
  const a = await getInventoryAnalysis(getDb(), actor, { onlyOpportunities: only });

  return (
    <>
      <nav aria-label="Migas de pan" className="mb-2 text-sm text-stone">
        <Link href="/crm/propiedades" className="underline-offset-4 hover:underline">
          Propiedades
        </Link>{" "}
        / Análisis de inventario
      </nav>
      <PageHeader
        title="Análisis de inventario"
        description={`Publicaciones activas en el sitio: días publicadas, consultas y visitas desde la publicación, y calidad. Se marca una oportunidad de revisión con ${a.settings.minDaysPublished}+ días y ${a.settings.lowLeadsThreshold} consultas o menos.`}
      />
      <div className="mb-4 flex flex-col gap-2">
        {!a.canLeads ? <Alert tone="info">Las consultas por propiedad se muestran con permiso para ver los leads de todo el equipo. Sin ese dato no se marcan oportunidades.</Alert> : null}
        {!a.enabled ? <Alert tone="info">El análisis de calidad está desactivado: se muestran los números sin oportunidades.</Alert> : null}
        {a.canLeads ? (
          <p className="text-sm text-ink-2">
            {a.leadsMedian === null
              ? `Mediana de consultas: sin muestra suficiente (${a.matureCount} publicaciones con ${a.settings.minDaysPublished}+ días; se necesitan ${a.settings.minSample}).`
              : `Mediana de consultas de las ${a.matureCount} publicaciones con ${a.settings.minDaysPublished}+ días: ${a.leadsMedian}.`}{" "}
            Las oportunidades son sugerencias de revisión: no indican la causa de las pocas consultas.
          </p>
        ) : null}
        <p className="flex flex-wrap gap-3 text-sm">
          <Link href="/crm/propiedades/inventario" aria-current={!only ? "page" : undefined} className={`font-semibold underline-offset-4 ${only ? "text-stone hover:underline" : "underline"}`}>
            {only ? "Todas" : `Todas (${a.items.length})`}
          </Link>
          <Link href="/crm/propiedades/inventario?oportunidades=1" aria-current={only ? "page" : undefined} className={`font-semibold underline-offset-4 ${only ? "underline" : "text-stone hover:underline"}`}>
            Con oportunidad de revisión ({a.opportunities})
          </Link>
        </p>
      </div>

      {a.items.length === 0 ? (
        <EmptyState title={only ? "No hay oportunidades de revisión" : "No hay publicaciones activas"} description={only ? "Ninguna publicación cumple las condiciones con los datos actuales." : "Cuando se publiquen propiedades aparecen acá."} />
      ) : (
        <Table label="Análisis de inventario">
          <thead>
            <tr>
              <th scope="col">Propiedad</th>
              <th scope="col">Publicada</th>
              <th scope="col">Consultas</th>
              <th scope="col">Visitas</th>
              {a.hasPageViews ? <th scope="col">Vistas</th> : null}
              <th scope="col">Calidad</th>
              <th scope="col">Oportunidad</th>
            </tr>
          </thead>
          <tbody>
            {a.items.map((r) => (
              <tr key={r.id}>
                <td className="min-w-56">
                  <Link href={`/crm/propiedades/${r.id}`} className="font-semibold underline-offset-4 hover:underline">
                    #{r.code} · {r.title}
                  </Link>
                  <span className="block text-xs text-stone">{r.typeName}</span>
                </td>
                <td className="whitespace-nowrap text-sm">
                  {r.daysPublished === null ? "—" : `${r.daysPublished} días`}
                  {r.publishedAt ? <span className="block text-xs text-stone">desde {formatDate(r.publishedAt)}</span> : null}
                </td>
                <td className="tabular-nums">{r.leads ?? "—"}</td>
                <td className="tabular-nums">{r.visits}</td>
                {a.hasPageViews ? <td className="tabular-nums">{r.pageViews ?? "—"}</td> : null}
                <td>{r.qualityScore === null ? <span className="text-stone">—</span> : <Badge tone={r.qualityScore >= 80 ? "success" : r.qualityScore >= 55 ? "warning" : "danger"}>{r.qualityScore}</Badge>}</td>
                <td className="max-w-96 text-xs">
                  {r.opportunity ? (
                    <Link href={`/crm/propiedades/${r.id}#calidad`} className="underline-offset-4 hover:underline">
                      {r.opportunity.text}
                    </Link>
                  ) : (
                    <span className="text-stone">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
