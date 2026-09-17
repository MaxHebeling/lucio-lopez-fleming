"use client";

import { Button } from "@/components/ui";

/** "Descargar PDF": abre el diálogo de impresión del navegador (Guardar como PDF) con la hoja de estilos de impresión. */
export function PrintButton({ label = "Descargar PDF" }: { label?: string }) {
  return (
    <Button variant="secondary" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
