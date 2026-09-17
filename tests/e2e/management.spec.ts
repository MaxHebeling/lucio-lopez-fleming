/**
 * E2E 1440 de la IA de gestión (Fase 5) contra el build de producción SIN clave de IA:
 * «Resumen de hoy» en el Tablero, Tareas sugeridas (aceptar → tarea real), Centro de comando para administración,
 * copiloto «¿Cómo estuvo la semana?» con hechos definidos y un agente sin acceso al Centro de comando.
 * Accesibilidad (axe, sin violaciones serias) y consola limpia.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { e2ePool } from "./db";
import { ADMIN_EMAIL, ADMIN_PASSWORD, AGENT_PASSWORD, adminId, axeSerious, createAgent, finishedVisitWithoutReport, loginCrm, overdueFollowUp, shot, watchProblems } from "./management-helpers";

const pool = e2ePool();
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await pool.end();
});

test("Tablero: «Resumen de hoy» con conteos reales, link a la lista filtrada y «¿Cómo se calcula?»", async ({ page }) => {
  const problems = await watchProblems(page);
  const admin = await adminId(pool, ADMIN_EMAIL);
  await overdueFollowUp(pool, admin, "Seguimiento vencido E2E de gestión");
  await loginCrm(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const card = page.getByRole("region", { name: "Resumen de hoy" });
  await expect(card).toBeVisible();
  await expect(card.getByText(/^(Buen día|Buenas tardes|Buenas noches), /)).toBeVisible();
  const followUps = card.getByRole("link", { name: /seguimientos? vencidos?/ });
  await expect(followUps).toHaveAttribute("href", "/crm/tareas?status=overdue&kind=follow_up&view=team");
  await card.getByText("¿Cómo se calcula?").click();
  await expect(card.getByText(/Tareas abiertas de tipo seguimiento con vencimiento anterior a ahora/)).toBeVisible();
  await shot(page, "01-tablero-resumen-1440");
  const axe = await new AxeBuilder({ page }).include("#resumen-de-hoy").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await followUps.click();
  await expect(page).toHaveURL(/\/crm\/tareas\?status=overdue&kind=follow_up&view=team$/);
  await expect(page.getByText("Seguimiento vencido E2E de gestión")).toBeVisible();
  expect(problems).toEqual([]);
});

test("Tareas sugeridas: «Actualizar», aceptar crea la tarea real y la sugerencia sale de la bandeja", async ({ page }) => {
  const problems = await watchProblems(page);
  const admin = await adminId(pool, ADMIN_EMAIL);
  const visit = await finishedVisitWithoutReport(pool, admin);
  await loginCrm(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.getByRole("navigation").getByRole("link", { name: "Tareas sugeridas" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Tareas sugeridas" })).toBeVisible();
  await page.getByRole("button", { name: "Actualizar sugerencias" }).click();
  const title = `Cargar el informe de la visita (Prop. ${visit.code})`;
  const item = page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) }).filter({ has: page.locator(`a[href="/crm/mis-visitas/${visit.id}"]`) });
  await expect(item).toBeVisible({ timeout: 20_000 });
  await expect(item.getByText("Visitas · cierre")).toBeVisible();
  await item.getByText("Por qué").click();
  await expect(item.getByText("Sin informe", { exact: true })).toBeVisible();
  await shot(page, "02-tareas-sugeridas-1440");
  expect(await axeSerious(page, "tareas sugeridas")).toEqual([]);
  await item.getByRole("button", { name: "Aceptar y crear tarea" }).click();
  await expect(page).toHaveURL(/tarea=aceptada/);
  await expect(page.getByText(/Listo: la tarea quedó creada/)).toBeVisible();
  // Sale la sugerencia aceptada; queda la del agradecimiento de la misma visita.
  await expect(item).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ has: page.getByText(`Preparar el agradecimiento de la visita (Prop. ${visit.code})`, { exact: true }) }).filter({ has: page.locator(`a[href="/crm/mis-visitas/${visit.id}"]`) })).toHaveCount(1);
  const task = await pool.query<{ title: string; entity_type: string; entity_id: string; assigned_user_id: string }>("select title, entity_type, entity_id, assigned_user_id from tasks where entity_id = $1", [visit.id]);
  expect(task.rows).toEqual([{ title, entity_type: "appointment", entity_id: visit.id, assigned_user_id: admin }]);
  await page.goto("/crm/tareas?status=open");
  await expect(page.getByText(title).first()).toBeVisible();
  expect(problems).toEqual([]);
});

test("Centro de comando (administración) y copiloto «¿Cómo estuvo la semana?» con hechos definidos", async ({ page }) => {
  const problems = await watchProblems(page);
  await loginCrm(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.getByRole("link", { name: "Centro de comando" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Centro de comando" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Resumen de hoy" })).toBeVisible();
  for (const t of ["Tareas sugeridas", "Alertas y anomalías", "Calidad de las publicaciones", "Salud de la IA (24 h)"]) {
    await expect(page.getByRole("heading", { name: t })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Uso de IA" })).toHaveAttribute("href", "/crm/integraciones/ia");
  await shot(page, "03-centro-de-comando-1440");
  expect(await axeSerious(page, "centro de comando")).toEqual([]);

  await page.getByRole("button", { name: "Asistente IA" }).click();
  const dialog = page.getByRole("dialog", { name: "Asistente IA" });
  await dialog.getByRole("tab", { name: /Analista/ }).click();
  await dialog.getByRole("button", { name: "¿Cómo estuvo la semana?" }).click();
  const answer = dialog.getByRole("article", { name: "Respuesta del asistente" }).last();
  const facts = answer.getByRole("region", { name: "Hechos: ¿Cómo estuvo la semana?" });
  await expect(facts).toBeVisible();
  await expect(facts.getByText(/^Período: Últimos 7 días/)).toBeVisible();
  await expect(facts.getByText("Leads nuevos", { exact: true })).toBeVisible();
  await expect(facts.getByText(/^Definición: Consultas creadas en el período/)).toBeVisible();
  await shot(page, "04-copiloto-semana-1440");
  const axe = await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  expect(problems).toEqual([]);
});

test("un agente no ve ni puede abrir el Centro de comando; sí su bandeja de Tareas sugeridas", async ({ page }) => {
  const problems = await watchProblems(page);
  const agent = await createAgent(pool, "Agente Gestión E2E");
  await loginCrm(page, agent.email, AGENT_PASSWORD);
  await expect(page.getByRole("link", { name: "Centro de comando" })).toHaveCount(0);
  await page.goto("/crm/centro-de-comando");
  await expect(page).toHaveURL(/\/crm\?sin-permiso=1$/);
  await expect(page.getByText("No tenés permiso para la sección a la que intentaste entrar.")).toBeVisible();
  await page.goto("/crm/tareas-sugeridas?vista=equipo");
  await expect(page.getByRole("heading", { level: 1, name: "Tareas sugeridas" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Vista" })).toHaveCount(0);
  await expect(page.getByText("No hay tareas sugeridas pendientes")).toBeVisible();
  expect(problems).toEqual([]);
});
