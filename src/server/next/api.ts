/** Envoltorio para Route Handlers: request id, errores seguros, logging estructurado. */
import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { AppError, toPublicError } from "../errors";
import { errorFields, log } from "../log";
import { assertPasswordChangeNotPending } from "../auth/actor";
import { SESSION_COOKIE } from "../auth/session";
import { getActor } from "./context";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type ApiHandler<C> = (req: NextRequest, ctx: C & { requestId: string }) => Promise<Response>;

export function apiRoute<C>(name: string, handler: ApiHandler<C>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const t0 = Date.now();
    try {
      // Mutaciones con sesión: un usuario del equipo con cambio de contraseña pendiente no opera (webhooks y API
      // pública no llevan cookie de sesión y no pagan esta consulta).
      if (!SAFE_METHODS.has(req.method) && req.cookies.get(SESSION_COOKIE)?.value) {
        assertPasswordChangeNotPending(await getActor(), name);
      }
      const res = await handler(req, { ...ctx, requestId });
      res.headers.set("x-request-id", requestId);
      log.info("api.request", { route: name, method: req.method, status: res.status, ms: Date.now() - t0, requestId });
      return res;
    } catch (e) {
      const pub = toPublicError(e);
      if (!(e instanceof AppError)) log.error("api.failed", { route: name, method: req.method, requestId, ...errorFields(e) });
      return NextResponse.json(
        { error: { code: pub.code, message: pub.message, details: pub.details, requestId } },
        { status: pub.status, headers: { "x-request-id": requestId } },
      );
    }
  };
}
