import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { listUsers, userFormOptions } from "@/server/users/queries";
import { Badge, buttonClass, ButtonLink, EmptyState, Field, formatDateTime, Input, PageHeader, Select, Table } from "@/components/ui";
import { PaginationBar } from "@/components/crm/pagination";
import { first, pageParam } from "../_lib/params";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsersPage({ searchParams }: PageProps<"/crm/usuarios">) {
  const actor = await requireStaffPage("users.read");
  const sp = await searchParams;
  const params = { q: first(sp, "q"), role: first(sp, "role"), status: first(sp, "status") };
  const db = getDb();
  const [result, options] = await Promise.all([listUsers(db, actor, { ...params, page: pageParam(sp) }), userFormOptions(db, actor)]);
  const filtered = Object.values(params).some(Boolean);

  return (
    <>
      <PageHeader title="Usuarios del equipo" description="Invitaciones, roles, sucursales y acceso." actions={can(actor, "users.manage") ? <ButtonLink href="/crm/usuarios/invitar">Invitar usuario</ButtonLink> : null} />
      <form method="get" className="mb-5 grid gap-3 rounded-[var(--radius-lg)] border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end" role="search" aria-label="Filtrar usuarios">
        <Field label="Buscar" htmlFor="u-q">
          <Input id="u-q" name="q" type="search" defaultValue={params.q} placeholder="Nombre o email" />
        </Field>
        <Field label="Rol" htmlFor="u-role">
          <Select id="u-role" name="role" defaultValue={params.role ?? ""}>
            <option value="">Todos</option>
            {options.roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estado" htmlFor="u-status">
          <Select id="u-status" name="status" defaultValue={params.status ?? ""}>
            <option value="">Todos</option>
            <option value="active">Activos</option>
            <option value="invited">Invitación pendiente</option>
            <option value="inactive">Desactivados</option>
          </Select>
        </Field>
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("primary", "md")}>
            Aplicar
          </button>
          {filtered ? (
            <Link href="/crm/usuarios" className={buttonClass("ghost", "md")}>
              Limpiar
            </Link>
          ) : null}
        </div>
      </form>
      {result.total === 0 ? (
        <EmptyState title={filtered ? "Ningún usuario coincide" : "Todavía no hay usuarios"} description={filtered ? "Probá con otros filtros." : "Invitá al equipo para que pueda ingresar."} />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Roles</th>
                <th scope="col">Sucursales</th>
                <th scope="col">Estado</th>
                <th scope="col">Último ingreso</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link href={`/crm/usuarios/${u.id}`} className="font-semibold underline-offset-4 hover:underline">
                      {u.full_name}
                    </Link>
                    <span className="block text-xs text-stone">{u.email}</span>
                  </td>
                  <td className="text-sm">{u.roles.length ? u.roles.join(", ") : <span className="text-stone">Sin roles</span>}</td>
                  <td className="text-sm">{u.branches.length ? u.branches.join(", ") : <span className="text-stone">—</span>}</td>
                  <td>{!u.is_active ? <Badge>Desactivado</Badge> : u.pending_invite ? <Badge tone="warning">Invitación pendiente</Badge> : <Badge tone="success">Activo</Badge>}</td>
                  <td className="text-xs text-stone">{u.last_login_at ? formatDateTime(u.last_login_at) : "Nunca"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} pathname="/crm/usuarios" params={params} label="usuarios" />
        </>
      )}
    </>
  );
}
