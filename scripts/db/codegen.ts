/** Genera src/server/db/generated.ts desde la base. `--verify` falla si los tipos versionados están desactualizados. */
import { spawnSync } from "node:child_process";
import { databaseUrl } from "./env";

const args = [
  "kysely-codegen", "--dialect", "postgres", "--url", databaseUrl(),
  "--out-file", "src/server/db/generated.ts", "--exclude-pattern", "schema_migrations", "--date-parser", "string",
  ...(process.argv.includes("--verify") ? ["--verify"] : []),
];
const r = spawnSync("pnpm", ["exec", ...args], { stdio: "inherit" });
process.exit(r.status ?? 1);
