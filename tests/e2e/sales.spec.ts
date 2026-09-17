/**
 * E2E IA Fase 2 · Ventas (1440, sin ANTHROPIC_API_KEY: capa determinista real).
 * Sitio: concierge desde el home → resultados reales → ficha → «Preguntale a esta propiedad» (registrado / no registrado →
 * consulta a un asesor) → comparar 2 propiedades. CRM: perfil del contacto (agregar y confirmar), compatibles,
 * siguiente acción → aceptar crea tarea, «Ponme al día». axe sin violaciones serias y consola limpia.
 */
import { expect, test } from "@playwright/test";
import { e2ePool } from "./db";
import { login, realHouse, serious, shot, watchConsole } from "./sales-helpers";

const pool = e2ePool();
test.describe.configure({ mode: "serial" });

let contactId: string | null = null;

test.afterAll(async () => {
  if (contactId) {
    await pool.query("delete from ai_conversations where user_id = (select id from users where email = 'admin@llf.local')");
    await pool.query("delete from sales_recommendations where contact_id = $1", [contactId]);
    await pool.query("delete from tasks where entity_id in (select id from leads where contact_id = $1) or entity_id = $1", [contactId]);
    await pool.query("delete from client_preferences where contact_id = $1", [contactId]);
    await pool.query("delete from property_matches where contact_id = $1", [contactId]);
    await pool.query("delete from activities where entity_id = $1 or entity_id in (select id from leads where contact_id = $1)", [contactId]);
    await pool.query("delete from leads where contact_id = $1", [contactId]);
    await pool.query("delete from contacts where id = $1", [contactId]);
  }
  await pool.end();
});

