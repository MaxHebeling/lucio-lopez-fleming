/**
 * Descarga de imágenes remotas con timeout, límite de tamaño (cortando el stream) y validación de firma real.
 * Solo http/https hacia hosts públicos (evita que una URL cargada apunte a la red interna).
 */
import { RetryableError, isRetryableStatus, withTimeout } from "../resilience";
import { httpFetch, PermanentIntegrationError } from "../integrations/http";
import { sniffContentType } from "../storage";
import { log } from "../log";

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;
export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export class InvalidMediaError extends PermanentIntegrationError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMediaError";
  }
}

export function assertFetchableUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new InvalidMediaError("URL de origen inválida");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new InvalidMediaError("Solo se descargan URLs http(s)");
  if (PRIVATE_HOST.test(u.hostname) || u.hostname.endsWith(".local") || !u.hostname.includes(".")) throw new InvalidMediaError("Host de origen no permitido");
  return u;
}

export async function downloadImage(rawUrl: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<{ bytes: Uint8Array; contentType: string }> {
  const url = assertFetchableUrl(rawUrl);
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024;
  return withTimeout(opts.timeoutMs ?? 20_000, async (signal) => {
    let res: Response;
    try {
      res = await httpFetch(url.toString(), { signal, redirect: "follow", headers: { accept: "image/*" } });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new RetryableError(`Descarga fallida: ${(e as Error).message}`);
    }
    if (res.url) assertFetchableUrl(res.url);
    if (!res.ok) {
      const msg = `Descarga fallida: HTTP ${res.status}`;
      if (isRetryableStatus(res.status)) throw new RetryableError(msg, res.status);
      throw new InvalidMediaError(msg);
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new InvalidMediaError(`Archivo demasiado grande (${declared} bytes)`);
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch((e: unknown) => log.debug("media.download_cancel_failed", { error: (e as Error).message }));
          throw new InvalidMediaError(`Archivo demasiado grande (más de ${maxBytes} bytes)`);
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    const sniffed = bytes.byteLength >= 12 ? sniffContentType(bytes) : null;
    if (!sniffed || !IMAGE_TYPES.has(sniffed)) throw new InvalidMediaError("Archivo inválido: el contenido no es una imagen JPEG, PNG, WebP o AVIF");
    return { bytes, contentType: sniffed };
  });
}
