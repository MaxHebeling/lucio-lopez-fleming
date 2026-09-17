import { NextResponse, type NextRequest } from "next/server";

/**
 * Agrega x-request-id (trazabilidad de punta a punta) y x-pathname (lo usan los guards de página).
 * No autoriza nada: la autorización real ocurre en servidor (páginas y servicios).
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  headers.set("x-request-id", requestId);
  headers.set("x-pathname", request.nextUrl.pathname);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
