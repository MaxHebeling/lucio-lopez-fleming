/**
 * E2E desktop (1440): centro operativo (tablero, alertas por el cron real, reasignación) y cabeceras del link público.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { e2ePool } from "./db";
import { ADMIN_EMAIL, ADMIN_PASSWORD, axeSerious, createAgent, createVisit, loginCrm, pickVisitProperty, shot, watchProblems } from "./visits-helpers";

const pool = e2ePool();
test.afterAll(async () => {
  await pool.end();
});

test.describe.configure({ mode: "serial" });

test("link del cliente: inexistente/adivinado → 404 genérico con noindex y no-store; portal con geolocalización solo para sí", async ({ request }) => {
  for (const path of [`/visita/${randomUUID().replace(/-/g, "").padEnd(43, "x")}`, "/visita/corto"]) {
    const r = await request.get(path);
    expect(r.status()).toBe(404);
    expect(r.headers()["x-robots-tag"]).toContain("noindex");
    expect(r.headers()["cache-control"]).toContain("no-store");
    expect(await r.text()).toContain("Este enlace no está disponible.");
  }
  const api = await request.get(`/api/visita/${"A".repeat(43)}`);
  expect(api.status()).toBe(404);
  expect(api.headers()["cache-control"]).toContain("no-store");
  expect(await api.json()).toEqual({ error: { code: "not_found", message: "Enlace no disponible" } });
  const crm = await request.get("/crm/mis-visitas", { maxRedirects: 0 });
  expect(crm.headers()["permissions-policy"]).toContain("geolocation=(self)");
  const home = await request.get("/");
  expect(home.headers()["permissions-policy"]).toContain("geolocation=()");
  const sitemap = await request.get("/sitemap.xml");
  expect(await sitemap.text()).not.toContain("/visita");
});

test("desktop 1440: centro operativo con alertas del cron, filtros y reasignación", async ({ page, request }) => {
  test.setTimeout(240_000);
  const cron = process.env.CRON_SECRET;
  test.skip(!cron, "requiere CRON_SECRET compartido con el servidor (scripts/e2e.sh)");
  const property = await pickVisitProperty(pool);
  const late = await createAgent(pool, "Agente Demorado E2E");
  const a = await createAgent(pool, "Agente Origen E2E");
  const b = await createAgent(pool, "Agente Destino E2E");
  const overdue = await createVisit(pool, { agentId: late.id, property, clientFirstName: "Pedro", startsInMinutes: -30, durationMinutes: 90 });
  const toMove = await createVisit(pool, { agentId: a.id, property, clientFirstName: "Sofía", startsInMinutes: 120 });

  // visits.alerts corre cada 5 minutos con dedupe por período: si otro spec ya disparó el cron en este bloque, la pasada
  // programada ya ocurrió. Se encola una ejecución puntual (misma cola, mismo handler) y la procesa el cron real.
  await pool.query("insert into jobs(type, payload, dedupe_key, max_attempts, timeout_ms) values ('visits.alerts', '{}', $1, 3, 60000)", [`e2e:visits.alerts:${randomUUID()}`]);
  const r = await request.get("/api/cron/jobs", { headers: { authorization: `Bearer ${cron}` }, timeout: 200_000 });
  expect(r.ok()).toBe(true);
  await expect
    .poll(async () => (await pool.query("select kind from visit_alerts where appointment_id = $1 and resolved_at is null", [overdue.id])).rows.map((x) => x.kind), { timeout: 30_000 })
    .toEqual(["no_checkin"]);

  const problems = await watchProblems(page);
  await loginCrm(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/crm/centro-operativo");
  await expect(page.getByRole("heading", { level: 1, name: "Centro operativo" })).toBeVisible();
  const alerts = page.getByRole("region", { name: "Alertas abiertas" }).or(page.locator("section[aria-labelledby='ops-alerts']"));
  await expect(alerts.getByText("Sin check-in después del inicio").first()).toBeVisible();
  const table = page.getByRole("region", { name: "Visitas del día" });
  await expect(table.getByRole("row", { name: /Agente Demorado E2E/ })).toBeVisible();
  expect(await axeSerious(page, "centro operativo")).toEqual([]);
  await shot(page, "20-centro-operativo-1440");

  // Filtro por agente
  await page.getByLabel("Agente", { exact: true }).selectOption(a.id);
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(new RegExp(`agente=${a.id}`));
  const row = table.getByRole("row", { name: /Agente Origen E2E/ });
  await expect(row).toBeVisible();
  await expect(table.getByRole("row", { name: /Agente Demorado E2E/ })).toHaveCount(0);

  // Reasignar
  await row.getByRole("button", { name: "Reasignar" }).click();
  const dialog = page.getByRole("dialog", { name: /Reasignar/ });
  await dialog.getByLabel("Agente").selectOption(b.id);
  await shot(page, "21-centro-operativo-reasignar-1440");
  await dialog.getByRole("button", { name: "Reasignar" }).click();
  await expect(dialog).toBeHidden();
  const moved = await pool.query<{ assigned_user_id: string; status: string }>("select assigned_user_id, status from appointments where id = $1", [toMove.id]);
  expect(moved.rows[0]).toEqual({ assigned_user_id: b.id, status: "scheduled" });
  const ev = await pool.query("select kind from appointment_events where appointment_id = $1 and kind = 'reassigned'", [toMove.id]);
  expect(ev.rowCount).toBe(1);

  // Detalle con timeline desde el centro operativo
  await page.goto(`/crm/mis-visitas/${toMove.id}`);
  await expect(page.getByRole("heading", { name: "Historial de la visita" })).toBeVisible();
  await expect(page.getByText("Agente reasignado")).toBeVisible();
  await shot(page, "22-detalle-admin-1440");
  expect(problems).toEqual([]);
});
