/**
 * Criterio único de qué ve un propietario de sus informes (portal y descarga de archivos).
 * Un informe generado lo revisa el equipo; en cola, fallido o sin credenciales todavía no se le entregó.
 */
export const OWNER_VISIBLE_REPORT_STATUSES = ["sent", "delivered"] as const;

export function isReportVisibleToOwner(status: string): boolean {
  return (OWNER_VISIBLE_REPORT_STATUSES as readonly string[]).includes(status);
}
