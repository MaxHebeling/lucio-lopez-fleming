import { NextResponse, type NextRequest } from "next/server";
import { OPERATION_SLUGS } from "@/server/properties/public-constants";
import { getSiteFacets } from "@/server/site/public-data";

export const dynamic = "force-dynamic";

/**
 * Opciones del buscador del home según operación y tipo elegidos (conteos en vivo desde la caché del sitio).
 * Solo lo que el buscador necesita; parámetros inválidos se ignoran (mismo criterio que la URL de búsqueda).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const opSlug = sp.get("operacion") ?? "";
  const operation = opSlug in OPERATION_SLUGS ? OPERATION_SLUGS[opSlug as keyof typeof OPERATION_SLUGS] : undefined;
  const tipoRaw = sp.get("tipo") ?? "";
  const tipo = /^[a-z0-9_-]{1,140}$/.test(tipoRaw) ? tipoRaw : undefined;
  const f = await getSiteFacets(operation, tipo);
  return NextResponse.json(
    {
      operations: f.operations,
      types: f.types.map((t) => ({ key: t.key, plural: t.plural, count: t.count })),
      zones: f.zones.map((z) => ({ slug: z.slug, name: z.name, count: z.count })),
      total: f.total,
    },
    { headers: { "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60" } },
  );
}
