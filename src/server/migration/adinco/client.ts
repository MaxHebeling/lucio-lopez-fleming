/**
 * Cliente de solo lectura del sitio actual (Adinco). Uso exclusivo para la migración:
 * concurrencia baja, timeout, reintentos con backoff en errores reintentables.
 */
import { RetryableError, isRetryableStatus, retry, withTimeout } from "../../resilience";

export const ADINCO_SITE = "https://www.luciolopezfleming.com.ar";
export const ADINCO_REAL_ESTATE_ID = 3414;
const UA = "LLF-Migracion/1.0 (+plataforma propia de Lucio Lopez Fleming)";

async function http(url: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  return retry(
    () =>
      withTimeout(20_000, async (signal) => {
        const res = await fetchImpl(url, { ...init, signal, headers: { "user-agent": UA, accept: "application/json,text/html", ...(init.headers ?? {}) } });
        if (!res.ok) {
          if (isRetryableStatus(res.status)) throw new RetryableError(`HTTP ${res.status} ${url}`, res.status);
          throw Object.assign(new Error(`HTTP ${res.status} ${url}`), { status: res.status });
        }
        return res;
      }),
    { attempts: 4, baseMs: 800, capMs: 8_000 },
  );
}

export type ListedProperty = { id: number; code: number; statusId: number };

/** Lista todas las propiedades publicadas (activas y reservadas) en una sola llamada paginada. */
export async function listAdincoProperties(fetchImpl?: typeof fetch): Promise<ListedProperty[]> {
  const out: ListedProperty[] = [];
  for (let page = 1; page < 100; page++) {
    const res = await http(
      `${ADINCO_SITE}/api/properties`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          realEstateId: ADINCO_REAL_ESTATE_ID,
          options: { page, conditions: { statusId: "1,2", typeId: "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16" }, order: { order: "created-desc" }, fromForm: true, size: 200 },
        }),
      },
      fetchImpl,
    );
    const body = (await res.json()) as { data?: ListedProperty[]; meta?: { last_page?: number } };
    if (!Array.isArray(body.data)) throw new Error("Respuesta de listado sin data[]");
    out.push(...body.data.map((p) => ({ id: p.id, code: p.code, statusId: p.statusId })));
    if (!body.meta?.last_page || page >= body.meta.last_page) break;
  }
  return out;
}

/** Ficha completa: el sitio la renderiza en servidor y la embebe en __NEXT_DATA__. */
export async function fetchAdincoPropertyDetail(code: number, fetchImpl?: typeof fetch): Promise<unknown> {
  const res = await http(`${ADINCO_SITE}/luciolopez-${code}`, {}, fetchImpl);
  const html = await res.text();
  return extractPropertyFromHtml(html);
}

export function extractPropertyFromHtml(html: string): unknown {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("La ficha no contiene __NEXT_DATA__");
  const data = JSON.parse(m[1]!) as { props?: { pageProps?: { property?: unknown } } };
  const property = data.props?.pageProps?.property;
  if (!property || typeof property !== "object") throw new Error("La ficha no contiene property");
  return property;
}

export type AdincoRealEstate = {
  offices: Array<{
    id: number;
    name: string;
    address: { street?: string | null; number?: string | null; neighborhood?: string | null; zp_3?: string | null };
    latitude?: number | null;
    longitude?: number | null;
    sellers: Array<{ id: number; name: string; lastname: string; contact: { email?: string | null; phoneNumbers: Array<{ type: string; countryCode?: string | null; areaCode?: number | string | null; number: string }> } }>;
  }>;
};

export async function fetchAdincoRealEstate(fetchImpl?: typeof fetch): Promise<AdincoRealEstate> {
  const res = await http(`${ADINCO_SITE}/api/realEstates/${ADINCO_REAL_ESTATE_ID}`, {}, fetchImpl);
  return (await res.json()) as AdincoRealEstate;
}

/** Ejecuta tareas con concurrencia limitada y pausa entre inicios (cortesía con el servidor de origen). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>, delayMs = 0): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
  });
  await Promise.all(workers);
  return results;
}
