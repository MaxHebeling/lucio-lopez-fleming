import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { organizationId } from "@/server/org";
import { resetFlagCache } from "@/server/flags";
import {
  getPublicFacets,
  getPublicPropertyBySlug,
  getRecentProperties,
  getShowcaseProperties,
  getSimilarProperties,
  listPublishedForSitemap,
  publicTextSearchCondition,
  resetPublicLocationCache,
  resolveLegacyPath,
  searchPublicProperties,
} from "@/server/properties/public";
import { parseSearchFilters } from "@/server/properties/public-helpers";
import { getZoneShowcase, listListingCombinations, resolveLegacyTarget } from "@/server/properties/public-home";
import { submitPublicLead } from "@/server/site/leads";
import { loadSiteInfo } from "@/server/site/info";
import { testDb } from "../helpers/db";

/**
 * Sitio público: los DTOs no filtran datos privados y respetan publicación, privacidad de la dirección,
 * precio oculto, fotos fallidas y perfil público del asesor. Formularios: flag, honeypot, rate limit, idempotencia.
 */

const SECRET = {
  ownerName: "Propietario Secreto Pérez",
  ownerDoc: "20123456789",
  docTitle: "Escritura confidencial",
  note: "Nota interna: el dueño acepta 180k",
  addressNumber: "4321",
  hiddenPrice: "987654",
  failedPhoto: "https://example.com/rota.jpg",
  privatePhone: "+5493870000001",
  lat: "-24.787654",
  lng: "-65.412345",
};

type Ids = { published: string; unpublished: string; sold: string; archived: string; land: string };
let ids: Ids;

