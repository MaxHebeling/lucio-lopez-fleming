import { config } from "dotenv";

// Carga .env.local y .env (en ese orden) sin pisar variables ya definidas en el entorno.
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

export function databaseUrl(argv = process.argv): string {
  const i = argv.indexOf("--url");
  const url = i >= 0 ? argv[i + 1] : process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (o --url postgres://...)");
  return url;
}

export function sslConfig(): false | { rejectUnauthorized: boolean; ca?: string } {
  const mode = (process.env.DATABASE_SSL ?? "disable").toLowerCase();
  if (mode === "disable" || mode === "false" || mode === "") return false;
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
  return { rejectUnauthorized: mode !== "no-verify", ...(ca ? { ca } : {}) };
}

/** Oculta credenciales al loguear una URL de conexión. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<url inválida>";
  }
}
