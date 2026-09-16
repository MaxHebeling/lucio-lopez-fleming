import { afterAll, beforeAll } from "vitest";
import { config } from "dotenv";
import { createDb, setDbForTests } from "../../src/server/db";
import { resetBusinessData } from "./db";

config({ path: ".env.local", quiet: true });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/llf_test";

const holder = createDb(process.env.DATABASE_URL, 5);
setDbForTests(holder);

beforeAll(async () => {
  await resetBusinessData(holder.db);
});

afterAll(async () => {
  setDbForTests(undefined);
  await holder.pool.end();
});
