import type { Executor } from "./db";

const TTL_MS = 15_000;
let cache: { at: number; flags: Map<string, boolean> } | undefined;

/** Feature flags desde la base (cache de 15 s): se apagan sin redeploy. Flag desconocido = apagado. */
export async function isEnabled(db: Executor, key: string): Promise<boolean> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const rows = await db.selectFrom("feature_flags").select(["key", "enabled"]).execute();
    cache = { at: Date.now(), flags: new Map(rows.map((r) => [r.key, r.enabled])) };
  }
  return cache.flags.get(key) ?? false;
}

export function resetFlagCache(): void {
  cache = undefined;
}
