/**
 * Primer arranque (operación LOCAL de administración): crea un usuario del equipo sin contraseña
 * y muestra en la terminal el link para definirla (válido 72 h). No encola email.
 * Uso: pnpm user:invite email@dominio.com "Nombre Apellido" super_admin
 */
import "./db/env";
import { createDb, setDbForTests } from "../src/server/db";
import { systemActor } from "../src/server/auth/actor";
import { organizationId } from "../src/server/org";
import { inviteUser, INVITE_TTL_HOURS } from "../src/server/users/service";
import { toPublicError } from "../src/server/errors";

const [email, fullName, role] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!email || !fullName || !role) {
  console.error('Uso: pnpm user:invite email@dominio.com "Nombre Apellido" rol\nRoles: super_admin, direccion, administrador, agente, alquileres, marketing, solo_lectura');
  process.exit(1);
}

const holder = createDb();
setDbForTests(holder);
try {
  const actor = systemActor(await organizationId(holder.db), "cli:user-invite");
  const r = await inviteUser(holder.db, actor, { email, fullName, roles: [role] }, { sendEmail: false });
  console.info(`Usuario creado (${r.userId}).`);
  console.info(`Link para definir la contraseña (válido ${INVITE_TTL_HOURS} h, un solo uso):\n\n  ${r.inviteUrl}\n`);
  console.info("No lo compartas por canales públicos: quien tenga el link puede definir la contraseña.");
} catch (e) {
  const pub = toPublicError(e);
  const details = pub.details ? ` ${JSON.stringify(pub.details)}` : "";
  console.error(`No se pudo crear el usuario: ${pub.code === "internal" ? (e as Error).message : pub.message}${details}`);
  process.exitCode = 1;
} finally {
  await holder.pool.end();
}
