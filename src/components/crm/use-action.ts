"use client";

import { useCallback, useState, useTransition } from "react";
import type { ActionResult } from "@/server/next/action";

type State = { ok?: boolean; error?: string; fieldErrors?: Record<string, string[]> };

const NETWORK_ERROR = "No pudimos completar la acción. Revisá tu conexión y probá de nuevo.";

/**
 * Ejecuta una Server Action que devuelve ActionResult, con estado de carga y errores por campo.
 * No usa <form action>: así el formulario no se resetea cuando hay errores de validación.
 */
export function useAction<A extends unknown[], T>(action: (...args: A) => Promise<ActionResult<T>>) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>({});
  const run = useCallback(
    (...args: A) =>
      new Promise<ActionResult<T>>((resolve) => {
        startTransition(async () => {
          let r: ActionResult<T>;
          try {
            r = await action(...args);
          } catch {
            // Falla de red o despliegue nuevo (acción inexistente): mensaje seguro y reintento manual.
            r = { ok: false, error: NETWORK_ERROR };
          }
          setState(r.ok ? { ok: true } : { ok: false, error: r.error, fieldErrors: r.fieldErrors });
          resolve(r);
        });
      }),
    [action],
  );
  const reset = useCallback(() => setState({}), []);
  return { run, pending, ...state, reset };
}

/** FormData → objeto plano. Campos repetidos → array; checkboxes sin marcar no vienen (el caller decide). */
export function formValues(form: HTMLFormElement): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new FormData(form).entries()) {
    if (typeof v !== "string") continue;
    const cur = out[k];
    out[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  }
  return out;
}
