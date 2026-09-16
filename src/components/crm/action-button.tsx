"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { ActionResult } from "@/server/next/action";
import { Button } from "@/components/ui";
import { useAction } from "./use-action";

type Props<T> = {
  action: () => Promise<ActionResult<T>>;
  children: ReactNode;
  pendingLabel?: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
  /** Adónde ir si sale bien; `{id}` se reemplaza por `data.id`. Sin esto se refresca la página. */
  successHref?: string;
  disabled?: boolean;
  title?: string;
};

/** Botón que ejecuta una Server Action con confirmación opcional y error visible junto al botón. */
export function ActionButton<T>({ action, children, pendingLabel, confirm, variant = "secondary", size = "sm", className, successHref, disabled, title }: Props<T>) {
  const router = useRouter();
  const { run, pending, error } = useAction(action);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={pending || disabled}
        title={title}
        aria-busy={pending}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          const r = await run();
          if (r.ok) {
            const dataId = r.data && typeof r.data === "object" && "id" in r.data ? String((r.data as { id: unknown }).id) : "";
            if (successHref) router.push(successHref.replace("{id}", encodeURIComponent(dataId)));
            else router.refresh();
          }
        }}
      >
        {pending ? (pendingLabel ?? "Procesando…") : children}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
