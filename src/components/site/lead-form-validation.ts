/** Validación mínima del formulario público en el navegador (la real está en el servidor): lo que el HTML nativo no cubre. */
export function clientLeadErrors(fd: FormData): Record<string, string[]> | null {
  const phone = String(fd.get("phone") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim();
  if (!phone && !email) return { phone: ["Dejanos un teléfono o un email para responderte"] };
  return null;
}
