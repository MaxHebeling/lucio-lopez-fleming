import { Bath, BedDouble, Car, Ruler } from "lucide-react";
import type { PublicPrice, PublicPropertyCard, PublicStatus } from "@/server/properties/public";
import { OPERATION_NOUN, formatArea, formatPrice } from "@/server/properties/public-helpers";

export const STATUS_BADGE: Record<PublicStatus, string | null> = { available: null, reserved: "Reservada", sold: "Vendida", rented: "Alquilada" };

export function priceLabel(p: PublicPrice): string {
  return formatPrice(p.amount, p.currency, p.priceHidden);
}

/** Precio principal + otras operaciones ("También en alquiler: $ 700.000"). */
export function PriceBlock({ prices, size = "md" }: { prices: PublicPrice[]; size?: "md" | "lg" }) {
  if (!prices.length) return <p className="font-semibold">Consultar</p>;
  const [main, ...rest] = prices;
  return (
    <div>
      <p className={`tabular font-semibold tracking-[-0.01em] ${size === "lg" ? "text-3xl lg:text-4xl" : "text-lg"}`}>
        <span className="sr-only">Precio de {OPERATION_NOUN[main!.operation]}: </span>
        {priceLabel(main!)}
      </p>
      {rest.map((r) => (
        <p key={r.operation} className="tabular mt-0.5 text-sm text-ink-2">
          {OPERATION_NOUN[r.operation].replace(/^./, (c) => c.toUpperCase())}: {priceLabel(r)}
        </p>
      ))}
    </div>
  );
}

export function mainArea(p: Pick<PublicPropertyCard, "totalAreaM2" | "coveredAreaM2" | "landAreaM2">): string | null {
  return formatArea(p.coveredAreaM2 ?? p.totalAreaM2 ?? p.landAreaM2);
}

/** Datos clave en una línea: m² · dormitorios · baños · cocheras. Solo lo que existe. */
export function Specs({ p, className }: { p: PublicPropertyCard; className?: string }) {
  const area = formatArea(p.coveredAreaM2 ?? p.totalAreaM2) ?? formatArea(p.landAreaM2);
  const items = [
    area ? { icon: Ruler, label: area, sr: p.coveredAreaM2 ? "cubiertos" : "de superficie" } : null,
    p.bedrooms ? { icon: BedDouble, label: String(p.bedrooms), sr: p.bedrooms === 1 ? "dormitorio" : "dormitorios" } : null,
    p.bathrooms ? { icon: Bath, label: String(p.bathrooms), sr: p.bathrooms === 1 ? "baño" : "baños" } : null,
    p.garages ? { icon: Car, label: String(p.garages), sr: p.garages === 1 ? "cochera" : "cocheras" } : null,
  ].filter(Boolean) as Array<{ icon: typeof Ruler; label: string; sr: string }>;
  if (!items.length) return null;
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2 ${className ?? ""}`}>
      {items.map(({ icon: Icon, label, sr }) => (
        <li key={sr} className="tabular inline-flex items-center gap-1.5">
          <Icon aria-hidden className="size-4 opacity-70" strokeWidth={1.6} />
          {label}
          <span className="sr-only"> {sr}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatusBadge({ status, className }: { status: PublicStatus; className?: string }) {
  const label = STATUS_BADGE[status];
  if (!label) return null;
  return <span className={`inline-flex items-center rounded-full bg-ink px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-paper ${className ?? ""}`}>{label}</span>;
}
