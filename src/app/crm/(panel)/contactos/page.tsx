import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { listContacts } from "@/server/contacts/queries";
import { listStaffUsers, listTags } from "@/server/crm/lookups";
import { Badge, ButtonLink, EmptyState, Input, PageHeader, Select, buttonClass, formatDate } from "@/components/ui";
import { CONTACT_ROLE_LABEL } from "@/components/crm/labels";
import { Pagination, flatParams } from "@/components/crm/pagination";

export const metadata: Metadata = { title: "Contactos" };

export default async function ContactsPage({ searchParams }: PageProps<"/crm/contactos">) {
  const actor = await requireStaffPage("contacts.read");
  const sp = flatParams(await searchParams);
  const db = getDb();
  const [result, users, tags, duplicates] = await Promise.all([
    listContacts(db, actor, sp),
    listStaffUsers(db, actor),
    listTags(db, actor),
    can(actor, "contacts.merge")
      ? db.selectFrom("contact_duplicate_candidates").select((eb) => eb.fn.countAll<string>().as("n")).where("status", "=", "open").executeTakeFirst()
      : Promise.resolve(undefined),
  ]);
  const f = result.filters;
  const hasFilters = Boolean(f.q || f.role || f.tag || f.assigned);
  return (
    <>
      <PageHeader
        title="Contactos"
        description={`${result.total} ${result.total === 1 ? "contacto" : "contactos"}${hasFilters ? " con estos filtros" : ""}`}
        actions={
          <>
            {duplicates ? (
              <ButtonLink href="/crm/contactos/duplicados" variant="secondary">
                Duplicados{Number(duplicates.n) > 0 ? ` (${duplicates.n})` : ""}
              </ButtonLink>
            ) : null}
            {can(actor, "contacts.create") ? <ButtonLink href="/crm/contactos/nuevo">Nuevo contacto</ButtonLink> : null}
          </>
        }
      />
      <form method="get" role="search" aria-label="Buscar contactos" className="mb-5 grid gap-3 rounded-[var(--radius-lg)] border border-line bg-white p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <label className="sr-only" htmlFor="q">
          Buscar
        </label>
        <Input id="q" name="q" type="search" defaultValue={f.q ?? ""} placeholder="Nombre, email o teléfono" className="sm:col-span-2 lg:col-span-1" />
        <label className="sr-only" htmlFor="role">
          Rol
        </label>
        <Select id="role" name="role" defaultValue={f.role ?? ""}>
          <option value="">Todos los roles</option>
          {Object.entries(CONTACT_ROLE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="tag">
          Etiqueta
        </label>
        <Select id="tag" name="tag" defaultValue={f.tag ?? ""}>
          <option value="">Todas las etiquetas</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="assigned">
          Responsable
        </label>
        <Select id="assigned" name="assigned" defaultValue={f.assigned ?? ""}>
          <option value="">Cualquier responsable</option>
          <option value="me">Míos</option>
          <option value="none">Sin responsable</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("primary", "md", "flex-1")}>
            Buscar
          </button>
          {hasFilters ? (
            <Link href="/crm/contactos" className={buttonClass("ghost", "md")}>
              Limpiar
            </Link>
          ) : null}
        </div>
      </form>

      {result.rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No hay contactos con esos filtros" : "Todavía no hay contactos"}
          description={hasFilters ? "Probá con otro nombre, email o teléfono." : "Los contactos se crean al cargar leads o desde “Nuevo contacto”."}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white">
          {result.rows.map((c) => (
            <li key={c.id}>
              <Link href={`/crm/contactos/${c.id}`} className="grid gap-1 px-4 py-3 hover:bg-paper focus-visible:bg-paper md:grid-cols-[2fr_2fr_1.5fr_1fr] md:items-center md:gap-4">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{c.display_name}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {c.roles.map((r) => (
                      <Badge key={r}>{CONTACT_ROLE_LABEL[r] ?? r}</Badge>
                    ))}
                    {c.tags.map((t) => (
                      <Badge key={t} tone="info">
                        {t}
                      </Badge>
                    ))}
                  </span>
                </span>
                <span className="min-w-0 text-sm text-ink-2">
                  <span className="block truncate">{c.phone ?? "—"}</span>
                  <span className="block truncate text-stone">{c.email ?? ""}</span>
                </span>
                <span className="text-sm text-stone">{c.assigned_name ? `Resp.: ${c.assigned_name}` : "Sin responsable"}</span>
                <span className="text-xs text-stone md:text-right">Act. {formatDate(c.updated_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination basePath="/crm/contactos" params={sp} page={result.page} pageSize={result.pageSize} total={result.total} />
    </>
  );
}
