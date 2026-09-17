import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getUserDetail, userFormOptions } from "@/server/users/queries";
import { Alert, Badge, Card, formatDateTime, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-button";
import { JsonView } from "@/components/crm/json-view";
import { resendInviteAction, setUserActiveAction } from "../actions";
import { AccessForm, ProfileForm } from "../user-forms";

export const metadata: Metadata = { title: "Usuario" };

const ACTION_LABEL: Record<string, string> = {
  USER_INVITED: "Invitado",
  USER_INVITE_RESENT: "Invitación reenviada",
  USER_UPDATED: "Datos editados",
  USER_ROLES_CHANGED: "Roles cambiados",
  USER_BRANCHES_CHANGED: "Sucursales cambiadas",
  USER_DEACTIVATED: "Desactivado",
  USER_REACTIVATED: "Reactivado",
  LOGIN: "Ingreso",
  PASSWORD_CHANGED: "Cambió su contraseña",
  PASSWORD_RESET: "Restableció su contraseña",
  PASSWORD_RESET_REQUESTED: "Pidió restablecer la contraseña",
};

export default async function UserPage({ params, searchParams }: PageProps<"/crm/usuarios/[id]">) {
  const actor = await requireStaffPage("users.read");
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const detail = await getUserDetail(db, actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const options = await userFormOptions(db, actor);
  const u = detail.user;
  const manage = can(actor, "users.manage");
  const self = u.id === actor.userId;

  return (
    <>
      <nav aria-label="Migas de pan" className="mb-2 text-sm text-stone">
        <Link href="/crm/usuarios" className="underline-offset-4 hover:underline">
          Usuarios
        </Link>{" "}
        / {u.full_name}
      </nav>
      <PageHeader
        title={u.full_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{u.email}</span>
            {!u.is_active ? <Badge>Desactivado</Badge> : u.pending_invite ? <Badge tone="warning">Invitación pendiente</Badge> : <Badge tone="success">Activo</Badge>}
            {self ? <Badge tone="info">Sos vos</Badge> : null}
          </span>
        }
        actions={
          manage ? (
            <>
              {u.pending_invite && u.is_active ? (
                <ActionButton action={resendInviteAction.bind(null, u.id)} pendingLabel="Reenviando…" confirm="¿Reenviar la invitación? El link anterior deja de funcionar.">
                  Reenviar invitación
                </ActionButton>
              ) : null}
              {!self ? (
                u.is_active ? (
                  <ActionButton action={setUserActiveAction.bind(null, u.id, false)} variant="danger" pendingLabel="Desactivando…" confirm={`¿Desactivar a ${u.full_name}? Se cierran todas sus sesiones y no podrá ingresar.`}>
                    Desactivar
                  </ActionButton>
                ) : (
                  <ActionButton action={setUserActiveAction.bind(null, u.id, true)} pendingLabel="Reactivando…">
                    Reactivar
                  </ActionButton>
                )
              ) : null}
            </>
          ) : null
        }
      />
      <div className="flex flex-col gap-5">
        {sp.invitado ? <Alert tone="success">Usuario creado. La invitación quedó en la cola de envíos de email.</Alert> : null}
        <Card title="Resumen">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-stone">Último ingreso</dt>
              <dd>{u.last_login_at ? formatDateTime(u.last_login_at) : "Nunca"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-stone">Sesiones abiertas</dt>
              <dd>{detail.activeSessions}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-stone">Invitación</dt>
              <dd>{u.pending_invite ? (detail.inviteExpiresAt ? `Vence ${formatDateTime(detail.inviteExpiresAt)}` : "Vencida: reenviala") : "Aceptada"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-stone">Bloqueo por intentos</dt>
              <dd>{u.locked_until && u.locked_until > new Date() ? `Hasta ${formatDateTime(u.locked_until)}` : "No"}</dd>
            </div>
          </dl>
        </Card>
        <Card title="Datos">
          {manage ? (
            <ProfileForm userId={u.id} profile={u} />
          ) : (
            <p className="text-sm">
              {u.phone ?? "Sin teléfono"} · {u.whatsapp_e164 ?? "Sin WhatsApp"} · {u.public_profile ? "Visible en el sitio" : "No visible en el sitio"}
            </p>
          )}
        </Card>
        <Card title="Roles y sucursales">
          {manage ? (
            <AccessForm key={`${detail.roleKeys.join()}|${detail.branchIds.join()}`} userId={u.id} roles={options.roles} branches={options.branches} roleKeys={detail.roleKeys} branchIds={detail.branchIds} />
          ) : (
            <p className="text-sm">
              {options.roles
                .filter((r) => detail.roleKeys.includes(r.key))
                .map((r) => r.name)
                .join(", ") || "Sin roles"}
            </p>
          )}
        </Card>
        {detail.audit ? (
          <Card title="Historial">
            {detail.audit.length === 0 ? (
              <p className="text-sm text-stone">Sin cambios registrados.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-line text-sm">
                {detail.audit.map((a) => (
                  <li key={a.id} className="py-2">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap justify-between gap-x-4">
                        <span className="font-semibold">{ACTION_LABEL[a.action] ?? a.action}</span>
                        <span className="text-xs text-stone">
                          {formatDateTime(a.occurred_at)} · {a.actor_name ?? (a.actor_kind === "system" ? "Sistema" : a.actor_kind === "anonymous" ? "Sin sesión" : a.actor_kind)}
                        </span>
                      </summary>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <JsonView label="Antes" value={a.before} />
                        <JsonView label="Después" value={a.after} />
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
