const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Argentina/Salta" });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Salta" });

export const TIMEZONE = "America/Argentina/Salta";

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d;
  return dateFmt.format(date);
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dateTimeFmt.format(typeof d === "string" ? new Date(d) : d);
}

/** USD 230.000 · $ 700.000 (sin decimales si son ,00). */
export function formatMoney(amount: string | number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === "") return "Consultar";
  const n = Number(amount);
  const hasCents = Math.round(n * 100) % 100 !== 0;
  const num = new Intl.NumberFormat("es-AR", { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 }).format(n);
  return currency === "USD" ? `USD ${num}` : `$ ${num}`;
}

export function formatArea(m2: string | number | null | undefined): string | null {
  if (m2 === null || m2 === undefined || m2 === "") return null;
  return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Number(m2))} m²`;
}
