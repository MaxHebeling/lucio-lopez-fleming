import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "@/server/db";
import { runAdincoImport } from "@/server/migration/adinco/importer";
import { updateProperty, changePrice, unpublishProperty, publishProperty, assignAgents, changeStatus } from "@/server/properties/service";
import { reviewMigrationWarning } from "@/server/migration/review";
import { createStaff, resetBusinessData, testDb } from "../helpers/db";

const base = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/adinco-property-3021.json"), "utf8"));

/** Origen simulado SOLO en tests: mismo formato que el sitio real. */
function fakeSource(props: Array<Record<string, unknown>>) {
  const state = { props };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "HEAD") return new Response(null, { status: url.includes("roto") ? 404 : 200, headers: { "content-type": url.includes("roto") ? "text/html" : "image/jpeg" } });
    if (url.endsWith("/api/realEstates/3414")) {
      return Response.json({
        offices: [
          { id: 3600, name: "LLF", address: { street: "Av. Entre Rios", number: "639", neighborhood: "Salta", zp_3: "Salta" }, latitude: -24.78, longitude: -65.41,
            sellers: [{ id: 9587, name: "Secretaria", lastname: "Inmobiliaria", contact: { email: "secretaria@test.local", phoneNumbers: [{ type: "Whatsapp", countryCode: "+54", areaCode: null, number: "3875775468" }] } }] },
          { id: 7819, name: "LLF", address: { street: "Circunvalacion Oeste", number: "0", neighborhood: "Villa San Lorenzo", zp_3: "San Lorenzo Chico" }, latitude: -24.73, longitude: -65.48,
            sellers: [{ id: 8334, name: "Ignacio", lastname: "Lopez Fleming", contact: { email: "ignacio@test.local", phoneNumbers: [{ type: "Oficina", countryCode: "+54", areaCode: 387, number: "4440744" }] } }] },
        ],
      });
    }
    if (url.endsWith("/api/properties")) {
      return Response.json({ data: state.props.map((p) => ({ id: p.id, code: p.code, statusId: p.statusId })), meta: { last_page: 1 } });
    }
    const m = /luciolopez-(\d+)$/.exec(url);
    if (m) {
      const p = state.props.find((x) => x.code === Number(m[1]));
      if (!p) return new Response("no", { status: 404 });
      return new Response(`<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { property: p } } })}</script></html>`);
    }
    return new Response("?", { status: 404 });
  }) as typeof fetch;
  return { state, fetchImpl };
}

