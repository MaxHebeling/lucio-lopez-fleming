/**
 * Borra y recrea una base LOCAL y la migra. Se niega a tocar hosts que no sean localhost.
 * Uso: tsx scripts/db/recreate.ts [--url postgres://localhost/llf_test]
 */
import pg from "pg";
import { databaseUrl } from "./env";
import { migrate } from "./migrate";

export async function recreateLocalDatabase(url: string, log: (m: string) => void = () => {}) {
  const u = new URL(url);
  const host = u.hostname;
  if (!["localhost", "127.0.0.1", "::1", ""].includes(host))
    throw new Error(`recreate solo opera sobre bases locales (host=${host})`);
  const dbName = u.pathname.slice(1);
  if (!/^llf_[a-z0-9_]+$/.test(dbName))
    throw new Error(`Nombre de base no permitido para recrear: ${dbName} (debe empezar con llf_)`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  try {
    await c.query(`drop database if exists ${dbName} with (force)`);
    await c.query(`create database ${dbName}`);
  } finally {
    await c.end();
  }
  await migrate(url, { log });
}

if (process.argv[1]?.endsWith("recreate.ts")) {
  recreateLocalDatabase(databaseUrl(), console.info).catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
