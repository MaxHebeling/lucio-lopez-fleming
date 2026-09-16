import { describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import "@/server/jobs/handlers";
import { enqueueScheduled, listScheduledTasks } from "@/server/jobs/scheduled";
import { runJobs } from "@/server/jobs/runner";
import { testDb } from "../helpers/db";

describe("tareas periódicas", () => {
  it("una tarea horaria ya ejecutada no se reencola en la siguiente pasada del cron del mismo período", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    const at = new Date("2026-09-16T15:10:00Z");
    const first = await enqueueScheduled(db, at);
    expect(first).toBeGreaterThanOrEqual(5); // housekeeping + tareas de integraciones
    await runJobs(db, { budgetMs: 8_000 });
    expect(await enqueueScheduled(db, new Date("2026-09-16T15:11:00Z"))).toBe(0);
    // Nueva hora: las horarias vuelven; la diaria no
    const types = await sql<{ type: string }>`select type from jobs where status = 'queued'`.execute(db);
    expect(types.rows).toHaveLength(0);
    const nextHour = await enqueueScheduled(db, new Date("2026-09-16T16:00:00Z"));
    const hourly = listScheduledTasks().filter((t) => t.every === "hourly").length;
    expect(first).toBe(listScheduledTasks().length);
    expect(nextHour).toBe(hourly);
  });
});
