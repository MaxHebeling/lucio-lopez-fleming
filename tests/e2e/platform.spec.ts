/**
 * E2E de plataforma: flujos que cruzan módulos (web ↔ CRM ↔ WhatsApp ↔ cola de jobs).
 * Requiere el servidor con WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN y CRON_SECRET iguales a los de este proceso
 * (ver scripts/e2e.sh) y un usuario administrador E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
 */
import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { cleanupE2eContact, e2ePool } from "./db";

const pool = e2ePool();
test.afterAll(async () => {
  await pool.end();
});

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@llf.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin-local-2026";

async function loginCrm(page: Page) {
  await page.goto("/crm/login");
  await page.fill("#email", ADMIN_EMAIL);
  await page.fill("#password", ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/crm$/);
}

async function pickProperty() {
  const r = await pool.query<{ id: string; slug: string; code: number; amount: string }>(
    `select p.id, p.slug, p.code, o.amount from properties p join property_operations o on o.property_id = p.id and o.operation = 'sale'
     where p.is_published and p.status = 'available' and not o.price_hidden and o.amount is not null and o.currency = 'USD'
       and (select count(*) from property_media m where m.property_id = p.id and m.status <> 'failed' and m.deleted_at is null) >= 3
     order by p.code limit 1`,
  );
  return r.rows[0]!;
}

test.describe.configure({ mode: "serial" });

test("consulta web → aparece en la bandeja de leads del CRM con su propiedad", async ({ page }) => {
  const prop = await pickProperty();
  const email = `e2e-plat-${Date.now()}@prueba.test`;
  try {
    await page.goto(`/propiedades/${prop.slug}`);
    const form = page.locator("#consulta form").first();
    await form.getByLabel("Nombre y apellido").fill("Plataforma E2E");
    await form.getByLabel("Email").fill(email);
    await form.getByLabel("Mensaje").fill("Quiero visitarla");
    await form.getByRole("button", { name: "Enviar consulta" }).click();
    await expect(form.getByRole("status")).toContainText("Recibimos tu consulta");

    await loginCrm(page);
    await page.goto("/crm/leads?q=" + encodeURIComponent("Plataforma E2E"));
    const row = page.getByRole("link", { name: /Plataforma E2E/ }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByText(String(prop.code)).first()).toBeVisible();
  } finally {
    await cleanupE2eContact(pool, email);
  }
});

test("cambio de precio en el CRM se refleja en la ficha pública (y queda en el historial)", async ({ page }) => {
  const prop = await pickProperty();
  const original = Number(prop.amount);
  const nuevo = original + 1234;
  await loginCrm(page);
  try {
    await page.goto(`/crm/propiedades/${prop.id}`);
    await page.getByText("Cambiar precio o agregar operación").first().click();
    const form = page.locator("form", { has: page.getByRole("button", { name: "Guardar precio" }) }).first();
    await form.getByRole("spinbutton", { name: "Precio", exact: true }).fill(String(nuevo));
    await form.getByLabel("Motivo del cambio").fill("E2E consistencia CRM → web");
    await form.getByRole("button", { name: "Guardar precio" }).click();
    await expect(form.getByText("Precio guardado.")).toBeVisible();

    const pub = await page.request.get(`/propiedades/${prop.slug}`);
    const html = await pub.text();
    expect(html).toContain(new Intl.NumberFormat("es-AR").format(nuevo));
    const hist = await pool.query("select 1 from property_price_history where property_id = $1 and reason = 'E2E consistencia CRM → web'", [prop.id]);
    expect(hist.rowCount).toBe(1);
  } finally {
    await pool.query("update property_operations set amount = $1 where property_id = $2 and operation = 'sale'", [original, prop.id]);
  }
});

