import { describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { createProperty, updateProperty, changePrice, changeStatus, publishProperty, unpublishProperty } from "@/server/properties/service";
import { captureLead } from "@/server/leads/capture";
import { mergeContacts } from "@/server/contacts/service";
import { AppError } from "@/server/errors";
import { createStaff, testDb } from "../helpers/db";

async function locationId() {
  const db = testDb();
  const r = await db.insertInto("locations").values({ kind: "locality", name: "Salta", slug: "salta" }).onConflict((oc) => oc.doNothing()).returning("id").executeTakeFirst();
  return r?.id ?? (await db.selectFrom("locations").select("id").where("slug", "=", "salta").executeTakeFirstOrThrow()).id;
}

const baseInput = (loc: string) => ({
  title: "Casa con jardín en Tres Cerritos",
  typeKey: "casa",
  locationId: loc,
  bedrooms: 3,
  operations: [{ operation: "sale", currency: "USD", amount: 230000, priceHidden: false }],
});

describe("ciclo de vida de propiedades", () => {
  it("crear → precio → publicar → pausar: historial, auditoría y eventos completos", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const loc = await locationId();
    const p = await createProperty(db, admin, baseInput(loc));
    expect(p.slug).toMatch(/^casa-con-jardin-en-tres-cerritos-\d+$/);

    await changePrice(db, admin, p.id, { operation: "sale", currency: "USD", amount: 215000, priceHidden: false }, "Pedido del propietario");
    const history = await db.selectFrom("property_price_history").select(["previous_amount", "new_amount"]).where("property_id", "=", p.id).orderBy("id").execute();
    expect(history.map((h) => [h.previous_amount, h.new_amount])).toEqual([[null, "230000.00"], ["230000.00", "215000.00"]]);

    // Sin fotos no se publica
    await changeStatus(db, admin, p.id, "available");
    await expect(publishProperty(db, admin, p.id)).rejects.toThrow(/Falta al menos una foto/);
    await db.insertInto("property_media").values({ property_id: p.id, kind: "image", source_url: "https://example.com/a.jpg", status: "verified", is_cover: true }).execute();
    await publishProperty(db, admin, p.id);
    await publishProperty(db, admin, p.id); // idempotente

    const pubs = await db.selectFrom("property_publications").select(["channel_key", "sync_status", "desired_state"]).where("property_id", "=", p.id).execute();
    expect(pubs.find((x) => x.channel_key === "web")).toMatchObject({ sync_status: "synced", desired_state: "published" });
    expect(pubs.find((x) => x.channel_key === "argenprop")?.sync_status).toBe("disabled");

    await changeStatus(db, admin, p.id, "paused", "Propietario de viaje");
    const after = await db.selectFrom("properties").select(["is_published", "status"]).where("id", "=", p.id).executeTakeFirstOrThrow();
    expect(after).toEqual({ is_published: false, status: "paused" });

    const actions = (await db.selectFrom("audit_logs").select("action").where("entity_id", "=", p.id).orderBy("id").execute()).map((a) => a.action);
    expect(actions).toEqual(["PROPERTY_CREATED", "PROPERTY_PRICE_CHANGED", "PROPERTY_STATUS_CHANGED", "PROPERTY_PUBLISHED", "PROPERTY_STATUS_CHANGED"]);
    const events = (await db.selectFrom("domain_events").select("event_type").where("aggregate_id", "=", p.id).execute()).map((e) => e.event_type);
    expect(events).toContain("property.published");
    expect(events).toContain("property.unpublished");
    expect(events.filter((e) => e === "property.published")).toHaveLength(1);
  });

  it("transición inválida y permisos se validan en el servidor", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const agent = await createStaff(db, ["agente"]);
    const readonly = await createStaff(db, ["solo_lectura"]);
    const p = await createProperty(db, admin, baseInput(await locationId()));
    await expect(changeStatus(db, admin, p.id, "sold")).rejects.toThrow(/No se puede pasar/);
    await expect(createProperty(db, readonly, baseInput(await locationId()))).rejects.toBeInstanceOf(AppError);
    // El agente edita datos pero no cambia precio ni publica
    await updateProperty(db, agent, p.id, { bedrooms: 4 });
    await expect(changePrice(db, agent, p.id, { operation: "sale", currency: "USD", amount: 1, priceHidden: false })).rejects.toThrow(/permiso/);
    await expect(unpublishProperty(db, agent, p.id)).rejects.toThrow(/permiso/);
  });

  it("una edición humana protege el campo frente a la reimportación y conserva redirect del slug", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const p = await createProperty(db, admin, baseInput(await locationId()));
    await sql`update properties set source = 'adinco_import' where id = ${p.id}`.execute(db);
    await updateProperty(db, admin, p.id, { title: "Casa reciclada en Tres Cerritos", bedrooms: 4 });
    const row = await db.selectFrom("properties").select(["protected_fields", "slug"]).where("id", "=", p.id).executeTakeFirstOrThrow();
    expect(row.protected_fields).toEqual(expect.arrayContaining(["title", "bedrooms"]));
    expect(row.slug).not.toBe(p.slug);
    const redirect = await db.selectFrom("property_redirects").select("property_id").where("path", "=", `/propiedades/${p.slug}`).executeTakeFirst();
    expect(redirect?.property_id).toBe(p.id);
  });
});

