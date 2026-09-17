"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/** Copia al portapapeles con confirmación visible y anunciada (aria-live). Si el navegador no deja, lo dice. */
export function CopyButton({ text, label, className, variant = "secondary", onCopied }: { text: string; label: string; className?: string; variant?: "primary" | "secondary"; onCopied?: () => void }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      variant={variant}
      className={className}
      onClick={() => {
        if (!navigator.clipboard) {
          setState("failed");
          return;
        }
        navigator.clipboard.writeText(text).then(
          () => {
            setState("copied");
            onCopied?.();
            window.setTimeout(() => setState("idle"), 2500);
          },
          () => setState("failed"),
        );
      }}
    >
      <span aria-live="polite">{state === "copied" ? "Copiado ✓" : state === "failed" ? "No se pudo copiar" : label}</span>
    </Button>
  );
}
