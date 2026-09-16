import type { Instrumentation } from "next";

/** Errores de servidor no capturados: log estructurado + Sentry (si está configurado). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureError } = await import("./server/monitoring/sentry");
  const { log, errorFields } = await import("./server/log");
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  const requestId = (request.headers as Record<string, string | string[] | undefined>)["x-request-id"];
  log.error("request.unhandled_error", {
    path: request.path,
    method: request.method,
    routeType: context.routeType,
    routePath: context.routePath,
    digest,
    requestId: Array.isArray(requestId) ? requestId[0] : requestId,
    ...errorFields(err),
  });
  await captureError(err, { tags: { routeType: context.routeType, routePath: context.routePath, method: request.method }, extra: { digest, path: request.path } });
};