describe("captura de leads", () => {
  it("mismo email o teléfono (con/sin 9) → mismo contacto; misma clave → mismo lead", async () => {
    const db = testDb();
    const system = { kind: "anonymous" as const, organizationId: (await db.selectFrom("organizations").select("id").executeTakeFirstOrThrow()).id };
    const a = await captureLead(db, system, { name: "Ana López", phone: "387 5775468", sourceKey: "web_contact", message: "Hola", idempotencyKey: "form-abc-123" });
    const again = await captureLead(db, system, { name: "Ana López", phone: "387 5775468", sourceKey: "web_contact", message: "Hola", idempotencyKey: "form-abc-123" });
    expect(again).toMatchObject({ leadId: a.leadId, duplicate: true });

    const wa = await captureLead(db, system, { name: "Ana", phone: "+5493875775468", phoneIsWhatsapp: true, email: "ANA@mail.com", sourceKey: "whatsapp" });
    expect(wa.contactId).toBe(a.contactId);
    expect(wa.leadId).not.toBe(a.leadId);
    const byEmail = await captureLead(db, system, { email: "ana@mail.com", sourceKey: "web_property" });
    expect(byEmail.contactId).toBe(a.contactId);

    const contact = await db.selectFrom("contacts").select("display_name").where("id", "=", a.contactId).executeTakeFirstOrThrow();
    expect(contact.display_name).toBe("Ana López");
    const events = await db.selectFrom("domain_events").select("id").where("event_type", "=", "lead.created").execute();
    expect(events).toHaveLength(3);
  });

  it("capturas concurrentes del mismo teléfono no crean contactos duplicados", async () => {
    const db = testDb();
    const actor = { kind: "anonymous" as const, organizationId: (await db.selectFrom("organizations").select("id").executeTakeFirstOrThrow()).id };
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => captureLead(db, actor, { name: `Pedro ${i}`, phone: "3874440000", sourceKey: "web_contact" })));
    expect(new Set(results.map((r) => r.contactId)).size).toBe(1);
  });

  it("coincidencia ambigua (email de uno, teléfono de otro) no fusiona: crea candidato; la fusión manual mueve todo", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const actor = { kind: "anonymous" as const, organizationId: admin.organizationId };
    const x = await captureLead(db, actor, { name: "Carlos", email: "carlos@mail.com", sourceKey: "web_contact" });
    const y = await captureLead(db, actor, { name: "Carla", phone: "3874111111", sourceKey: "web_contact" });
    const z = await captureLead(db, actor, { name: "C", email: "carlos@mail.com", phone: "3874111111", sourceKey: "whatsapp" });
    expect([x.contactId, y.contactId]).not.toContain(z.contactId);
    const candidates = await db.selectFrom("contact_duplicate_candidates").selectAll().where("status", "=", "open").execute();
    expect(candidates).toHaveLength(2);

    await expect(mergeContacts(db, await createStaff(db, ["agente"]), x.contactId, z.contactId)).rejects.toThrow(/permiso/);
    await mergeContacts(db, admin, x.contactId, z.contactId);
    const lead = await db.selectFrom("leads").select("contact_id").where("id", "=", z.leadId).executeTakeFirstOrThrow();
    expect(lead.contact_id).toBe(x.contactId);
    const merged = await db.selectFrom("contacts").select(["merged_into_id"]).where("id", "=", z.contactId).executeTakeFirstOrThrow();
    expect(merged.merged_into_id).toBe(x.contactId);
    // Tras fusionar, una nueva captura con ese teléfono va al contacto conservado o al de Carla, nunca al fusionado
    const after = await captureLead(db, actor, { phone: "3874111111", email: "carlos@mail.com", sourceKey: "web_contact" });
    expect(after.contactId).not.toBe(z.contactId);
  });

  it("lead desde ficha asigna al agente responsable de la propiedad", async () => {
    const db = testDb();
    const agent = await createStaff(db, ["agente"]);
    const p = await createProperty(db, agent, baseInput(await locationId()));
    const r = await captureLead(db, { kind: "anonymous", organizationId: agent.organizationId }, { name: "Laura", email: "laura@mail.com", sourceKey: "web_property", propertyCode: p.code });
    expect(r.assignedUserId).toBe(agent.userId);
  });
});
