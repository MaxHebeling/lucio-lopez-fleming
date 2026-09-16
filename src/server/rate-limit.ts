import { sql, type Executor } from "./db";

/**
 * Ventana fija por clave (p. ej. "lead:ip:1.2.3.4"). Atómico: un solo upsert.
 * Devuelve allowed=false cuando se supera el límite. Si la base falla, lanza (el caller decide fail-open/closed).
 */
export async function rateLimit(
  db: Executor,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const r = await sql<{ count: number }>`
    insert into rate_limit_buckets(key, window_start, count) values (${key.slice(0, 200)}, ${windowStart}, 1)
    on conflict (key, window_start) do update set count = rate_limit_buckets.count + 1
    returning count`.execute(db);
  const count = r.rows[0]?.count ?? 1;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: new Date(windowStart.getTime() + windowMs) };
}

export async function purgeRateLimits(db: Executor): Promise<void> {
  await sql`delete from rate_limit_buckets where window_start < now() - interval '1 day'`.execute(db);
}
