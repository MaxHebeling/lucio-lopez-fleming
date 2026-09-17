/**
 * Uso: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... tsx scripts/db/seed.ts
 * Sin SEED_ADMIN_* solo crea organización y sucursales.
 */
import "./env";
import { createDb } from "../../src/server/db";
import { seedAdmin, seedOrganization } from "../../src/server/seed";

const { db, pool } = createDb();
try {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    const id = await seedAdmin(db, { email, password, fullName: process.env.SEED_ADMIN_NAME ?? "Administración" });
    console.info(`Administrador listo (${id})`);
  } else {
    await seedOrganization(db);
    console.info("Organización y sucursales listas (sin SEED_ADMIN_* no se crea usuario)");
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
