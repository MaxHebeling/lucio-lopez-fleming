/**
 * Datos y utilidades de los E2E de la IA de gestión (Fase 5). Base E2E aislada y descartable (scripts/e2e.sh): cada
 * prueba crea sus propios registros con marcas únicas.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import type pg from "pg";

export { ADMIN_EMAIL, ADMIN_PASSWORD, AGENT_PASSWORD, axeSerious, createAgent, loginCrm, watchProblems } from "./visits-helpers";

export async function adminId(pool: pg.Pool, email: string): Promise<string> {
  return (await pool.query<{ id: string }>("select id from users where email = $1", [email])).rows[0]!.id;
}

/** Tarea de seguimiento vencida (aparece en «Resumen de hoy»). */
export async function overdueFollowUp(pool: pg.Pool, userId: string, title: string): Promise<string> {
  const r = await pool.query<{ id: string }>("insert into tasks(title, kind, due_at, assigned_user_id) values ($1, 'follow_up', now() - interval '3 hours', $2) returning id", [title, userId]);
  // El resumen se cachea por usuario: se marca para recalcular (lo mismo que hace el sistema al cambiar datos).
  await pool.query("update ai_daily_briefs set stale = true where user_id = $1", [userId]);
  return r.rows[0]!.id;
}

/** Visita finalizada hace 3 h sin informe (genera «Cargar el informe de la visita» en Tareas sugeridas). */
export async function finishedVisitWithoutReport(pool: pg.Pool, userId: string): Promise<{ id: string; code: number }> {
  const p = (await pool.query<{ id: string; code: number }>("select id, code from properties where deleted_at is null and not is_demo order by code desc limit 1")).rows[0]!;
  const r = await pool.query<{ id: string }>(
    `insert into appointments(kind, title, starts_at, ends_at, status, finished_at, property_id, assigned_user_id)
     values ('visit', 'Visita E2E gestión', now() - interval '4 hours', now() - interval '3 hours', 'completed', now() - interval '3 hours', $1, $2) returning id`,
    [p.id, userId],
  );
  return { id: r.rows[0]!.id, code: p.code };
}

/** Capturas opcionales para revisión visual: MGMT_SHOTS_DIR=/ruta. */
export async function shot(page: Page, name: string) {
  const dir = process.env.MGMT_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}