describe("importador Adinco", () => {
  beforeEach(async () => {
    await resetBusinessData(testDb());
  });

  it("importa, es idempotente y no duplica nada en la segunda corrida", async () => {
    const db = testDb();
    const src = fakeSource([
      base,
      { ...base, id: 2, code: 3020, price: 150, title: "Predio en venta", type: "Negocio Especial" },
      { ...base, id: 3, code: 3015, operation: "Alquiler", currencyId: "pesos", price: 700000, officeId: 7819, noteSellerId: 8334, multimedia: [{ src: "x/roto.jpg", multimediaTypeId: 1 }] },
    ]);
    const first = await runAdincoImport(db, { fetchImpl: src.fetchImpl, verifyMedia: true, delayMs: 0 });
    expect(first).toMatchObject({ discovered: 3, extracted: 3, created: 3, failed: 0, published: 2, reviewRequired: 1, agentsCreated: 2 });

    const counts = async () => {
      const r = await sql<Record<string, number>>`select
        (select count(*)::int from properties) as properties, (select count(*)::int from property_media) as media,
        (select count(*)::int from property_operations) as operations, (select count(*)::int from locations) as locations,
        (select count(*)::int from users) as users, (select count(*)::int from migration_warnings) as warnings,
        (select count(*)::int from property_price_history) as prices, (select count(*)::int from features) as features`.execute(db);
      return r.rows[0];
    };
    const before = await counts();
    const second = await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
    expect(second).toMatchObject({ created: 0, unchanged: 3, failed: 0 });
    const forced = await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0, force: true });
    expect(forced.created).toBe(0);
    expect(await counts()).toEqual(before);

    const predio = await db.selectFrom("properties").select(["is_published", "status"]).where("code", "=", 3020).executeTakeFirstOrThrow();
    expect(predio.is_published).toBe(false);
    // 3015: su única foto no responde → no se publica
    const alquiler = await db.selectFrom("properties").select(["is_published", "branch_id"]).where("code", "=", 3015).executeTakeFirstOrThrow();
    expect(alquiler.is_published).toBe(false);
    const branch = await db.selectFrom("branches").select("slug").where("id", "=", alquiler.branch_id!).executeTakeFirstOrThrow();
    expect(branch.slug).toBe("san-lorenzo-chico");
    const redirect = await db.selectFrom("property_redirects").select("path").where("path", "=", "/luciolopez-3021").executeTakeFirst();
    expect(redirect).toBeDefined();
    // Importar no dispara automatizaciones masivas (borradores de redes, etc.)
    const published = await db.selectFrom("domain_events").select("id").where("event_type", "=", "property.published").execute();
    expect(published).toHaveLength(0);
    // Los agentes importados no pueden entrar hasta ser invitados
    const agent = await db.selectFrom("users").select(["password_hash", "public_profile"]).where("email", "=", "secretaria@test.local").executeTakeFirstOrThrow();
    expect(agent).toEqual({ password_hash: null, public_profile: false });
  });

  it("una corrección humana no se pisa y los cambios del origen se aplican al resto", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const src = fakeSource([base]);
    await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
    const p = await db.selectFrom("properties").select("id").where("code", "=", 3021).executeTakeFirstOrThrow();

    await updateProperty(db, admin, p.id, { title: "Casa de 5 dormitorios con pileta en San Lorenzo" });
    await changePrice(db, admin, p.id, { operation: "sale", currency: "USD", amount: 240000, priceHidden: false }, "Acordado con el propietario");

    src.state.props = [{ ...base, title: "casa en venta!!", price: 260000, bedrooms: 6 }];
    const r = await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
    expect(r.updated).toBe(1);
    const after = await db.selectFrom("properties").select(["title", "bedrooms"]).where("id", "=", p.id).executeTakeFirstOrThrow();
    expect(after).toEqual({ title: "Casa de 5 dormitorios con pileta en San Lorenzo", bedrooms: 6 });
    const op = await db.selectFrom("property_operations").select("amount").where("property_id", "=", p.id).executeTakeFirstOrThrow();
    expect(op.amount).toBe("240000.00");
    const conflicts = await db.selectFrom("migration_warnings").select(["field", "value_b"]).where("code", "=", "protected_field_conflict").execute();
    expect(conflicts.map((c) => c.field)).toEqual(expect.arrayContaining(["title", "price:sale"]));
  });

  it("propiedad verificada manualmente no se modifica; ausencia en origen solo avisa", async () => {
    const db = testDb();
    const src = fakeSource([base, { ...base, id: 99, code: 2999 }]);
    await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
    await sql`update properties set manually_verified_at = now() where code = 3021`.execute(db);
    src.state.props = [{ ...base, bedrooms: 9 }];
    const r = await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
    expect(r.skippedProtected).toBe(1);
    expect(r.missingFromSource).toBe(1);
    const p = await db.selectFrom("properties").select(["bedrooms", "is_published"]).where("code", "=", 3021).executeTakeFirstOrThrow();
    expect(p.bedrooms).toBe(5);
    const gone = await db.selectFrom("properties").select("is_published").where("code", "=", 2999).executeTakeFirstOrThrow();
    expect(gone.is_published).toBe(true);
    const warn = await db.selectFrom("migration_warnings").select("severity").where("code", "=", "missing_from_source").executeTakeFirstOrThrow();
    expect(warn.severity).toBe("warning");
  });

  it("un error de extracción en una ficha no aborta la corrida", async () => {
    const db = testDb();
    const src = fakeSource([base, { ...base, id: 5, code: 3001 }]);
    const original = src.fetchImpl;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => (String(input).endsWith("luciolopez-3001") ? new Response("boom", { status: 404 }) : original(input, init))) as typeof fetch;
    const r = await runAdincoImport(db, { fetchImpl: flaky, delayMs: 0 });
    expect(r).toMatchObject({ discovered: 2, extracted: 1, failed: 1, created: 1 });
    const rec = await db.selectFrom("migration_records").select(["stage", "error"]).where("external_id", "=", "5").executeTakeFirstOrThrow();
    expect(rec.stage).toBe("failed");
  });

  it("bloqueo del CDN (403) no marca fotos como rotas ni despublica; origen bloqueado corta la corrida", async () => {
    const db = testDb();
    const src = fakeSource([base]);
    const blockedCdn = (async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "HEAD" ? new Response("Request blocked", { status: 403, headers: { "content-type": "text/html" } }) : src.fetchImpl(input, init)) as typeof fetch;
    const r = await runAdincoImport(db, { fetchImpl: blockedCdn, verifyMedia: true, delayMs: 0 });
    expect(r).toMatchObject({ created: 1, published: 1, mediaFailed: 0 });
    expect(r.mediaInconclusive).toBeGreaterThan(0);
    const p = await db.selectFrom("properties").select("is_published").where("code", "=", 3021).executeTakeFirstOrThrow();
    expect(p.is_published).toBe(true);
    expect(await db.selectFrom("property_media").select("id").where("status", "=", "failed").execute()).toHaveLength(0);

    const many = fakeSource(Array.from({ length: 12 }, (_, i) => ({ ...base, id: 1000 + i, code: 4000 + i })));
    const blockedSite = (async (input: RequestInfo | URL, init?: RequestInit) =>
      /luciolopez-\d+$/.test(String(input)) ? new Response("blocked", { status: 403 }) : many.fetchImpl(input, init)) as typeof fetch;
    const r2 = await runAdincoImport(db, { fetchImpl: blockedSite, delayMs: 0, concurrency: 1 });
    expect(r2.aborted).toMatch(/bloqueando/);
    expect(r2.failed).toBe(5);
    const run = await db.selectFrom("migration_runs").select("status").where("id", "=", r2.runId).executeTakeFirstOrThrow();
    expect(run.status).toBe("failed");
  });

  it("despublicar, pausar, reasignar agente o editar fotos a mano no lo revierte una reimportación", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const src = fakeSource([base, { ...base, id: 77, code: 3077 }]);
    await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
    const a = await db.selectFrom("properties").select("id").where("code", "=", 3021).executeTakeFirstOrThrow();
    const b = await db.selectFrom("properties").select("id").where("code", "=", 3077).executeTakeFirstOrThrow();

    await unpublishProperty(db, admin, a.id, "El propietario pidió bajarla");
    await assignAgents(db, admin, a.id, admin.userId);
    await changeStatus(db, admin, b.id, "reserved", "Seña recibida");

    await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0, force: true });
    const pa = await db.selectFrom("properties").select(["is_published", "protected_fields"]).where("id", "=", a.id).executeTakeFirstOrThrow();
    expect(pa.is_published).toBe(false);
    expect(pa.protected_fields).toEqual(expect.arrayContaining(["is_published", "agents"]));
    const agents = await db.selectFrom("property_agents").select("user_id").where("property_id", "=", a.id).execute();
    expect(agents.map((x) => x.user_id)).toEqual([admin.userId]);
    const pb = await db.selectFrom("properties").select("status").where("id", "=", b.id).executeTakeFirstOrThrow();
    expect(pb.status).toBe("reserved");
  });

  describe("despublicación por advertencias bloqueantes", () => {
    it("una advertencia bloqueante nueva despublica con el servicio: evento property.unpublished y portales a dar de baja", async () => {
      const db = testDb();
      const src = fakeSource([base]);
      await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
      const p = await db.selectFrom("properties").select(["id", "is_published"]).where("code", "=", 3021).executeTakeFirstOrThrow();
      expect(p.is_published).toBe(true);
      // Canal de portal con aviso publicado
      await db.insertInto("property_publications").values({ property_id: p.id, channel_key: "mercadolibre", desired_state: "published", sync_status: "synced", external_id: "MLA1" }).execute();

      src.state.props = [{ ...base, price: 150 }];
      await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
      expect((await db.selectFrom("properties").select("is_published").where("id", "=", p.id).executeTakeFirstOrThrow()).is_published).toBe(false);
      const events = await db.selectFrom("domain_events").select("event_type").where("aggregate_id", "=", p.id).where("event_type", "=", "property.unpublished").execute();
      expect(events).toHaveLength(1);
      const ml = await db.selectFrom("property_publications").select(["desired_state", "sync_status"]).where("property_id", "=", p.id).where("channel_key", "=", "mercadolibre").executeTakeFirstOrThrow();
      expect(ml.desired_state).toBe("unpublished");
      const audit = await db.selectFrom("audit_logs").select("action").where("entity_id", "=", p.id).where("action", "=", "PROPERTY_UNPUBLISHED").execute();
      expect(audit).toHaveLength(1);
    });

    it("publicación decidida por una persona (is_published protegido) o ficha verificada: no se despublica", async () => {
      const db = testDb();
      const admin = await createStaff(db, ["administrador"]);
      const src = fakeSource([base, { ...base, id: 88, code: 3088 }]);
      await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
      const a = await db.selectFrom("properties").select("id").where("code", "=", 3021).executeTakeFirstOrThrow();
      const b = await db.selectFrom("properties").select("id").where("code", "=", 3088).executeTakeFirstOrThrow();
      await unpublishProperty(db, admin, a.id, "revisión");
      await publishProperty(db, admin, a.id);
      await sql`update properties set manually_verified_at = now() where id = ${b.id}`.execute(db);

      src.state.props = [{ ...base, price: 150 }, { ...base, id: 88, code: 3088, price: 150 }];
      await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
      const rows = await db.selectFrom("properties").select(["code", "is_published"]).where("id", "in", [a.id, b.id]).orderBy("code").execute();
      expect(rows).toEqual([
        { code: 3021, is_published: true },
        { code: 3088, is_published: true },
      ]);
    });

    it("advertencia descartada por una persona con el mismo valor no vuelve a bloquear (se republica si nadie la despublicó a mano)", async () => {
      const db = testDb();
      const admin = await createStaff(db, ["administrador"]);
      const src = fakeSource([{ ...base, price: 150 }]);
      await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
      const p = await db.selectFrom("properties").select(["id", "is_published"]).where("code", "=", 3021).executeTakeFirstOrThrow();
      expect(p.is_published).toBe(false);
      const w = await db.selectFrom("migration_warnings").select("id").where("code", "=", "implausible_price").executeTakeFirstOrThrow();
      await reviewMigrationWarning(db, admin, w.id, "dismissed");

      await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0, force: true });
      expect((await db.selectFrom("properties").select("is_published").where("id", "=", p.id).executeTakeFirstOrThrow()).is_published).toBe(true);
      expect((await db.selectFrom("migration_warnings").select("status").where("id", "=", w.id).executeTakeFirstOrThrow()).status).toBe("dismissed");

      // Con otro valor sí vuelve a bloquear
      src.state.props = [{ ...base, price: 120 }];
      await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
      expect((await db.selectFrom("properties").select("is_published").where("id", "=", p.id).executeTakeFirstOrThrow()).is_published).toBe(false);
    });

    it("verificación de fotos: todas rotas no despublica una ficha con publicación protegida, verificada o advertencia descartada", async () => {
      const db = testDb();
      const admin = await createStaff(db, ["administrador"]);
      const broken = [{ src: "x/roto-1.jpg", multimediaTypeId: 1 }];
      const src = fakeSource([base, { ...base, id: 61, code: 3061 }, { ...base, id: 62, code: 3062 }]);
      await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0 });
      const ids = Object.fromEntries((await db.selectFrom("properties").select(["id", "code"]).execute()).map((r) => [r.code, r.id]));
      await unpublishProperty(db, admin, ids[3021]!, "revisión");
      await publishProperty(db, admin, ids[3021]!);
      await sql`update properties set manually_verified_at = now() where id = ${ids[3061]!}`.execute(db);

      src.state.props = [
        { ...base, bedrooms: 4, multimedia: broken },
        { ...base, id: 61, code: 3061, bedrooms: 4, multimedia: broken },
        { ...base, id: 62, code: 3062, bedrooms: 4, multimedia: broken },
      ];
      await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0, verifyMedia: true, force: true });
      const rows = await db.selectFrom("properties").select(["code", "is_published"]).orderBy("code").execute();
      // 3061 verificada a mano: no se toca; 3021 publicación protegida: no se despublica; 3062 sin decisión humana: se despublica
      expect(rows).toEqual([
        { code: 3021, is_published: true },
        { code: 3061, is_published: true },
        { code: 3062, is_published: false },
      ]);
      expect(await db.selectFrom("domain_events").select("id").where("aggregate_id", "=", ids[3062]!).where("event_type", "=", "property.unpublished").execute()).toHaveLength(1);

      // Una persona descarta la advertencia y publica de nuevo: la próxima verificación no la vuelve a bajar
      const w = await db.selectFrom("migration_warnings").select("id").where("code", "=", "media_unreachable").where("property_id", "=", ids[3062]!).executeTakeFirstOrThrow();
      await reviewMigrationWarning(db, admin, w.id, "dismissed");
      await sql`update properties set is_published = true where id = ${ids[3062]!}`.execute(db);
      await sql`update property_media set status = 'source_only' where property_id = ${ids[3062]!}`.execute(db);
      src.state.props = src.state.props.map((x) => ({ ...x, bedrooms: 3 }));
      await runAdincoImport(db, { fetchImpl: src.fetchImpl, delayMs: 0, verifyMedia: true, force: true });
      expect((await db.selectFrom("properties").select("is_published").where("id", "=", ids[3062]!).executeTakeFirstOrThrow()).is_published).toBe(true);
    });
  });
});
