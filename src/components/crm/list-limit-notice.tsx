import { Alert } from "@/components/ui";

/**
 * Aviso de lista truncada: las consultas de algunas vistas traen como máximo `limit` filas (sin paginación). Si se
 * alcanzó el tope, puede haber más y no se deben dar por completas: se pide refinar los filtros.
 * (El total exacto requiere un conteo en la consulta; ver docs de la vista.)
 */
export function ListLimitNotice({ shown, limit, noun }: { shown: number; limit: number; noun: string }) {
  if (shown < limit) return null;
  return (
    <div className="mb-4">
      <Alert tone="warning">
        Se muestran los primeros {limit.toLocaleString("es-AR")} {noun}: puede haber más. Refiná los filtros para ver el resto.
      </Alert>
    </div>
  );
}