test("despublicar en el CRM saca la ficha del sitio; publicar la devuelve", async ({ page }) => {
  const prop = await pickProperty();
  await loginCrm(page);
  await page.goto(`/crm/propiedades/${prop.id}`);
  page.once("dialog", (d) => d.accept("E2E"));
  await page.getByRole("button", { name: "Despublicar" }).first().click();
  await expect(page.getByRole("button", { name: "Publicar" }).first()).toBeVisible();
  expect((await page.request.get(`/propiedades/${prop.slug}`, { maxRedirects: 0 })).status()).toBe(404);

  await page.getByRole("button", { name: "Publicar" }).first().click();
  await expect(page.getByRole("button", { name: "Despublicar" }).first()).toBeVisible();
  expect((await page.request.get(`/propiedades/${prop.slug}`)).status()).toBe(200);
  // La reimportación no debe revertir la decisión humana
  const pf = await pool.query<{ protected_fields: string[] }>("select protected_fields from properties where id = $1", [prop.id]);
  expect(pf.rows[0]!.protected_fields).toContain("is_published");
});

test("WhatsApp: firma inválida 401; mensaje firmado crea conversación y lead; duplicado no reprocesa", async ({ page, request }) => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const cron = process.env.CRON_SECRET;
  test.skip(!secret || !cron, "requiere WHATSAPP_APP_SECRET y CRON_SECRET compartidos con el servidor");
  const phone = `549387${String(Date.now()).slice(-7)}`;
  const wamid = `wamid.E2E${randomUUID().replace(/-/g, "")}`;
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "e2e", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "5493870000000", phone_number_id: "e2e" },
      contacts: [{ profile: { name: "WA E2E" }, wa_id: phone }],
      messages: [{ from: phone, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Hola, busco casa en San Lorenzo" } }],
    } }] }],
  });
  const sig = "sha256=" + createHmac("sha256", secret!).update(body).digest("hex");
  const bad = await request.post("/api/webhooks/whatsapp", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" } });
  expect(bad.status()).toBe(401);
  const ok = await request.post("/api/webhooks/whatsapp", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": sig } });
  expect(ok.status()).toBe(200);
  const dup = await request.post("/api/webhooks/whatsapp", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": sig } });
  expect(dup.status()).toBe(200);

  // El procesamiento es asíncrono: se fuerza una pasada de la cola como haría el cron.
  await expect.poll(async () => {
    await request.get("/api/cron/jobs", { headers: { authorization: `Bearer ${cron}` } });
    const r = await pool.query("select count(*)::int as n from conversation_messages where external_message_id = $1", [wamid]);
    return r.rows[0].n;
  }, { timeout: 30_000 }).toBe(1);
  const lead = await pool.query("select l.source_key from leads l join contact_phones cp on cp.contact_id = l.contact_id where cp.phone_e164 = $1", [`+${phone}`]);
  expect(lead.rows.map((r) => r.source_key)).toEqual(["whatsapp"]);

  await loginCrm(page);
  await page.goto("/crm/conversaciones");
  await expect(page.getByText("WA E2E").first()).toBeVisible();

  // limpieza
  const c = await pool.query<{ contact_id: string }>("select contact_id from contact_phones where phone_e164 = $1", [`+${phone}`]);
  const ids = c.rows.map((r) => r.contact_id);
  await pool.query("delete from conversation_messages where conversation_id in (select id from conversations where contact_id = any($1::uuid[]))", [ids]);
  await pool.query("update leads set conversation_id = null where contact_id = any($1::uuid[])", [ids]);
  await pool.query("delete from ai_interactions where conversation_id in (select id from conversations where contact_id = any($1::uuid[]))", [ids]);
});

test("un usuario del equipo no entra por el login de propietarios y el portal exige sesión", async ({ page }) => {
  await page.goto("/propietarios");
  await expect(page).toHaveURL(/\/propietarios\/login/);
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Ingresar/ }).click();
  await expect(page.locator("form [role=alert]")).toBeVisible();
  await expect(page).toHaveURL(/\/propietarios\/login/);
});
