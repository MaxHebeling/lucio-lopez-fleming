/**
 * Carga o actualiza la propiedad demo y su tour 360° desde public/tours/demo/residencia/manifest.json.
 * Idempotente: se puede correr las veces que haga falta (p. ej. después de reemplazar los placeholders por renders).
 * Uso: pnpm seed:demo-tour   (base de DATABASE_URL; con APP_URL + CRON_SECRET además invalida la caché del sitio)
 */
import "./db/env";
import { resolve } from "node:path";
import { createDb } from "../src/server/db";
import { seedDemoTour } from "../src/server/tours/demo-seed";
import { requestPublicSiteRevalidation } from "../src/server/site/revalidate";

const { db, pool } = createDb();
try {
  await seedDemoTour(db, { dir: resolve(import.meta.dirname, "../public/tours/demo/residencia"), publicPrefix: "/tours/demo/residencia", log: (m) => console.info(m) });
  const revalidated = await requestPublicSiteRevalidation(undefined, "seed-demo-tour");
  console.info(revalidated ? "Caché del sitio invalidada." : "No se pudo pedir la invalidación por HTTP (servidor apagado o sin APP_URL/CRON_SECRET): la demo se actualiza al vencer la caché (≤ 5 min) o al procesar el evento.");
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
