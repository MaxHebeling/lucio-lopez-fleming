import type { Executor } from "./db";

export const ORG_SLUG = "lucio-lopez-fleming";

let cached: string | undefined;

/** Id de la organización (plataforma de una sola inmobiliaria, modelada para varias sucursales). */
export async function organizationId(db: Executor): Promise<string> {
  if (cached) return cached;
  const row = await db.selectFrom("organizations").select("id").where("slug", "=", ORG_SLUG).executeTakeFirst();
  if (!row) throw new Error(`Organización ${ORG_SLUG} inexistente: correr pnpm db:seed`);
  cached = row.id;
  return row.id;
}

export function resetOrganizationCache(): void {
  cached = undefined;
}
