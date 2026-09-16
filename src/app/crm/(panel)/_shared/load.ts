import "server-only";
import { notFound, redirect } from "next/navigation";
import { AppError } from "@/server/errors";
import type { Actor } from "@/server/auth/actor";
import { tryScope, type Scope } from "@/server/crm/access";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Traduce errores de dominio en páginas: inexistente o fuera de alcance → 404; sin permiso → tablero. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    if (e instanceof AppError && e.code === "forbidden") redirect("/crm?sin-permiso=1");
    throw e;
  }
}

export function requireUuid(id: string): string {
  if (!UUID_RE.test(id)) notFound();
  return id;
}

/** Páginas con alcance propio/todos: sin ninguno de los dos permisos se vuelve al tablero. */
export function requireScope(fn: (a: Actor) => Scope, actor: Actor): Scope {
  const scope = tryScope(fn, actor);
  if (!scope) redirect("/crm?sin-permiso=1");
  return scope;
}

/** Momento de la solicitud (fuera del render para no romper la pureza de componentes). */
export function isPast(d: Date | null | undefined): boolean {
  return Boolean(d && d.getTime() <= Date.now());
}
