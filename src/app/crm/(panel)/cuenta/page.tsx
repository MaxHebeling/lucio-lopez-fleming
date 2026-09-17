import type { Metadata } from "next";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { Alert, Card, PageHeader } from "@/components/ui";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Mi cuenta" };

const ROLE_NAMES = async (keys: string[]) =>
  keys.length ? (await getDb().selectFrom("roles").select(["key", "name"]).where("key", "in", keys).execute()).map((r) => r.name) : [];

export default async function AccountPage() {
  const actor = await requireStaffPage();
  const roles = await ROLE_NAMES(actor.roles);
  const forced = Boolean(actor.mustChangePassword);
  return (
    <>
      <PageHeader title="Mi cuenta" description={`${actor.fullName} · ${actor.email}`} />
      <div className="flex flex-col gap-5">
        {forced ? <Alert tone="warning">Antes de seguir tenés que cambiar tu contraseña.</Alert> : null}
        <Card title="Cambiar contraseña">
          <PasswordForm forced={forced} />
        </Card>
        <Card title="Accesos">
          <p className="text-sm text-ink-2">Roles: {roles.length ? roles.join(", ") : "sin roles asignados"}.</p>
          <p className="mt-1 text-sm text-stone">Los roles y sucursales los administra quien gestiona usuarios.</p>
        </Card>
      </div>
    </>
  );
}
