/**
 * Importa las propiedades publicadas en el sitio anterior (Adinco) al CRM.
 *
 *   pnpm import:adinco                         todas
 *   pnpm import:adinco --limit 10              primeras 10
 *   pnpm import:adinco --codes 3021,3018       códigos puntuales
 *   pnpm import:adinco --verify-media          además verifica cada foto (HEAD)
 *   pnpm import:adinco --force                 reprocesa aunque el origen no haya cambiado
 *
 * Idempotente y reiniciable: se puede correr las veces que haga falta.
 */
import "./db/env";
import { createDb, setDbForTests } from "../src/server/db";
import { runAdincoImport } from "../src/server/migration/adinco/importer";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * El importador escribe fuera del servidor web: se pide al sitio que invalide su caché (POST /api/site/revalidate, ver
 * src/server/site/revalidate.ts). Sin APP_URL/CRON_SECRET o sin servidor, el sitio se actualiza solo en ≤ 5 minutos.
 */
async function revalidatePublicSite(): Promise<void> {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return console.info("Sitio público: sin APP_URL/CRON_SECRET, la caché vence sola en ≤ 5 minutos.");
  try {
    const res = await fetch(`${base}/api/site/revalidate`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "import:adinco" }),
      signal: AbortSignal.timeout(5_000),
    });
    console.info(res.ok ? "Sitio público: caché invalidada." : `Sitio público: no se pudo invalidar (HTTP ${res.status}); vence sola en ≤ 5 minutos.`);
  } catch (e) {
    console.warn(`Sitio público: no se pudo invalidar (${(e as Error).message}); vence sola en ≤ 5 minutos.`);
  }
}

const holder = createDb();
setDbForTests(holder);
const t0 = Date.now();
try {
  const stats = await runAdincoImport(holder.db, {
    limit: arg("limit") ? Number(arg("limit")) : undefined,
    codes: arg("codes")?.split(",").map(Number).filter(Number.isFinite),
    verifyMedia: process.argv.includes("--verify-media"),
    force: process.argv.includes("--force"),
    triggeredBy: `cli:${process.env.USER ?? "desconocido"}`,
    logger: (m) => console.info(m),
  });
  console.info(JSON.stringify(stats, null, 2));
  console.info(`Listo en ${Math.round((Date.now() - t0) / 1000)} s`);
  await revalidatePublicSite();
  if (stats.failed) process.exitCode = 2;
} catch (e) {
  console.error(`La importación falló: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await holder.pool.end();
}
