import { config } from "dotenv";
import { recreateLocalDatabase } from "../../scripts/db/recreate";

config({ path: ".env.local", quiet: true });

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/llf_test";
  process.env.TEST_DATABASE_URL = url;
  if (process.env.CI_DB_ALREADY_MIGRATED === "1") return;
  await recreateLocalDatabase(url);
}