test("sitio: concierge → resultados reales → ficha → preguntale → consulta a un asesor → comparar", async ({ page }) => {
  const problems = watchConsole(page);
  const house = await realHouse(pool);
  const max = Math.ceil(Number(house.amount) / 1000) * 1000;

  await page.goto("/");
  const concierge = page.getByRole("search", { name: "Búsqueda en lenguaje natural" });
  await expect(concierge).toBeVisible();
  await concierge.getByRole("searchbox", { name: "Contanos qué buscás" }).fill(`casa ${house.bedrooms} dormitorios hasta USD ${max.toLocaleString("es-AR")}`);
  await shot(page, "sitio-1440-home-concierge");
  await concierge.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(new RegExp(`/propiedades\\?tipo=casa&moneda=USD&precio_max=${max}&dormitorios=${house.bedrooms}$`));
  await expect(page.getByText("Entendimos:")).toBeVisible();
  const understood = page.getByRole("list", { name: "Filtros aplicados" });
  await expect(understood).toContainText("Casa");
  await expect(understood).toContainText(`${house.bedrooms}+ dormitorios`);
  await expect(understood).toContainText(`hasta USD ${max.toLocaleString("es-AR")}`);
  const count = await page.locator("#resultados-conteo").innerText();
  expect(Number(count.match(/^[\d.]+/)?.[0]?.replace(/\./g, ""))).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  expect(await serious(page, "main")).toEqual([]);
  await shot(page, "sitio-1440-listado-concierge");

  // Sin filtros concretos: se explica y no se inventa nada
  await page.goto("/");
  const box = page.getByRole("searchbox", { name: "Contanos qué buscás" });
  await box.fill("algo tranquilo cerca de la ciudad");
  await box.press("Enter");
  await expect(page.getByText("No encontramos filtros concretos en tu búsqueda.")).toBeVisible();
  await expect(page.getByText("tranquilo (no filtra)")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  // Ficha real
  await page.goto(`/propiedades/${house.slug}`);
  const qa = page.locator("[data-property-qa]");
  await qa.locator("summary").click();
  const question = qa.getByRole("textbox", { name: "Tu pregunta sobre esta propiedad" });
  await question.fill("¿Cuántos dormitorios tiene?");
  await qa.getByRole("button", { name: "Preguntar" }).click();
  const answer = qa.getByRole("region", { name: "Respuesta sobre la propiedad" });
  await expect(answer).toContainText(`Tiene ${house.bedrooms} dormitorios.`);
  await expect(answer).toContainText("Fuente: datos publicados de la ficha");
  await question.fill("¿Tiene la escritura al día?");
  await qa.getByRole("button", { name: "Preguntar" }).click();
  await expect(answer).toContainText("Ese dato no está registrado actualmente.");
  await page.waitForLoadState("networkidle");
  expect(await serious(page, "main")).toEqual([]);
  await shot(page, "sitio-1440-ficha-preguntale");
  await answer.getByRole("button", { name: "Consultar a un asesor" }).click();
  const consulta = page.locator("#consulta");
  await expect(consulta.getByRole("textbox", { name: "Mensaje" })).toHaveValue(new RegExp(`Cód\\. ${house.code}: ¿Tiene la escritura al día\\?`));
  await expect(consulta.getByRole("textbox", { name: "Nombre y apellido" })).toBeFocused();

  // Comparar: la ficha + otra del listado
  await page.getByRole("button", { name: `Comparar la propiedad código ${house.code}` }).click();
  await expect(page.getByRole("region", { name: "Propiedades para comparar" })).toContainText("1 de 3");
  await page.goto("/propiedades/venta?tipo=casa");
  await page.locator(`button.compare-toggle:not([aria-pressed="true"])`).first().click();
  const tray = page.getByRole("region", { name: "Propiedades para comparar" });
  await expect(tray).toContainText("2 de 3");
  await tray.getByRole("link", { name: "Comparar" }).click();
  await expect(page).toHaveURL(/\/propiedades\/comparar\?codigos=\d+,\d+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Comparar propiedades" })).toBeVisible();
  const table = page.getByRole("region", { name: "Tabla comparativa (desplazable)" });
  await expect(table.locator("thead th")).toHaveCount(2);
  await expect(table.getByRole("rowheader", { name: /Precio de venta/ })).toBeVisible();
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
  await page.waitForLoadState("networkidle");
  expect(await serious(page, "main")).toEqual([]);
  await shot(page, "sitio-1440-comparador", true);
  expect(problems).toEqual([]);
});

test("CRM: perfil (agregar y confirmar), compatibles, siguiente acción → tarea y «Ponme al día»", async ({ page }) => {
  const problems = watchConsole(page);
  const house = await realHouse(pool);
  const admin = (await pool.query<{ id: string; organization_id: string }>("select id, organization_id from users where email = 'admin@llf.local'")).rows[0]!;
  contactId = (await pool.query<{ id: string }>("insert into contacts(organization_id, display_name, kind, assigned_user_id) values ($1, 'Cliente E2E Ventas', 'person', $2) returning id", [admin.organization_id, admin.id])).rows[0]!.id;
  const lead = (
    await pool.query<{ id: string }>(
      "insert into leads(organization_id, contact_id, source_key, property_id, assigned_user_id, created_at, message) values ($1, $2, 'web_property', $3, $4, now() - interval '5 hours', 'Pide coordinar una visita') returning id",
      [admin.organization_id, contactId, house.id, admin.id],
    )
  ).rows[0]!;
  await pool.query("insert into activities(entity_type, entity_id, kind, summary, metadata) values ('contact', $1, 'visit_requested', 'Pidió coordinar una visita desde el sitio', $2)", [contactId, JSON.stringify({ leadId: lead.id, propertyId: house.id })]);
  await pool.query("insert into client_preferences(organization_id, contact_id, field, value, source, confidence, status) values ($1, $2, 'budget', $3, 'concierge', 0.81, 'suggested')", [
    admin.organization_id,
    contactId,
    JSON.stringify({ min: null, max: Number(house.amount) + 10000, currency: "USD" }),
  ]);

  await login(page);
  await page.goto(`/crm/contactos/${contactId}`);
  const profile = page.locator("section", { has: page.getByRole("heading", { name: "Perfil de búsqueda" }) });
  await expect(profile).toContainText("Sugerido");
  await expect(profile).toContainText("Búsqueda en el sitio (concierge) · confianza alta");
  await profile.getByRole("button", { name: "+ Tipo de propiedad" }).click();
  const dialog = page.getByRole("dialog", { name: "Agregar: Tipo de propiedad" });
  await dialog.getByRole("checkbox", { name: "Casa", exact: true }).check();
  await dialog.getByRole("button", { name: "Guardar como confirmado" }).click();
  await expect(dialog).toBeHidden();
  await expect(profile.getByText("Casa", { exact: false }).first()).toBeVisible();
  await profile.getByRole("button", { name: "+ Operación" }).click();
  const opDialog = page.getByRole("dialog", { name: "Agregar: Operación" });
  await opDialog.getByRole("combobox", { name: "Valor" }).selectOption("sale");
  await opDialog.getByRole("button", { name: "Guardar como confirmado" }).click();
  await expect(opDialog).toBeHidden();
  await profile.getByRole("button", { name: "Confirmar" }).click();
  await expect(profile.getByText("Sugerido")).toHaveCount(0);
  await expect(profile).toContainText(`Hasta USD ${(Number(house.amount) + 10000).toLocaleString("es-AR")}`);

  const compatible = page.locator("section", { has: page.getByRole("heading", { name: "Propiedades compatibles" }) });
  await expect(compatible.getByText(/Coincidencia estimada \d+ %/).first()).toBeVisible();
  await expect(compatible).toContainText("Nada se envía al cliente automáticamente");

  const next = page.locator("section", { has: page.getByRole("heading", { name: "Siguiente acción sugerida" }) });
  const visit = next.getByRole("listitem").filter({ hasText: "Coordinar visita" });
  await expect(visit).toContainText(`Pidió visitar la propiedad #${house.code}`);
  const signals = page.locator("section", { has: page.getByRole("heading", { name: "Señales de interés" }) });
  await expect(signals).toContainText(`Solicitó visitar la propiedad #${house.code}`);
  expect(await serious(page, "main")).toEqual([]);
  await shot(page, "crm-1440-contacto-ventas", true);
  await visit.getByRole("button", { name: "Aceptar y crear tarea" }).click();
  await expect(next.getByRole("listitem").filter({ hasText: "Coordinar visita" })).toHaveCount(0);
  const task = await pool.query("select title, entity_type from tasks where entity_id = $1 and status = 'open'", [contactId]);
  expect(task.rows).toEqual([{ title: `Coordinar visita a la propiedad #${house.code}`, entity_type: "contact" }]);

  // Lead: resumen y siguiente acción
  await page.goto(`/crm/leads/${lead.id}`);
  const summary = page.locator("section", { has: page.getByRole("heading", { name: "Resumen del lead" }) });
  await expect(summary).toContainText("Para averiguar en la conversación");
  await expect(summary).toContainText(`#${house.code}`);
  expect(await serious(page, "main")).toEqual([]);
  await shot(page, "crm-1440-lead-resumen", true);

  // «Ponme al día» en el copiloto
  await page.keyboard.press("ControlOrMeta+i");
  const copilot = page.getByRole("dialog", { name: "Asistente IA" });
  await copilot.getByRole("tab", { name: /Analista/ }).click();
  await copilot.getByRole("button", { name: "Ponme al día con este cliente" }).click();
  const facts = copilot.getByRole("article", { name: "Respuesta del asistente" }).last();
  await expect(facts.getByRole("region", { name: /Hechos: Ponme al día · Cliente E2E Ventas/ })).toBeVisible();
  await expect(facts).toContainText("Presupuesto: Hasta USD");
  await expect(facts).toContainText("Solicitó visitar");
  expect(await serious(page, "dialog[open]")).toEqual([]);
  await shot(page, "crm-1440-ponme-al-dia");
  expect(problems).toEqual([]);
});
