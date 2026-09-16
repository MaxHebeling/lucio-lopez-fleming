/**
 * Acceso tipado a Postgres con Kysely. Los tipos de src/server/db/generated.ts se generan desde la base
 * (`pnpm db:codegen`) y se versionan: un checkout limpio (CI, Vercel) compila sin base.
 */
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import pg from "pg";
import type { DB } from "./generated";

export type { DB } from "./generated";
export { sql } from "kysely";
export type Database = Kysely<DB>;
export type Tx = Transaction<DB>;
export type Executor = Database | Tx;

// `date` como string YYYY-MM-DD: evita que node-pg lo convierta a Date en la zona local
// (correría vencimientos y períodos un día).
pg.types.setTypeParser(1082, (v) => v);

function sslFromEnv(): false | { rejectUnauthorized: boolean; ca?: string } {
  const mode = (process.env.DATABASE_SSL ?? "disable").toLowerCase();
  if (mode === "disable" || mode === "false" || mode === "") return false;
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
  return { rejectUnauthorized: mode !== "no-verify", ...(ca ? { ca } : {}) };
}

export function createDb(connectionString?: string, max?: number): { db: Database; pool: pg.Pool } {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  const pool = new pg.Pool({
    connectionString: url,
    ssl: sslFromEnv(),
    max: max ?? (process.env.VERCEL ? 3 : 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
  });
  pool.on("error", (err) => {
    // Error de un cliente ocioso: no tumba el proceso; el pool lo descarta.
    console.error(JSON.stringify({ level: "error", msg: "db.pool_error", error: err.message }));
  });
  return { db: new Kysely<DB>({ dialect: new PostgresDialect({ pool }) }), pool };
}

type Holder = { db: Database; pool: pg.Pool };
const g = globalThis as unknown as { __llf_db?: Holder };

/** Instancia compartida por proceso (sobrevive al hot reload en desarrollo). */
export function getDb(): Database {
  g.__llf_db ??= createDb();
  return g.__llf_db.db;
}

/** Solo para tests: fija la instancia compartida. */
export function setDbForTests(holder: Holder | undefined): void {
  g.__llf_db = holder;
}

export async function dbHealth(db: Database): Promise<{ ok: boolean; latencyMs: number; migrations: number; error?: string }> {
  const t0 = Date.now();
  try {
    const r = await sql<{ n: number }>`select count(*)::int as n from schema_migrations`.execute(db);
    return { ok: true, latencyMs: Date.now() - t0, migrations: r.rows[0]?.n ?? 0 };
  } catch (e) {
    const err = e as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      migrations: 0,
      error: err.message || err.cause?.message || err.code || err.cause?.code || "sin detalle",
    };
  }
}

/** Código SQLSTATE de un error de Postgres (o undefined). */
export function pgCode(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}

export function pgConstraint(e: unknown): string | undefined {
  return (e as { constraint?: string } | null)?.constraint;
}
