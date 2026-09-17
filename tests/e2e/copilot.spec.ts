/**
 * E2E del «✦ Asistente IA» contra el build de producción SIN ANTHROPIC_API_KEY (estado real de hoy):
 * abrir desde la ficha de una propiedad con el teclado, guía real con link, modo Analista determinista, feedback,
 * accesibilidad (axe) y consola limpia. Requiere la guía ingerida (scripts/e2e.sh corre pnpm ai:knowledge:ingest).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { e2ePool } from "./db";

const pool = e2ePool();
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@llf.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin-local-2026";
const NOT_CONFIGURED = "El asistente de IA todavía no está configurado. Un administrador tiene que cargar la clave del proveedor en Integraciones.";

test.describe.configure({ mode: "serial" });

let appointmentId: string | null = null;

test.afterAll(async () => {
  if (appointmentId) await pool.query("delete from appointments where id = $1", [appointmentId]);
  await pool.query("delete from ai_conversations where user_id = (select id from users where email = $1)", [ADMIN_EMAIL]);
  await pool.end();
});

async function login(page: Page) {
  await page.goto("/crm/login");
  await page.fill("#email", ADMIN_EMAIL);
  await page.fill("#password", ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/crm$/);
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  return problems;
}

async function seriousViolations(page: Page) {
  const r = await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("desde una ficha de propiedad: atajo de teclado, «¿cómo agrego un tour 360?» con la guía real y link, feedback, axe", async ({ page }) => {
  const problems = watchConsole(page);
  const prop = (await pool.query<{ id: string; code: number }>("select id, code from properties where deleted_at is null and not is_demo order by code limit 1")).rows[0]!;
  await login(page);
  await page.goto(`/crm/propiedades/${prop.id}`);

  const launcher = page.getByRole("button", { name: "Asistente IA" });
  await expect(launcher).toBeVisible();
  await page.keyboard.press("ControlOrMeta+i");
  const dialog = page.getByRole("dialog", { name: "Asistente IA" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`Contexto: Propiedad #${prop.code}`)).toBeVisible();
  await expect(dialog.getByRole("status").filter({ hasText: NOT_CONFIGURED })).toBeVisible();
  await expect(dialog.getByRole("tab", { name: /Asistente/ })).toHaveAttribute("aria-selected", "true");

  const input = dialog.getByRole("textbox", { name: "Pregunta sobre cómo usar el CRM" });
  await expect(input).toBeFocused();
  await input.fill("¿cómo agrego un tour 360?");
  await input.press("Enter");

  const answer = dialog.getByRole("article", { name: "Respuesta del asistente" }).last();
  await expect(answer.getByText("Esto es lo que dice la guía del CRM:")).toBeVisible();
  await expect(answer.getByText("Guía del CRM · sin IA")).toBeVisible();
  await expect(answer.getByText("Agregar un tour 360° a una propiedad", { exact: true })).toBeVisible();
  const link = answer.getByRole("link", { name: new RegExp(`Ir a la pantalla \\(/crm/propiedades/${prop.id}/tour\\)`) }).first();
  await expect(link).toHaveAttribute("href", `/crm/propiedades/${prop.id}/tour`);

  expect(await seriousViolations(page)).toEqual([]);

  await answer.getByRole("button", { name: "Me sirvió", exact: true }).click();
  await expect(answer.getByText("¡Gracias!")).toBeVisible();
  await answer.getByRole("textbox", { name: "Comentario opcional sobre la respuesta" }).fill("Clarísimo, e2e");
  await answer.getByRole("button", { name: "Enviar comentario" }).click();
  await expect(answer.getByRole("button", { name: "Enviar comentario" })).toBeHidden();
  const fb = await pool.query("select rating, comment from ai_feedback where comment = 'Clarísimo, e2e'");
  expect(fb.rows).toEqual([{ rating: 1, comment: "Clarísimo, e2e" }]);

  // El link lleva al editor del tour de ESA propiedad y cierra el panel
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/crm/propiedades/${prop.id}/tour$`));
  await expect(dialog).toBeHidden();
  expect(problems).toEqual([]);
});

test("modo Analista sin IA: «Visitas de hoy» con datos reales; Esc cierra; consola limpia", async ({ page }) => {
  const problems = watchConsole(page);
  const admin = (await pool.query<{ id: string }>("select id from users where email = $1", [ADMIN_EMAIL])).rows[0]!;
  const prop = (await pool.query<{ id: string }>("select id from properties where deleted_at is null and not is_demo order by code limit 1")).rows[0]!;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const ins = await pool.query<{ id: string }>(
    `insert into appointments(kind, title, starts_at, ends_at, property_id, assigned_user_id)
     values ('visit', 'Visita E2E del copiloto', $1::timestamptz, $1::timestamptz + interval '30 minutes', $2, $3)
     on conflict do nothing returning id`,
    [`${day}T23:10:00-03:00`, prop.id, admin.id],
  );
  appointmentId = ins.rows[0]?.id ?? null;

  await login(page);
  await page.goto("/crm/agenda");
  await page.getByRole("button", { name: "Asistente IA" }).click();
  const dialog = page.getByRole("dialog", { name: "Asistente IA" });
  await dialog.getByRole("tab", { name: /Analista/ }).click();
  await dialog.getByRole("button", { name: "Visitas de hoy" }).click();
  const answer = dialog.getByRole("article", { name: "Respuesta del asistente" }).last();
  await expect(answer.getByText("Datos directos del CRM · sin IA")).toBeVisible();
  await expect(answer.getByRole("region", { name: "Hechos: Visitas de hoy" })).toBeVisible();
  await expect(answer.getByRole("link", { name: /Visita E2E del copiloto/ })).toHaveAttribute("href", `/crm/agenda/${appointmentId}`);
  expect(await seriousViolations(page)).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Asistente IA" })).toBeFocused();
  expect(problems).toEqual([]);
});
