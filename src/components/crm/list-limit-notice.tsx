import { Alert } from "@/components/ui";

/**
 * Aviso de lista truncada: las consultas de algunas vistas traen como máximo `limit` filas (sin paginación). Si se
 * alcanzó el tope, puede haber más y no se deben dar por completas: se pide refinar los filtros.
 * `total` es el conteo real (count(*) over() en la consulta).
 */
export function ListLimitNotice({ shown, limit, noun, total }: { shown: number; limit: number; noun: string; total?: number }) {
  if (shown < limit && (total === undefined || total <= shown)) return null;
  if (total !== undefined && total > shown) {
    return (
      <div className="mb-4">
        <Alert tone="warning">
          Se muestran {shown.toLocaleString("es-AR")} de {total.toLocaleString("es-AR")} {noun}. Refiná los filtros para ver el resto.
        </Alert>
      </div>
    );
  }
  return (
    <div className="mb-4">
      <Alert tone="warning">
        Se muestran los primeros {limit.toLocaleString("es-AR")} {noun}: puede haber más. Refiná los filtros para ver el resto.
      </Alert>
    </div>
  );
}
