/**
 * Adaptador de la API pública de Estadísticas Monetarias del BCRA (v4.0, sin credenciales).
 * Verificado el 2026-09-16 contra el catálogo en vivo (GET /estadisticas/v4.0/monetarias):
 *   - idVariable 30 → "Coeficiente de estabilización de referencia (base 2.2.02=1)" (CER), diario
 *   - idVariable 40 → "Índice para Contratos de Locación (base 30.6.20=1)" (ICL), diario
 *   (ojo: la 31 es UVA, no ICL).
 * Serie: GET /estadisticas/v4.0/monetarias/{id}?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&limit=N&offset=M
 *   → { status, metadata: { resultset: { count, offset, limit } }, results: [{ idVariable, detalle: [{ fecha, valor }] }] }
 * Límites observados: limit ≤ 3000; `desde` no puede ser posterior a hoy (400); `hasta` puede ser futura
 * (el BCRA publica ICL y CER por adelantado). Errores: { status: 400, errorMessages: [...] }.
 */
import { z } from "zod";
import { RetryableError, isRetryableStatus, retry, withTimeout } from "../resilience";

export const BCRA_BASE_URL = "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias";
export const BCRA_VARIABLES = { CER: 30, ICL: 40 } as const;
export type BcraIndex = keyof typeof BCRA_VARIABLES;

const PAGE = 3000;
const DECIMAL = /^\d+(\.\d+)?$/;

const responseSchema = z.object({
  status: z.number(),
  metadata: z.object({ resultset: z.object({ count: z.number().int().min(0), offset: z.number().int(), limit: z.number().int() }) }),
  results: z.array(
    z.object({
      idVariable: z.number().int(),
      detalle: z.array(z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), valor: z.number().positive() })),
    }),
  ),
});

export type BcraPoint = { date: string; value: string };

export class BcraError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "BcraError";
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Descarga la serie completa entre dos fechas (paginando). No toca la base: la persistencia es del servicio. */
export async function fetchBcraSeries(
  index: BcraIndex,
  from: string,
  to: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number; attempts?: number } = {},
): Promise<BcraPoint[]> {
  const id = BCRA_VARIABLES[index];
  const doFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const points: BcraPoint[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${BCRA_BASE_URL}/${id}?desde=${from}&hasta=${to}&limit=${PAGE}&offset=${offset}`;
    const page = await retry(
      () =>
        withTimeout(opts.timeoutMs ?? 15_000, async (signal) => {
          const res = await doFetch(url, { headers: { accept: "application/json" }, signal, cache: "no-store" });
          const text = await res.text();
          if (!res.ok) {
            const msg = `BCRA ${res.status}: ${text.slice(0, 300)}`;
            if (isRetryableStatus(res.status)) throw new RetryableError(msg, res.status);
            throw new BcraError(msg, res.status);
          }
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            throw new BcraError("BCRA devolvió una respuesta que no es JSON");
          }
          const parsed = responseSchema.safeParse(json);
          if (!parsed.success) throw new BcraError(`Formato inesperado de la API del BCRA: ${parsed.error.issues[0]?.message ?? ""}`);
          return parsed.data;
        }),
      { attempts: opts.attempts ?? 3 },
    );
    const serie = page.results.find((r) => r.idVariable === id);
    if (page.results.length && !serie) throw new BcraError(`La API devolvió otra variable (esperada ${id})`);
    for (const d of serie?.detalle ?? []) {
      const value = String(d.valor);
      if (!DECIMAL.test(value)) throw new BcraError(`Valor no decimal en ${d.fecha}: ${value}`);
      points.push({ date: d.fecha, value });
    }
    const fetched = offset + (serie?.detalle.length ?? 0);
    if (!serie?.detalle.length || fetched >= page.metadata.resultset.count) break;
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}
