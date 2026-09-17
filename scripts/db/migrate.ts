/**
 * Runner de migraciones SQL.
 * - db/migrations/NNNN_nombre.sql se aplica una sola vez, cada una en su transacción.
 * - Guarda checksum: si un archivo ya aplicado cambia, falla (las migraciones son inmutables).
 * - Advisory lock: dos deploys no migran a la vez.
 * - db/_post_migrate.sql corre siempre al final (cierra privilegios de anon/authenticated y activa RLS).
 * Uso: tsx scripts/db/migrate.ts [--status] [--url postgres://...]
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { databaseUrl, redactUrl, sslConfig } from "./env";

const ROOT = resolve(import.meta.dirname, "../../db");
const MIGRATIONS_DIR = resolve(ROOT, "migrations");
const LOCK_KEY = 1_974_0639; // fijo: año de fundación + Entre Ríos 639

export type MigrationFile = { version: string; name: string; sql: string; checksum: string };

export function listMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const sql = readFileSync(resolve(dir, f), "utf8");
      return {
        version: f.slice(0, 4),
        name: f,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    });
}

export async function migrate(
  url: string,
  opts: { statusOnly?: boolean; log?: (m: string) => void } = {},
): Promise<{ applied: number; pending: number }> {
  const log = opts.log ?? ((m: string) => console.info(m));
  const client = new pg.Client({ connectionString: url, ssl: sslConfig() });
  await client.connect();
  try {
    await client.query(`create table if not exists schema_migrations (
      version text primary key, name text not null, checksum text not null,
      applied_at timestamptz not null default now(), duration_ms integer)`);
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      const applied = new Map<string, string>();
      for (const r of (await client.query("select version, checksum from schema_migrations")).rows)
        applied.set(r.version, r.checksum);

      const files = listMigrations();
      const versions = files.map((f) => f.version);
      if (new Set(versions).size !== versions.length)
        throw new Error(`Versiones de migración duplicadas: ${versions.join(",")}`);
      for (const f of files) {
        const sum = applied.get(f.version);
        if (sum && sum !== f.checksum)
          throw new Error(
            `La migración ${f.name} ya fue aplicada con otro contenido. Las migraciones son inmutables: creá una nueva.`,
          );
      }
      const pending = files.filter((f) => !applied.has(f.version));
      if (opts.statusOnly) {
        for (const f of files) log(`${applied.has(f.version) ? "✔" : "·"} ${f.name}`);
        log(`${pending.length} pendiente(s)`);
        return { applied: 0, pending: pending.length };
      }
      for (const f of pending) {
        const t0 = Date.now();
        await client.query("begin");
        try {
          await client.query(f.sql);
          await client.query(
            "insert into schema_migrations(version, name, checksum, duration_ms) values ($1,$2,$3,$4)",
            [f.version, f.name, f.checksum, Date.now() - t0],
          );
          await client.query("commit");
          log(`✔ ${f.name} (${Date.now() - t0} ms)`);
        } catch (e) {
          await client.query("rollback");
          throw new Error(`Falló ${f.name}: ${(e as Error).message}`, { cause: e });
        }
      }
      await client.query(readFileSync(resolve(ROOT, "_post_migrate.sql"), "utf8"));
      log(`Base al día: ${pending.length} migración(es) aplicada(s), post-migrate OK`);
      return { applied: pending.length, pending: 0 };
    } finally {
      await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const url = databaseUrl();
  console.info(`Migrando ${redactUrl(url)}`);
  migrate(url, { statusOnly: process.argv.includes("--status") }).catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
