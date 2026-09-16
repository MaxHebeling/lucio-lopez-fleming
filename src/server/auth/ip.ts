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

/** IP del cliente: primer valor válido de x-forwarded-for, luego x-real-ip. */
export function clientIpFromHeaders(get: (name: string) => string | null): string | null {
  const xff = get("x-forwarded-for");
  if (xff) {
    for (const part of xff.split(",")) {
      const ip = normalizeIp(part);
      if (ip) return ip;
    }
  }
  return normalizeIp(get("x-real-ip"));
}
