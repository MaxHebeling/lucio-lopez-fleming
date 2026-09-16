import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { globalSearch } from "@/server/search/global";
import { STATUS_LABEL, type PropertyStatus } from "@/server/properties/schema";
import { Badge, Card, PageHeader } from "@/components/ui";
import { PROPERTY_STATUS_TONE } from "@/components/crm/labels";
import { first } from "../_lib/params";

export const metadata: Metadata = { title: "Buscar" };

export default async function SearchPage({ searchParams }: PageProps<"/crm/buscar">) {
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const q = first(sp, "q") ?? "";
  const r = await globalSearch(getDb(), actor, q, 20);
  const short = r.query.length < 2 && !/^\d+$/.test(r.query);

  return (
    <>
      <PageHeader title="Buscar" description={r.query ? `Resultados para “${r.query}”` : "Buscá propiedades por código, título o dirección y contactos por nombre, email o teléfono."} />
      <form method="get" role="search" className="mb-5 flex max-w-xl gap-2">
        <label htmlFor="s-q" className="sr-only">
          Buscar
        </label>
        <input id="s-q" name="q" type="search" defaultValue={q} autoFocus className="h-10 w-full rounded-[var(--radius-md)] border border-line bg-white px-3 text-sm focus:border-ink focus:outline-none" placeholder="Código, título, nombre, email o teléfono" />
        <button type="submit" className="h-10 rounded-[var(--radius-md)] bg-ink px-4 text-sm font-semibold text-paper">
          Buscar
        </button>
      </form>
      {short ? (
        <p className="text-sm text-stone">Escribí al menos 2 caracteres (o un código de propiedad).</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {r.properties ? (
            <Card title={`Propiedades (${r.properties.length})`}>
              {r.properties.length ? (
                <ul className="flex flex-col divide-y divide-line text-sm">
                  {r.properties.map((p) => (
                    <li key={p.id} className="py-2">
                      <Link href={`/crm/propiedades/${p.id}`} className="font-semibold underline-offset-4 hover:underline">
                        #{p.code} · {p.title}
                      </Link>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone">
                        <Badge tone={PROPERTY_STATUS_TONE[p.status]}>{STATUS_LABEL[p.status as PropertyStatus] ?? p.status}</Badge>
                        {p.is_published ? <Badge tone="success">Publicada</Badge> : null}
                        {p.address_street}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-stone">Sin propiedades que coincidan.</p>
              )}
            </Card>
          ) : null}
          {r.contacts ? (
            <Card title={`Contactos (${r.contacts.length})`}>
              {r.contacts.length ? (
                <ul className="flex flex-col divide-y divide-line text-sm">
                  {r.contacts.map((c) => (
                    <li key={c.id} className="py-2">
                      <Link href={`/crm/contactos/${c.id}`} className="font-semibold underline-offset-4 hover:underline">
                        {c.display_name}
                      </Link>
                      {c.email ? <span className="block text-xs text-stone">{c.email}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-stone">Sin contactos que coincidan.</p>
              )}
            </Card>
          ) : null}
          {!r.properties && !r.contacts ? <p className="text-sm text-stone">Tu rol no tiene acceso a propiedades ni contactos.</p> : null}
        </div>
      )}
    </>
  );
}
