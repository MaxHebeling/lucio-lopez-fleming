import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { listProperties, parsePropertyFilters, propertyFormOptions, PROPERTY_SORTS, type PropertyListItem } from "@/server/properties/queries";
import { OPERATION_LABEL, PROPERTY_STATUSES, STATUS_LABEL, type Operation, type PropertyStatus } from "@/server/properties/schema";
import { Badge, ButtonLink, EmptyState, Field, formatDate, formatMoney, Input, PageHeader, Select, Table, buttonClass } from "@/components/ui";
import { PaginationBar } from "@/components/crm/pagination";
import { PROPERTY_STATUS_TONE } from "@/components/crm/labels";

export const metadata: Metadata = { title: "Propiedades" };

const SORT_LABEL: Record<(typeof PROPERTY_SORTS)[number], string> = {
  updated_desc: "Última modificación",
  created_desc: "Más recientes",
  code_desc: "Código (mayor primero)",
  code_asc: "Código (menor primero)",
  title_asc: "Título (A-Z)",
  price_asc: "Precio (menor primero)",
  price_desc: "Precio (mayor primero)",
};

const FILTER_KEYS = ["q", "status", "published", "typeKey", "operation", "currency", "priceMin", "priceMax", "branchId", "agentId", "sort"] as const;

function price(p: PropertyListItem) {
  if (!p.operations.length) return <span className="text-stone">Sin operación</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {p.operations.map((o) => (
        <li key={o.operation} className="whitespace-nowrap">
          <span className="text-xs text-stone">{OPERATION_LABEL[o.operation as Operation] ?? o.operation}: </span>
          <span className="font-semibold">{o.price_hidden ? "Consultar" : formatMoney(o.amount === null ? null : String(o.amount), o.currency)}</span>
        </li>
      ))}
    </ul>
  );
}

function Thumb({ p }: { p: PropertyListItem }) {
  const src = p.cover_file_id ? `/api/files/${p.cover_file_id}` : p.cover_source_url;
  if (!src) return <div className="flex size-full items-center justify-center bg-paper-2 text-[10px] text-stone">Sin foto</div>;
  return <Image src={src} alt="" fill unoptimized sizes="96px" className="object-cover" />;
}

