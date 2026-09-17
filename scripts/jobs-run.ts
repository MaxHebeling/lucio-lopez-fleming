/** Worker local: `pnpm jobs:run` (una pasada) o `pnpm jobs:run --loop` (cada 30 s). */
import "./db/env";
import { createDb, setDbForTests } from "../src/server/db";
import { dispatchPendingEvents } from "../src/server/automation/engine";
import { enqueueScheduled } from "../src/server/jobs/scheduled";
import { runJobs } from "../src/server/jobs/runner";
import "../src/server/jobs/handlers";

const holder = createDb();
setDbForTests(holder);
const loop = process.argv.includes("--loop");
do {
  const scheduled = await enqueueScheduled(holder.db);
  const dispatched = await dispatchPendingEvents(holder.db);
  const stats = await runJobs(holder.db, { budgetMs: 270_000 });
  console.info(JSON.stringify({ scheduled, dispatched, stats }));
  if (loop) await new Promise((r) => setTimeout(r, 30_000));
} while (loop);
await holder.pool.end();
