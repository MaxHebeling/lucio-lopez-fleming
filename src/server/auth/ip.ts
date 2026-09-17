import { isIP } from "node:net";

/** Normaliza una IP de cabecera a algo que Postgres acepte como inet; null si no es válida. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s || s.length > 64) return null;
  const m6 = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (m6) s = m6[1]!;
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  return isIP(s) ? s : null;
}

type IpEnv = Record<string, string | undefined>;

function firstValid(list: string | null): string | null {
  for (const part of (list ?? "").split(",")) {
    const ip = normalizeIp(part);
    if (ip) return ip;
  }
  return null;
}

/**
 * IP del cliente (rate limits, auditoría, sesiones). `X-Forwarded-For` lo puede escribir el propio cliente, así que
 * su primer valor nunca se usa en producción:
 * - Vercel (`VERCEL` definida): `x-vercel-forwarded-for` y luego `x-real-ip`, que fija la plataforma.
 * - Otro proxy/balanceador: configurar `TRUSTED_PROXY_HOPS` = cantidad de proxies confiables que AGREGAN al
 *   `X-Forwarded-For`; se toma el valor N-ésimo desde la derecha (el que escribió el primer proxy propio).
 *   `0` = la app está expuesta directo: ninguna cabecera es confiable (null).
 * - Desarrollo/test sin configuración: primer valor válido de `X-Forwarded-For`, luego `x-real-ip`.
 * - Producción fuera de Vercel sin `TRUSTED_PROXY_HOPS`: null (los límites caen a la clave compartida, más estricta).
 */
export function clientIpFromHeaders(get: (name: string) => string | null, env: IpEnv = process.env): string | null {
  if (env.VERCEL) return firstValid(get("x-vercel-forwarded-for")) ?? normalizeIp(get("x-real-ip"));
  const hopsRaw = env.TRUSTED_PROXY_HOPS?.trim();
  if (hopsRaw) {
    const hops = Number(hopsRaw);
    if (!Number.isInteger(hops) || hops <= 0 || hops > 10) return null;
    const parts = (get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    const candidate = parts[parts.length - hops];
    return candidate ? normalizeIp(candidate) : null;
  }
  const appEnv = env.APP_ENV ?? "development";
  if (appEnv !== "development" && appEnv !== "test") return null;
  return firstValid(get("x-forwarded-for")) ?? normalizeIp(get("x-real-ip"));
}