async function insertProperty(o: {
  code: number;
  slug: string;
  title: string;
  type?: string;
  status?: string;
  published?: boolean;
  location: string;
  hide?: boolean;
  lat?: string | null;
  lng?: string | null;
  bedrooms?: number;
  featured?: boolean;
  publishedAt?: string;
}) {
  const db = testDb();
  const org = await organizationId(db);
  const branch = await db.selectFrom("branches").select("id").where("is_main", "=", true).executeTakeFirstOrThrow();
  const row = await db
    .insertInto("properties")
    .values({
      organization_id: org,
      branch_id: branch.id,
      code: o.code,
      slug: o.slug,
      title: o.title,
      description: "Descripción pública de prueba.",
      type_key: o.type ?? "casa",
      status: o.status ?? "available",
      is_published: o.published ?? true,
      published_at: o.published === false && o.status !== "archived" ? null : (o.publishedAt ?? new Date().toISOString()),
      featured: o.featured ?? false,
      location_id: o.location,
      address_street: "Mitre",
      address_number: SECRET.addressNumber,
      hide_exact_address: o.hide ?? true,
      latitude: o.lat === undefined ? SECRET.lat : o.lat,
      longitude: o.lng === undefined ? SECRET.lng : o.lng,
      bedrooms: o.bedrooms ?? 3,
      total_area_m2: "250",
      protected_fields: ["title"],
      source: "adinco_import",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function addPhotos(propertyId: string, n: number, status = "verified") {
  const db = testDb();
  for (let i = 0; i < n; i++) {
    await db.insertInto("property_media").values({ property_id: propertyId, kind: "image", source_url: `https://static1.adinco.net/test/${propertyId}-${i}.jpg`, status, sort_order: i + 1, is_cover: i === 1 }).execute();
  }
}

beforeAll(async () => {
  const db = testDb();
  resetPublicLocationCache();
  const ins = async (kind: string, name: string, slug: string, parent: string | null) =>
    (await db.insertInto("locations").values({ kind, name, slug, parent_id: parent }).returning("id").executeTakeFirstOrThrow()).id;
  const prov = await ins("province", "Salta", "salta", null);
  const salta = await ins("locality", "Salta", "salta", prov);
  const saltaN = await ins("neighborhood", "Salta", "salta", salta);
  const tresCerritos = await ins("neighborhood", "Tres Cerritos", "tres-cerritos", salta);
  const vsl = await ins("locality", "Villa San Lorenzo", "villa-san-lorenzo", prov);
  const praderas = await ins("gated_community", "Praderas San Lorenzo", "praderas-san-lorenzo", vsl);
  void saltaN; // barrio comodín con el mismo nombre que la localidad (como crea el importador)

  const published = await insertProperty({ code: 9001, slug: "casa-venta-tres-cerritos-9001", title: "CASA EN VENTA", location: tresCerritos, featured: true });
  const unpublished = await insertProperty({ code: 9002, slug: "casa-borrador-9002", title: "Casa borrador", status: "draft", published: false, location: tresCerritos });
  const sold = await insertProperty({ code: 9003, slug: "casa-vendida-9003", title: "Casa vendida", status: "sold", location: tresCerritos });
  const archived = await insertProperty({ code: 9004, slug: "casa-archivada-9004", title: "Casa archivada", status: "archived", published: false, location: praderas });
  const land = await insertProperty({ code: 9005, slug: "terreno-praderas-9005", title: "Lote en Praderas", type: "terreno", location: praderas, hide: false, bedrooms: 0 });
  await sql`update properties set published_at = now() - interval '1 year' where id = ${archived}`.execute(db);
  ids = { published, unpublished, sold, archived, land };

  await db
    .insertInto("property_operations")
    .values([
      { property_id: published, operation: "sale", currency: "USD", amount: "250000" },
      { property_id: published, operation: "rent", currency: "ARS", amount: SECRET.hiddenPrice, price_hidden: true },
      { property_id: unpublished, operation: "sale", currency: "USD", amount: "100000" },
      { property_id: sold, operation: "sale", currency: "USD", amount: "240000" },
      { property_id: archived, operation: "sale", currency: "USD", amount: "90000" },
      { property_id: land, operation: "sale", currency: "USD", amount: "60000" },
    ])
    .execute();
  await addPhotos(published, 9);
  await addPhotos(unpublished, 2);
  await addPhotos(land, 2);
  await db.insertInto("property_media").values({ property_id: published, kind: "image", source_url: SECRET.failedPhoto, status: "failed", sort_order: 0 }).execute();

  // Datos privados alrededor de la propiedad publicada
  const org = await organizationId(db);
  const owner = await db.insertInto("contacts").values({ organization_id: org, display_name: SECRET.ownerName, document_type: "cuit", document_number: SECRET.ownerDoc }).returning("id").executeTakeFirstOrThrow();
  await db.insertInto("property_owners").values({ property_id: published, contact_id: owner.id, is_primary: true }).execute();
  const file = await db
    .insertInto("files")
    .values({ storage_driver: "local", bucket: "private", storage_key: "docs/escritura.pdf", content_type: "application/pdf", size_bytes: 10, visibility: "private" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db.insertInto("property_documents").values({ property_id: published, file_id: file.id, kind: "deed", title: SECRET.docTitle }).execute();
  await db.insertInto("notes").values({ entity_type: "property", entity_id: published, body: SECRET.note }).execute();

  // Asesor público con WhatsApp en la publicada; asesor sin perfil público en el terreno
  const pub = await db
    .insertInto("users")
    .values({ organization_id: org, email: "asesora@test.local", full_name: "Asesora Pública", whatsapp_e164: "+5493875000000", phone: SECRET.privatePhone, public_profile: true, kind: "staff" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const priv = await db
    .insertInto("users")
    .values({ organization_id: org, email: "privado@test.local", full_name: "Asesor Privado", whatsapp_e164: SECRET.privatePhone, public_profile: false, kind: "staff" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db.insertInto("property_agents").values([
    { property_id: published, user_id: pub.id, role: "lead" },
    { property_id: land, user_id: priv.id, role: "lead" },
  ]).execute();
  await db.insertInto("property_redirects").values([
    { path: "/luciolopez-9001", property_id: published },
    { path: "/luciolopez-9002", property_id: unpublished },
    { path: "/propiedades/casa-titulo-viejo-9001", property_id: published },
  ]).execute();
});

describe("DTOs públicos de propiedades", () => {
  it("la ficha publicada no filtra datos privados", async () => {
    const db = testDb();
    const r = await getPublicPropertyBySlug(db, "casa-venta-tres-cerritos-9001");
    expect(r.kind).toBe("found");
    if (r.kind !== "found") return;
    const json = JSON.stringify(r.property);
    for (const secret of Object.values(SECRET)) expect(json).not.toContain(secret);
    expect(json).not.toMatch(/protected_fields|adinco_import|imported_at|organization_id/);
    expect(r.property.street).toBe("Mitre");
    expect(r.property.coordinates).toEqual({ lat: -24.79, lng: -65.41, approximate: true });
    // Precio oculto: la operación figura, el monto no
    expect(r.property.prices).toEqual([
      { operation: "sale", currency: "USD", amount: 250000, priceHidden: false, expenses: null },
      { operation: "rent", currency: "ARS", amount: null, priceHidden: true, expenses: null },
    ]);
    // Fotos: sin la fallida, portada primero
    expect(r.property.photos).toHaveLength(9);
    expect(r.property.photos[0]!.url).toContain("-1.jpg");
    expect(r.property.photos[2]!.alt).toBe("Casa de 3 dormitorios en venta en Tres Cerritos — foto 3 de 9");
    expect(r.property.advisor).toEqual({ name: "Asesora Pública", whatsappE164: "+5493875000000" });
    // Titular con diferencial real (dormitorios cargados) para no repetir el de otras casas del mismo barrio
    expect(r.property.headline).toBe("Casa de 3 dormitorios en venta en Tres Cerritos");
  });

  it("dirección pública (no oculta) sí muestra altura y coordenadas exactas; asesor sin perfil público no aparece", async () => {
    const r = await getPublicPropertyBySlug(testDb(), "terreno-praderas-9005");
    expect(r.kind).toBe("found");
    if (r.kind !== "found") return;
    expect(r.property.street).toBe(`Mitre ${SECRET.addressNumber}`);
    expect(r.property.coordinates?.approximate).toBe(false);
    expect(r.property.advisor).toBeNull();
    expect(JSON.stringify(r.property)).not.toContain(SECRET.privatePhone);
    expect(r.property.zone).toMatchObject({ locality: "Villa San Lorenzo", area: "Praderas San Lorenzo", label: "Praderas San Lorenzo, Villa San Lorenzo" });
  });

  it("no publicada → not_found; slug anterior → redirect; archivada que estuvo publicada → búsqueda", async () => {
    const db = testDb();
    expect((await getPublicPropertyBySlug(db, "casa-borrador-9002")).kind).toBe("not_found");
    expect((await getPublicPropertyBySlug(db, "no-existe-123")).kind).toBe("not_found");
    expect(await getPublicPropertyBySlug(db, "casa-titulo-viejo-9001")).toEqual({ kind: "redirect", slug: "casa-venta-tres-cerritos-9001" });
    expect(await getPublicPropertyBySlug(db, "casa-archivada-9004")).toEqual({ kind: "archived", typeKey: "casa", zoneSlug: "villa-san-lorenzo", operation: "sale" });
    expect((await getPublicPropertyBySlug(db, "../../etc")).kind).toBe("not_found");
  });

  it("vendida publicada se muestra con su estado", async () => {
    const r = await getPublicPropertyBySlug(testDb(), "casa-vendida-9003");
    expect(r.kind === "found" && r.property.status).toBe("sold");
  });

  it("URLs del sitio anterior solo resuelven propiedades publicadas", async () => {
    const db = testDb();
    expect(await resolveLegacyPath(db, "/luciolopez-9001")).toBe("casa-venta-tres-cerritos-9001");
    expect(await resolveLegacyPath(db, "/luciolopez-9002")).toBeNull();
    expect(await resolveLegacyPath(db, "/luciolopez-1")).toBeNull();
  });

  it("sitio anterior: publicada → ficha; existió y no está publicada → búsqueda por tipo/operación/localidad; sin rastro → no existe", async () => {
    const db = testDb();
    expect(await resolveLegacyTarget(db, "/luciolopez-9001")).toEqual({ kind: "property", slug: "casa-venta-tres-cerritos-9001" });
    expect(await resolveLegacyTarget(db, "/luciolopez-9002")).toEqual({ kind: "search", operation: "sale", typeKey: "casa", zoneSlug: "salta" });
    expect(await resolveLegacyTarget(db, "/luciolopez-1")).toEqual({ kind: "not_found" });
    expect(await resolveLegacyTarget(db, "/../x")).toEqual({ kind: "not_found" });
  });

  it("búsqueda: solo publicadas, filtros por operación/tipo/zona/precio, precio oculto no matchea rangos", async () => {
    const db = testDb();
    const all = await searchPublicProperties(db, parseSearchFilters({}));
    expect(all.items.map((i) => i.code).sort()).toEqual([9001, 9003, 9005]);
    expect(JSON.stringify(all)).not.toContain(SECRET.hiddenPrice);

    const casasVsl = await searchPublicProperties(db, parseSearchFilters({ operacion: "venta", zona: "villa-san-lorenzo" }));
    expect(casasVsl.items.map((i) => i.code)).toEqual([9005]);
    const barrio = await searchPublicProperties(db, parseSearchFilters({ barrio: "tres-cerritos", tipo: "casa" }));
    expect(barrio.items.map((i) => i.code).sort()).toEqual([9001, 9003]);
    const rentHidden = await searchPublicProperties(db, parseSearchFilters({ operacion: "alquiler", precio_min: "1" }));
    expect(rentHidden.total).toBe(0);
    const rentAny = await searchPublicProperties(db, parseSearchFilters({ operacion: "alquiler" }));
    expect(rentAny.items.map((i) => i.code)).toEqual([9001]);
    const price = await searchPublicProperties(db, parseSearchFilters({ moneda: "USD", precio_max: "100000" }));
    expect(price.items.map((i) => i.code)).toEqual([9005]);
    const byCode = await searchPublicProperties(db, parseSearchFilters({ q: "9003" }));
    expect(byCode.items.map((i) => i.code)).toEqual([9003]);
    const sorted = await searchPublicProperties(db, parseSearchFilters({ orden: "precio-asc" }));
    expect(sorted.items.map((i) => i.code)).toEqual([9005, 9003, 9001]);
    const unknownZone = await searchPublicProperties(db, parseSearchFilters({ zona: "atlantida" }));
    expect(unknownZone.total).toBe(0);
    // Tarjetas: sin foto fallida como portada, conteo real
    expect(all.items.find((i) => i.code === 9001)?.photoCount).toBe(9);
  });

  it("búsqueda de texto no revela la calle ni la altura de direcciones ocultas (usa el índice trigram público)", async () => {
    const db = testDb();
    // Como en la importación: altura embebida en la calle. 9001 oculta; 9005 pública.
    await db.updateTable("properties").set({ address_street: "Caseros 468" }).where("code", "=", 9001).execute();
    await db.updateTable("properties").set({ address_street: "Caseros" }).where("code", "=", 9005).execute();
    try {
      for (const q of ["Caseros 468", "Caseros 46", "caseros 4"]) {
        expect((await searchPublicProperties(db, parseSearchFilters({ q }))).items.map((i) => i.code)).toEqual([]);
      }
      // La calle visible (dirección no oculta) sigue siendo buscable
      expect((await searchPublicProperties(db, parseSearchFilters({ q: "caseros" }))).items.map((i) => i.code)).toEqual([9005]);
      // El título y la descripción siguen buscando en todas
      expect((await searchPublicProperties(db, parseSearchFilters({ q: "descripción pública" }))).total).toBe(3);

      const plan = await db.transaction().execute(async (trx) => {
        await sql`set local enable_seqscan = off`.execute(trx);
        return sql<{ "QUERY PLAN": string }>`explain select p.id from properties p where ${publicTextSearchCondition("caseros")}`.execute(trx);
      });
      expect(plan.rows.map((r) => r["QUERY PLAN"]).join("\n")).toContain("properties_public_search_trgm");
    } finally {
      await db.updateTable("properties").set({ address_street: "Mitre" }).where("code", "in", [9001, 9005]).execute();
    }
  });

  it("facetas en vivo por operación, tipo y zona", async () => {
    const f = await getPublicFacets(testDb());
    expect(f.total).toBe(3);
    expect(f.operations).toEqual(expect.arrayContaining([{ slug: "venta", count: 3 }, { slug: "alquiler", count: 1 }]));
    expect(f.zones.map((z) => [z.slug, z.count])).toEqual([["salta", 2], ["villa-san-lorenzo", 1]]);
    expect(f.zones[0]!.areas).toEqual([{ slug: "tres-cerritos", name: "Tres Cerritos", count: 2 }]);
    const rent = await getPublicFacets(testDb(), "rent");
    expect(rent.total).toBe(1);
  });

  it("facetas dentro de operación y tipo: zonas y total del tipo; tipos de la operación; operaciones del tipo", async () => {
    const db = testDb();
    const saleLand = await getPublicFacets(db, "sale", "terreno");
    expect(saleLand.total).toBe(1);
    expect(saleLand.zones.map((z) => [z.slug, z.count])).toEqual([["villa-san-lorenzo", 1]]);
    expect(saleLand.types.map((t) => t.key).sort()).toEqual(["casa", "terreno"]);
    expect(saleLand.operations).toEqual([{ slug: "venta", count: 1 }]);
    const rentLand = await getPublicFacets(db, "rent", "terreno");
    expect(rentLand.total).toBe(0);
    expect(rentLand.zones).toEqual([]);
  });

  it("home: portada por zona en una consulta, sin repetir el conteo de facetas; combinaciones indexables con resultados", async () => {
    const db = testDb();
    const facets = await getPublicFacets(db);
    const zones = await getZoneShowcase(db, facets, 5);
    expect(zones.map((z) => [z.slug, z.count, Boolean(z.cover)])).toEqual([
      ["salta", 2, true],
      ["villa-san-lorenzo", 1, true],
    ]);
    expect(zones[0]!.cover?.url).toContain("static1.adinco.net");
    expect(zones[0]!.cover?.alt).toBe("Propiedad publicada en Salta");
    const combos = await listListingCombinations(db);
    const key = (c: (typeof combos)[number]) => `${c.operation}|${c.typeKey ?? "-"}|${c.zoneSlug ?? "-"}|${c.count}`;
    expect(combos.map(key).sort()).toEqual(
      ["alquiler|-|salta|1", "alquiler|casa|-|1", "alquiler|casa|salta|1", "venta|-|salta|2", "venta|-|villa-san-lorenzo|1", "venta|casa|-|2", "venta|casa|salta|2", "venta|terreno|-|1", "venta|terreno|villa-san-lorenzo|1"].sort(),
    );
  });

  it("showcase: publicadas disponibles con ≥ 8 fotos verificadas, destacadas primero; recientes y similares sin vendidas", async () => {
    const db = testDb();
    const showcase = await getShowcaseProperties(db);
    expect(showcase.map((s) => s.code)).toEqual([9001]);
    const recent = await getRecentProperties(db, 10);
    expect(recent.map((r) => r.code)).not.toContain(9003);
    const detail = await getPublicPropertyBySlug(db, "casa-vendida-9003");
    if (detail.kind !== "found") throw new Error("esperaba ficha");
    const similar = await getSimilarProperties(db, detail.property);
    expect(similar.map((s) => s.code)).toContain(9001);
    expect(similar.map((s) => s.code)).not.toContain(9002);
  });

  it("cambios de propiedades fuera de la UI invalidan el sitio: automatizaciones de sistema activas con su acción registrada", async () => {
    const { getAction } = await import("@/server/automation/actions");
    await import("@/server/site/revalidate");
    const defs = await testDb().selectFrom("automation_definitions").select(["trigger_event", "is_enabled", "is_system", "actions"]).where("key", "like", "site_revalidate_%").execute();
    expect(defs.map((d) => d.trigger_event).sort()).toEqual(["property.price_changed", "property.published", "property.status_changed", "property.unpublished", "property.updated"]);
    expect(defs.every((d) => d.is_enabled && d.is_system && JSON.stringify(d.actions) === '[{"type":"revalidate_public_site"}]')).toBe(true);
    expect(getAction("revalidate_public_site")).toBeTypeOf("function");
  });

  it("sitemap solo incluye publicadas", async () => {
    const items = await listPublishedForSitemap(testDb());
    expect(items.map((i) => i.slug).sort()).toEqual(["casa-vendida-9003", "casa-venta-tres-cerritos-9001", "terreno-praderas-9005"]);
  });

  it("info institucional pública: sedes reales, sin WhatsApp inventado", async () => {
    const info = await loadSiteInfo(testDb());
    expect(info.foundedYear).toBe(1974);
    expect(info.branches.map((b) => b.name)).toEqual(["Casa Central", "Oficina San Lorenzo Chico"]);
    expect(info.whatsappE164).toBe(process.env.SITE_WHATSAPP_E164 ? process.env.SITE_WHATSAPP_E164 : null);
  });
});

describe("formularios públicos → CRM", () => {
  const anon = async () => ({ kind: "anonymous" as const, organizationId: await organizationId(testDb()), requestId: "req-test" });

  it("consulta de ficha crea lead con la propiedad, UTM saneadas e idempotencia", async () => {
    const db = testDb();
    const input = { kind: "property", name: "Laura Gómez", phone: "387 5123456", message: "¿Sigue disponible?", propertyCode: "9001", operation: "sale", idempotencyKey: "3b6f3a0e-8b8e-4d7a-9a55-6d1f1c9b0001", utm: { utm_source: "instagram", utm_campaign: "otoño<script>", evil: "x" } };
    const a = await submitPublicLead(db, await anon(), "10.0.0.1", input);
    const b = await submitPublicLead(db, await anon(), "10.0.0.1", input);
    expect(a).toEqual({ status: "sent", duplicate: false });
    expect(b).toEqual({ status: "sent", duplicate: true });
    const leads = await db.selectFrom("leads").select(["source_key", "property_id", "utm", "operation_interest", "message"]).where("idempotency_key", "=", "web:3b6f3a0e-8b8e-4d7a-9a55-6d1f1c9b0001").execute();
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ source_key: "web_property", property_id: ids.published, operation_interest: "sale", utm: { utm_source: "instagram", utm_campaign: "otoñoscript" } });
  });

  it("tasación → web_appraisal con operación appraisal; visita → prioridad alta", async () => {
    const db = testDb();
    const r = await submitPublicLead(db, await anon(), "10.0.0.2", { kind: "appraisal", name: "Jorge Ruiz", email: "jorge@test.local", appraisalZone: "Tres Cerritos", appraisalType: "Casa", appraisalGoal: "vender" });
    expect(r.status).toBe("sent");
    const lead = await db.selectFrom("leads").select(["source_key", "operation_interest", "message"]).where("source_key", "=", "web_appraisal").executeTakeFirstOrThrow();
    expect(lead).toMatchObject({ source_key: "web_appraisal", operation_interest: "appraisal" });
    expect(lead.message).toContain("Ubicación: Tres Cerritos");
    const v = await submitPublicLead(db, await anon(), "10.0.0.2", { kind: "visit", name: "Jorge Ruiz", email: "jorge@test.local", propertyCode: "9005", visitWhen: "sábado a la mañana" });
    expect(v.status).toBe("sent");
    const visit = await db.selectFrom("leads").select(["priority", "message"]).where("property_id", "=", ids.land).executeTakeFirstOrThrow();
    expect(visit.priority).toBe("high");
  });

  it("validación: sin teléfono ni email, o tasación sin zona → errores por campo, nada guardado", async () => {
    const db = testDb();
    const before = await db.selectFrom("leads").select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
    const r = await submitPublicLead(db, await anon(), "10.0.0.3", { kind: "appraisal", name: "X" });
    expect(r.status).toBe("invalid");
    if (r.status === "invalid") expect(Object.keys(r.fieldErrors)).toEqual(expect.arrayContaining(["name", "phone", "appraisalZone"]));
    const after = await db.selectFrom("leads").select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });

  it("honeypot: responde como enviado y no guarda nada", async () => {
    const db = testDb();
    const r = await submitPublicLead(db, await anon(), "10.0.0.4", { kind: "contact", name: "Bot", email: "bot@spam.test", website: "http://spam" });
    expect(r.status).toBe("sent");
    expect(await db.selectFrom("contacts").select("id").where("display_name", "=", "Bot").executeTakeFirst()).toBeUndefined();
  });

  it("rate limit por IP", async () => {
    const db = testDb();
    const results = [];
    for (let i = 0; i < 8; i++) results.push((await submitPublicLead(db, await anon(), "10.9.9.9", { kind: "contact", name: `Persona ${i}`, email: `p${i}@test.local` })).status);
    expect(results.filter((s) => s === "sent")).toHaveLength(6);
    expect(results.at(-1)).toBe("rate_limited");
  });

  it("flag public_lead_capture apagado → disabled, nunca 'enviado'", async () => {
    const db = testDb();
    await db.updateTable("feature_flags").set({ enabled: false }).where("key", "=", "public_lead_capture").execute();
    resetFlagCache();
    try {
      const r = await submitPublicLead(db, await anon(), "10.0.0.5", { kind: "contact", name: "Marta", email: "marta@test.local" });
      expect(r.status).toBe("disabled");
      expect(await db.selectFrom("contacts").select("id").where("display_name", "=", "Marta").executeTakeFirst()).toBeUndefined();
    } finally {
      await db.updateTable("feature_flags").set({ enabled: true }).where("key", "=", "public_lead_capture").execute();
      resetFlagCache();
    }
  });
});