export default async function PropertiesPage({ searchParams }: PageProps<"/crm/propiedades">) {
  const actor = await requireStaffPage("properties.read");
  const sp = await searchParams;
  const filters = parsePropertyFilters(sp);
  const db = getDb();
  const [result, options] = await Promise.all([listProperties(db, actor, filters), propertyFormOptions(db, actor)]);
  const params = Object.fromEntries(FILTER_KEYS.map((k) => [k, filters[k] === undefined ? undefined : String(filters[k])]));
  const advancedActive = ["published", "operation", "currency", "priceMin", "priceMax", "branchId", "agentId"].some((k) => params[k] !== undefined);
  const anyFilter = FILTER_KEYS.some((k) => k !== "sort" && params[k] !== undefined);

  return (
    <>
      <PageHeader
        title="Propiedades"
        description="Buscá por código, título o dirección. Las archivadas se ven filtrando por estado."
        actions={can(actor, "properties.create") ? <ButtonLink href="/crm/propiedades/nueva">Nueva propiedad</ButtonLink> : null}
      />

      <form method="get" action="/crm/propiedades" className="mb-5 flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-white p-4" role="search" aria-label="Filtrar propiedades">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <Field label="Buscar" htmlFor="f-q">
            <Input id="f-q" name="q" type="search" defaultValue={params.q} placeholder="Código, título o dirección" />
          </Field>
          <Field label="Estado" htmlFor="f-status">
            <Select id="f-status" name="status" defaultValue={params.status ?? ""}>
              <option value="">Todos (sin archivadas)</option>
              {PROPERTY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo" htmlFor="f-type">
            <Select id="f-type" name="typeKey" defaultValue={params.typeKey ?? ""}>
              <option value="">Todos</option>
              {options.types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Orden" htmlFor="f-sort">
            <Select id="f-sort" name="sort" defaultValue={params.sort ?? "updated_desc"}>
              {PROPERTY_SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <details open={advancedActive} className="group">
          <summary className="cursor-pointer text-sm font-semibold text-ink-2 hover:text-ink">Más filtros</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Publicación" htmlFor="f-pub">
              <Select id="f-pub" name="published" defaultValue={params.published ?? ""}>
                <option value="">Todas</option>
                <option value="yes">Publicadas</option>
                <option value="no">No publicadas</option>
              </Select>
            </Field>
            <Field label="Operación" htmlFor="f-op">
              <Select id="f-op" name="operation" defaultValue={params.operation ?? ""}>
                <option value="">Todas</option>
                {Object.entries(OPERATION_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sucursal" htmlFor="f-branch">
              <Select id="f-branch" name="branchId" defaultValue={params.branchId ?? ""}>
                <option value="">Todas</option>
                {options.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Agente" htmlFor="f-agent">
              <Select id="f-agent" name="agentId" defaultValue={params.agentId ?? ""}>
                <option value="">Todos</option>
                {options.staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Moneda" htmlFor="f-cur" hint="El rango de precio se aplica en esta moneda.">
              <Select id="f-cur" name="currency" defaultValue={params.currency ?? ""}>
                <option value="">Cualquiera</option>
                <option value="USD">USD</option>
                <option value="ARS">ARS ($)</option>
              </Select>
            </Field>
            <Field label="Precio desde" htmlFor="f-min">
              <Input id="f-min" name="priceMin" type="number" min={0} step="any" inputMode="decimal" defaultValue={params.priceMin} />
            </Field>
            <Field label="Precio hasta" htmlFor="f-max">
              <Input id="f-max" name="priceMax" type="number" min={0} step="any" inputMode="decimal" defaultValue={params.priceMax} />
            </Field>
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={buttonClass("primary", "sm")}>
            Aplicar
          </button>
          {anyFilter ? (
            <Link href="/crm/propiedades" className={buttonClass("ghost", "sm")}>
              Limpiar filtros
            </Link>
          ) : null}
        </div>
      </form>

      {result.total === 0 ? (
        anyFilter ? (
          <EmptyState title="Ninguna propiedad coincide con los filtros" description="Probá con otra búsqueda o limpiá los filtros." action={<ButtonLink href="/crm/propiedades" variant="secondary">Limpiar filtros</ButtonLink>} />
        ) : (
          <EmptyState
            title="Todavía no hay propiedades cargadas"
            description="Cuando se carguen (a mano o desde la migración del sitio anterior) aparecen acá."
            action={can(actor, "properties.create") ? <ButtonLink href="/crm/propiedades/nueva">Cargar la primera</ButtonLink> : undefined}
          />
        )
      ) : (
        <>
          <ul className="flex flex-col gap-3 md:hidden">
            {result.items.map((p) => (
              <li key={p.id}>
                <Link href={`/crm/propiedades/${p.id}`} className="flex gap-3 rounded-[var(--radius-lg)] border border-line bg-white p-3 hover:border-ink">
                  <div className="relative size-20 shrink-0 overflow-hidden rounded-[var(--radius-md)]">
                    <Thumb p={p} />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1 text-sm">
                    <span className="text-xs text-stone">#{p.code} · {p.type_name}</span>
                    <span className="font-semibold leading-snug text-ink">{p.title}</span>
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={PROPERTY_STATUS_TONE[p.status]}>{STATUS_LABEL[p.status as PropertyStatus] ?? p.status}</Badge>
                      {p.is_published ? <Badge tone="success">Publicada</Badge> : null}
                    </span>
                    {price(p)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Table label="Propiedades" className="hidden md:block">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Foto</span>
                </th>
                <th scope="col">Código</th>
                <th scope="col">Propiedad</th>
                <th scope="col">Estado</th>
                <th scope="col">Precio</th>
                <th scope="col">Agente</th>
                <th scope="col">Modificada</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((p) => (
                <tr key={p.id} className="hover:bg-paper">
                  <td className="w-20">
                    <div className="relative h-12 w-16 overflow-hidden rounded-[var(--radius-sm)]">
                      <Thumb p={p} />
                    </div>
                  </td>
                  <td className="font-mono text-xs">#{p.code}</td>
                  <td className="min-w-64">
                    <Link href={`/crm/propiedades/${p.id}`} className="font-semibold text-ink underline-offset-4 hover:underline">
                      {p.title}
                    </Link>
                    <p className="text-xs text-stone">
                      {[p.type_name, p.location_name, [p.address_street, p.address_number].filter(Boolean).join(" "), p.branch_name].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                  <td>
                    <span className="flex flex-col items-start gap-1">
                      <Badge tone={PROPERTY_STATUS_TONE[p.status]}>{STATUS_LABEL[p.status as PropertyStatus] ?? p.status}</Badge>
                      {p.is_published ? <Badge tone="success">Publicada</Badge> : null}
                    </span>
                  </td>
                  <td>{price(p)}</td>
                  <td className="text-sm">{p.lead_agent_name ?? <span className="text-stone">—</span>}</td>
                  <td className="whitespace-nowrap text-xs text-stone">{formatDate(p.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} pathname="/crm/propiedades" params={params} label="propiedades" />
        </>
      )}
    </>
  );
}
