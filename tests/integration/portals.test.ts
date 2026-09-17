import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import "@/server/jobs/handlers";
import { dispatchPendingEvents } from "@/server/automation/engine";
import { runJobs } from "@/server/jobs/runner";
import { PermanentJobError } from "@/server/jobs/registry";
import { syncPublication, resumePortalSync } from "@/server/integrations/portals/sync";
import { retryPublication, setPortalChannelEnabled } from "@/server/integrations/portals/service";
import { clearMercadoLibreCacheForTests, mercadoLibreAccessToken } from "@/server/integrations/portals/mercadolibre/adapter";
import { encryptionKey, readCredentials } from "@/server/integrations/secrets";
import { updateProperty, unpublishProperty } from "@/server/properties/service";
import type { StaffActor } from "@/server/auth/actor";
import { createStaff, testDb } from "../helpers/db";
import { json, loadIntegrationReferenceData, mockHttp, publishedProperty, setFlag, useMemoryStorage, type RecordedCall } from "../helpers/integrations";
import { setStorageForTests } from "@/server/storage";

const ML_ENV = {
  MERCADOLIBRE_CLIENT_ID: "123456",
  MERCADOLIBRE_CLIENT_SECRET: "secreto-app",
  MERCADOLIBRE_REFRESH_TOKEN: "TG-inicial",
  MERCADOLIBRE_CONTACT_WHATSAPP: "+5493875551234",
  INTEGRATIONS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  APP_URL: "https://www.luciolopezfleming.com.ar",
};
const saved: Record<string, string | undefined> = {};

type MlState = { itemsPut503: boolean; requiredExtra: boolean; tokenSeq: number };

function mercadoLibreRoutes(state: MlState) {
  return [
    (c: RecordedCall) => {
      if (!c.url.startsWith("https://api.mercadolibre.com/")) return undefined;
      const path = c.url.replace("https://api.mercadolibre.com", "");
      if (path === "/oauth/token" && c.method === "POST") {
        state.tokenSeq++;
        return json({ access_token: `APP_USR-${state.tokenSeq}`, token_type: "bearer", expires_in: 21600, refresh_token: `TG-rotado-${state.tokenSeq}`, user_id: 99 });
      }
      if (!c.headers.authorization?.startsWith("Bearer APP_USR-")) return json({ message: "invalid_token" }, 401);
      if (path === "/categories/MLA1466") return json({ id: "MLA1466", name: "Casas", children_categories: [{ id: "MLA1467", name: "Alquiler" }, { id: "MLA1468", name: "Venta" }] });
      if (path === "/categories/MLA1468") return json({ id: "MLA1468", name: "Venta", children_categories: [{ id: "MLA401805", name: "Emprendimientos" }, { id: "MLA401685", name: "Propiedades Individuales" }] });
      if (path === "/categories/MLA401685/attributes")
        return json([
          { id: "BEDROOMS", name: "Dormitorios", tags: { required: true } },
          { id: "OPERATION", name: "Operación", tags: { required: true }, values: [{ id: "242075", name: "Venta" }] },
          ...(state.requiredExtra ? [{ id: "FURNISHED", name: "Amoblado", tags: { required: true }, values: [{ id: "1", name: "Sí" }] }] : []),
        ]);
      if (path === "/items" && c.method === "POST") return json({ id: "MLA3879350706", permalink: "https://casa.mercadolibre.com.ar/MLA-3879350706-casa-_JM", status: "active" }, 201);
      if (path === "/items/MLA3879350706" && c.method === "GET") return json({ id: "MLA3879350706", status: "active", permalink: "https://casa.mercadolibre.com.ar/MLA-3879350706-casa-_JM" });
      if (path === "/items/MLA3879350706" && c.method === "PUT") {
        if (state.itemsPut503) return json({ message: "service unavailable" }, 503);
        return json({ id: "MLA3879350706", permalink: "https://casa.mercadolibre.com.ar/MLA-3879350706-casa-_JM" });
      }
      if (path === "/items/MLA3879350706/description" && c.method === "PUT") return json({ plain_text: "ok" });
      return undefined;
    },
  ];
}

async function enableMercadoLibre() {
  const db = testDb();
  await db.updateTable("publication_channels").set({ is_enabled: true }).where("key", "=", "mercadolibre").execute();
}

async function linkLocation(locationId: string) {
  await testDb().insertInto("external_refs").values({ source: "mercadolibre", external_type: "neighborhood", external_id: `TUxBQlRSRT${locationId.slice(0, 6)}`, entity_type: "location", entity_id: locationId }).execute();
}

async function pub(propertyId: string, channel = "mercadolibre") {
  return testDb().selectFrom("property_publications").selectAll().where("property_id", "=", propertyId).where("channel_key", "=", channel).executeTakeFirstOrThrow();
}

async function drain() {
  const db = testDb();
  for (let i = 0; i < 3; i++) {
    await dispatchPendingEvents(db);
    await runJobs(db, { budgetMs: 300_000 });
  }
}

describe("sincronización con portales", () => {
  let admin: StaffActor;

  beforeAll(async () => {
    const db = testDb();
    await loadIntegrationReferenceData(db);
    admin = await createStaff(db, ["administrador"]);
    useMemoryStorage();
  });
  afterAll(() => setStorageForTests(undefined));

  beforeEach(async () => {
    for (const [k, v] of Object.entries(ML_ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    clearMercadoLibreCacheForTests();
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    await sql`update domain_events set dispatched_at = now() where dispatched_at is null`.execute(db);
    await sql`delete from integration_credentials`.execute(db);
    await sql`update integrations set circuit_open_until = null, consecutive_failures = 0`.execute(db);
    await setFlag(db, "portal_sync", true);
  });
  afterEach(() => {
    for (const k of Object.keys(ML_ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("flag portal_sync apagado: no se encola ni se llama a nadie", async () => {
    const db = testDb();
    await setFlag(db, "portal_sync", false);
    await enableMercadoLibre();
    const http = mockHttp([]);
    try {
      const p = await publishedProperty(db, admin);
      await drain();
      expect(http.calls).toHaveLength(0);
      expect(await db.selectFrom("jobs").select("id").where("type", "=", "portals.sync").execute()).toHaveLength(0);
      expect((await syncPublication(db, p.id, "mercadolibre")).status).toBe("skipped");
    } finally {
      http.restore();
    }
  });

  it("sin credenciales → awaiting_credentials visible; Argenprop/Zonaprop sin API pública → awaiting_credentials sin HTTP", async () => {
    const db = testDb();
    delete process.env.MERCADOLIBRE_CLIENT_SECRET;
    await enableMercadoLibre();
    await db.updateTable("publication_channels").set({ is_enabled: true }).where("key", "in", ["argenprop", "zonaprop"]).execute();
    const http = mockHttp([]);
    try {
      const p = await publishedProperty(db, admin);
      await drain();
      expect(http.calls).toHaveLength(0);
      expect(await pub(p.id)).toMatchObject({ sync_status: "awaiting_credentials", external_id: null });
      expect((await pub(p.id)).last_error).toMatch(/MERCADOLIBRE_CLIENT_SECRET/);
      const ap = await pub(p.id, "argenprop");
      expect(ap.sync_status).toBe("awaiting_credentials");
      expect(ap.last_error).toMatch(/no tiene API pública/);
      expect((await pub(p.id, "zonaprop")).sync_status).toBe("awaiting_credentials");
    } finally {
      http.restore();
      await db.updateTable("publication_channels").set({ is_enabled: false }).where("key", "in", ["argenprop", "zonaprop"]).execute();
    }
  });

  it("publica UNA vez, no reenvía sin cambios, actualiza (no duplica) y nunca revierte el CRM ante fallas", async () => {
    const db = testDb();
    await enableMercadoLibre();
    const state: MlState = { itemsPut503: false, requiredExtra: false, tokenSeq: 0 };
    const http = mockHttp(mercadoLibreRoutes(state));
    try {
      const p = await publishedProperty(db, admin);
      await linkLocation(p.locationId);
      await drain();
      const first = await pub(p.id);
      expect(first).toMatchObject({ sync_status: "synced", external_id: "MLA3879350706", external_url: "https://casa.mercadolibre.com.ar/MLA-3879350706-casa-_JM" });
      expect(http.calls.filter((c) => c.method === "POST" && c.url.endsWith("/items"))).toHaveLength(1);
      const created = JSON.parse(http.calls.find((c) => c.url.endsWith("/items"))!.body);
      expect(created.category_id).toBe("MLA401685");
      expect(created.attributes).toContainEqual({ id: "OPERATION", value_name: "Venta" });
      expect(created.pictures).toHaveLength(2);

      // Token rotativo guardado cifrado (nunca en claro)
      const cred = await db.selectFrom("integration_credentials").selectAll().where("integration_key", "=", "mercadolibre").executeTakeFirstOrThrow();
      expect(cred.ciphertext).not.toContain("APP_USR");
      expect(cred.ciphertext).not.toContain("TG-rotado");

      // Sin cambios: ni una llamada
      const before = http.calls.length;
      expect((await syncPublication(db, p.id, "mercadolibre")).status).toBe("unchanged");
      expect(http.calls.length).toBe(before);

      // Cambio real en el CRM → PUT sobre el mismo aviso
      await updateProperty(db, admin, p.id, { bedrooms: 4 });
      await drain();
      const puts = http.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/items/MLA3879350706"));
      expect(puts).toHaveLength(1);
      expect(JSON.parse(puts[0]!.body).attributes).toContainEqual({ id: "BEDROOMS", value_name: "4" });
      expect(http.calls.filter((c) => c.method === "POST" && c.url.endsWith("/items"))).toHaveLength(1);
      expect((await pub(p.id)).external_id).toBe("MLA3879350706");
      // El access token vigente se reutiliza: un solo intercambio OAuth en todo el flujo
      expect(http.calls.filter((c) => c.url.endsWith("/oauth/token"))).toHaveLength(1);

      // Falla transitoria del portal → retrying; el dato del CRM queda como lo dejó la persona
      state.itemsPut503 = true;
      await updateProperty(db, admin, p.id, { bedrooms: 5 });
      await dispatchPendingEvents(db);
      await runJobs(db, { budgetMs: 300_000 });
      await dispatchPendingEvents(db);
      await runJobs(db, { budgetMs: 300_000 });
      const failed = await pub(p.id);
      expect(failed.sync_status).toBe("retrying");
      expect(failed.last_error).toMatch(/503/);
      expect(failed.external_id).toBe("MLA3879350706");
      const prop = await db.selectFrom("properties").select("bedrooms").where("id", "=", p.id).executeTakeFirstOrThrow();
      expect(prop.bedrooms).toBe(5);

      // El portal vuelve: el reintento de la cola sincroniza sin crear otro aviso
      state.itemsPut503 = false;
      await sql`update jobs set run_at = now() where type = 'portals.sync' and status = 'failed'`.execute(db);
      await runJobs(db, { budgetMs: 300_000 });
      expect((await pub(p.id)).sync_status).toBe("synced");
      expect(http.calls.filter((c) => c.method === "POST" && c.url.endsWith("/items"))).toHaveLength(1);

      // Despublicar → pausa el aviso (reversible), conserva external_id
      await unpublishProperty(db, admin, p.id, "Reservada");
      await drain();
      const pause = http.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/items/MLA3879350706") && c.body.includes('"paused"'));
      expect(pause).toHaveLength(1);
      expect(await pub(p.id)).toMatchObject({ sync_status: "synced", desired_state: "unpublished", external_id: "MLA3879350706" });
    } finally {
      http.restore();
    }
  });

  it("dato que Mercado Libre exige y la propiedad no tiene → failed permanente con el nombre del dato", async () => {
    const db = testDb();
    await enableMercadoLibre();
    const state: MlState = { itemsPut503: false, requiredExtra: true, tokenSeq: 0 };
    const http = mockHttp(mercadoLibreRoutes(state));
    try {
      const p = await publishedProperty(db, admin);
      await linkLocation(p.locationId);
      await sql`update property_publications set sync_status = 'pending' where property_id = ${p.id}`.execute(db);
      await expect(syncPublication(db, p.id, "mercadolibre")).rejects.toBeInstanceOf(PermanentJobError);
      const row = await pub(p.id);
      expect(row.sync_status).toBe("failed");
      expect(row.last_error).toMatch(/Amoblado/);
      expect(http.calls.filter((c) => c.method === "POST" && c.url.endsWith("/items"))).toHaveLength(0);
    } finally {
      http.restore();
    }
  });

  it("precio oculto → failed con motivo claro, sin llamar al portal", async () => {
    const db = testDb();
    await enableMercadoLibre();
    const http = mockHttp(mercadoLibreRoutes({ itemsPut503: false, requiredExtra: false, tokenSeq: 0 }));
    try {
      const p = await publishedProperty(db, admin, { priceHidden: true });
      await linkLocation(p.locationId);
      await expect(syncPublication(db, p.id, "mercadolibre")).rejects.toBeInstanceOf(PermanentJobError);
      expect((await pub(p.id)).last_error).toMatch(/exige precio/);
      expect(http.calls.filter((c) => c.url.includes("/items"))).toHaveLength(0);
    } finally {
      http.restore();
    }
  });

  it("reintento manual y habilitar/deshabilitar canal: permisos + auditoría", async () => {
    const db = testDb();
    const agent = await createStaff(db, ["agente"]);
    const marketing = await createStaff(db, ["marketing"]);
    await db.updateTable("publication_channels").set({ is_enabled: false }).where("key", "=", "mercadolibre").execute();
    const http = mockHttp([]);
    try {
      const p = await publishedProperty(db, admin);
      const row = await pub(p.id);
      expect(row.sync_status).toBe("disabled");

      await expect(setPortalChannelEnabled(db, agent, { channelKey: "mercadolibre", enabled: true })).rejects.toThrow(/permiso/);
      await expect(retryPublication(db, marketing, { publicationId: row.id })).rejects.toThrow(/deshabilitado/);

      const r = await setPortalChannelEnabled(db, marketing, { channelKey: "mercadolibre", enabled: true });
      expect(r.changed).toBe(true);
      expect((await pub(p.id)).sync_status).toBe("pending");
      await expect(setPortalChannelEnabled(db, marketing, { channelKey: "web", enabled: false })).rejects.toThrow(/portales/);

      await sql`delete from jobs where type = 'portals.sync'`.execute(db);
      const retry = await retryPublication(db, marketing, { publicationId: row.id });
      expect(retry.queued).toBe(true);
      // doble clic: no duplica el job
      await retryPublication(db, marketing, { publicationId: row.id });
      expect(await db.selectFrom("jobs").select("id").where("type", "=", "portals.sync").where("status", "=", "queued").execute()).toHaveLength(1);

      await setPortalChannelEnabled(db, marketing, { channelKey: "mercadolibre", enabled: false });
      const audits = await db.selectFrom("audit_logs").select(["action", "actor_user_id"]).where("action", "like", "PUBLICATION_%").where("actor_user_id", "=", marketing.userId).orderBy("id").execute();
      expect(audits.map((a) => a.action)).toEqual(["PUBLICATION_CHANNEL_ENABLED", "PUBLICATION_SYNC_RETRY", "PUBLICATION_SYNC_RETRY", "PUBLICATION_CHANNEL_DISABLED"]);
      expect((await pub(p.id)).sync_status).toBe("disabled");
      expect(http.calls).toHaveLength(0);
      expect((await resumePortalSync(db)).queued).toBe(0);
    } finally {
      http.restore();
    }
  });

  describe("resultados inciertos, carreras y credenciales", () => {
    type Extra = { createStatus?: number; searchResults?: string[]; getItem404?: boolean; unauthorized?: boolean; onCreate?: () => Promise<void>; createdId?: string };
    function extraRoutes(x: Extra) {
      return [
        async (c: RecordedCall) => {
          if (!c.url.startsWith("https://api.mercadolibre.com/")) return undefined;
          const path = c.url.replace("https://api.mercadolibre.com", "");
          if (x.unauthorized && path.startsWith("/items")) return json({ message: "invalid access token", status: 401 }, 401);
          if (path.startsWith("/users/99/items/search")) return json({ seller_id: "99", paging: { total: (x.searchResults ?? []).length }, results: x.searchResults ?? [] });
          if (path === "/items" && c.method === "POST") {
            if (x.onCreate) await x.onCreate();
            if (x.createStatus) return json({ message: "internal error" }, x.createStatus);
            if (x.createdId) return json({ id: x.createdId, permalink: `https://casa.mercadolibre.com.ar/${x.createdId}`, status: "active" }, 201);
          }
          if (x.getItem404 && path === "/items/MLA3879350706" && c.method === "GET") return json({ message: "Item with id MLA3879350706 not found", status: 404 }, 404);
          if (x.createdId && path === `/items/${x.createdId}` && c.method !== "POST") return json({ id: x.createdId, status: "active", permalink: `https://casa.mercadolibre.com.ar/${x.createdId}` });
          if (x.createdId && path === `/items/${x.createdId}/description`) return json({ plain_text: "ok" });
          return undefined;
        },
        ...mercadoLibreRoutes({ itemsPut503: false, requiredExtra: false, tokenSeq: 0 }),
      ];
    }
    /** POST /items de una propiedad (otras propiedades de tests anteriores pueden sincronizarse en la misma corrida). */
    const posts = (calls: RecordedCall[], code?: number) =>
      calls.filter((c) => c.method === "POST" && c.url === "https://api.mercadolibre.com/items" && (code === undefined || (JSON.parse(c.body) as { seller_custom_field?: string }).seller_custom_field === `LLF-${code}`));

    it("despublicar mientras se crea el aviso: la carrera no deja el aviso activo (se pausa lo recién creado)", async () => {
      const db = testDb();
      await enableMercadoLibre();
      const p = await publishedProperty(db, admin);
      await linkLocation(p.locationId);
      let concurrent: unknown = null;
      const http = mockHttp(
        extraRoutes({
          onCreate: async () => {
            // Mientras Mercado Libre procesa la creación, una persona despublica y otro worker intenta sincronizar.
            await unpublishProperty(db, admin, p.id, "Se vendió");
            concurrent = await syncPublication(db, p.id, "mercadolibre").catch((e: unknown) => e);
          },
        }),
      );
      try {
        await drain();
        expect((concurrent as Error).message).toMatch(/otro proceso/);
        const pauses = http.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/items/MLA3879350706") && c.body.includes('"paused"'));
        expect(pauses).toHaveLength(1);
        expect(await pub(p.id)).toMatchObject({ desired_state: "unpublished", sync_status: "synced", external_id: "MLA3879350706", sync_locked_until: null, remote_write_started_at: null });
        expect(posts(http.calls)).toHaveLength(1);
      } finally {
        http.restore();
      }
    });

    it("POST /items con 5xx: no se reintenta, queda failed 'incierto'; el reintento manual adopta el aviso existente sin crear otro", async () => {
      const db = testDb();
      await enableMercadoLibre();
      const x: Extra = { createStatus: 503 };
      const http = mockHttp(extraRoutes(x));
      try {
        const p = await publishedProperty(db, admin);
        await linkLocation(p.locationId);
        await drain();
        expect(posts(http.calls, p.code)).toHaveLength(1);
        const row = await pub(p.id);
        expect(row).toMatchObject({ sync_status: "failed", external_id: null });
        expect(row.last_error).toMatch(/Resultado incierto.*Verificá en Mercado Libre/);
        expect(row.remote_write_started_at).not.toBeNull();
        const job = await db.selectFrom("jobs").select(["status", "attempts"]).where("type", "=", "portals.sync").where("status", "in", ["dead", "failed", "queued"]).executeTakeFirstOrThrow();
        expect(job).toMatchObject({ status: "dead", attempts: 1 });
        // La corrida horaria no lo retoma sola
        await resumePortalSync(db);
        await drain();
        expect(posts(http.calls, p.code)).toHaveLength(1);

        // Una persona verificó y reintenta: el aviso SÍ se había creado → se encuentra por referencia y se adopta
        const created = JSON.parse(posts(http.calls, p.code)[0]!.body);
        expect(created.seller_custom_field).toBe(`LLF-${p.code}`);
        x.createStatus = undefined;
        x.searchResults = ["MLA3879350706"];
        await sql`delete from jobs where type = 'portals.sync'`.execute(db);
        const mark = http.calls.length;
        await retryPublication(db, admin, { publicationId: row.id });
        await syncPublication(db, p.id, "mercadolibre");
        const search = http.calls.find((c) => c.url.includes("/users/99/items/search"));
        expect(search?.url).toBe(`https://api.mercadolibre.com/users/99/items/search?sku=LLF-${p.code}`);
        expect(posts(http.calls, p.code)).toHaveLength(1);
        expect(await pub(p.id)).toMatchObject({ sync_status: "synced", external_id: "MLA3879350706", remote_write_started_at: null });
        expect(http.calls.slice(mark).filter((c) => c.method === "PUT" && c.url.endsWith("/items/MLA3879350706"))).toHaveLength(1);
      } finally {
        http.restore();
      }
    });

    it("aviso borrado en Mercado Libre (404): si debe estar publicado se recrea buscando antes por referencia; al despublicar, 404 no es error", async () => {
      const db = testDb();
      await enableMercadoLibre();
      const x: Extra = { getItem404: true, searchResults: [], createdId: "MLA5550001" };
      const http = mockHttp(extraRoutes(x));
      try {
        const p = await publishedProperty(db, admin);
        await linkLocation(p.locationId);
        await sql`update property_publications set sync_status = 'synced', external_id = 'MLA3879350706', last_payload_hash = 'viejo' where property_id = ${p.id} and channel_key = 'mercadolibre'`.execute(db);
        const r = await syncPublication(db, p.id, "mercadolibre");
        expect(r).toMatchObject({ status: "synced", externalId: "MLA5550001" });
        const order = http.calls.map((c) => `${c.method} ${c.url.replace("https://api.mercadolibre.com", "")}`).filter((c) => !c.includes("/categories") && !c.includes("oauth"));
        expect(order.indexOf(`GET /users/99/items/search?sku=LLF-${p.code}`)).toBeLessThan(order.indexOf("POST /items"));
        expect(posts(http.calls)).toHaveLength(1);

        await sql`update property_publications set external_id = 'MLA3879350706' where property_id = ${p.id} and channel_key = 'mercadolibre'`.execute(db);
        await unpublishProperty(db, admin, p.id);
        expect((await syncPublication(db, p.id, "mercadolibre")).status).toBe("synced");
        expect((await pub(p.id)).sync_status).toBe("synced");
      } finally {
        http.restore();
      }
    });

    it("401 de la API → awaiting_credentials con instrucción de reautorizar (no 'dato inválido')", async () => {
      const db = testDb();
      await enableMercadoLibre();
      const http = mockHttp(extraRoutes({ unauthorized: true }));
      try {
        const p = await publishedProperty(db, admin);
        await linkLocation(p.locationId);
        await sql`update property_publications set sync_status = 'synced', external_id = 'MLA3879350706', last_payload_hash = 'viejo' where property_id = ${p.id} and channel_key = 'mercadolibre'`.execute(db);
        const r = await syncPublication(db, p.id, "mercadolibre");
        expect(r.status).toBe("awaiting_credentials");
        const row = await pub(p.id);
        expect(row.sync_status).toBe("awaiting_credentials");
        expect(row.last_error).toMatch(/Volvé a autorizar/);
        const i = await db.selectFrom("integrations").select(["status", "last_error"]).where("key", "=", "mercadolibre").executeTakeFirstOrThrow();
        expect(i.status).toBe("awaiting_credentials");
        // El access token guardado deja de usarse: la próxima llamada lo renueva
        const cred = await db.selectFrom("integration_credentials").select("access_expires_at").where("integration_key", "=", "mercadolibre").executeTakeFirstOrThrow();
        expect(new Date(cred.access_expires_at!).getTime()).toBeLessThan(Date.now());
      } finally {
        http.restore();
        await db.updateTable("integrations").set({ status: "active", last_error: null }).where("key", "=", "mercadolibre").execute();
      }
    });

    it("refresh token rotativo: el nuevo queda guardado aunque falle lo que sigue a la respuesta; el POST de token no se reintenta", async () => {
      const db = testDb();
      const http = mockHttp(mercadoLibreRoutes({ itemsPut503: false, requiredExtra: false, tokenSeq: 0 }));
      // Falla el registro del éxito en integration_logs (p. ej. pool agotado / base lenta) justo después de la respuesta
      await sql.raw(`create or replace function test_fail_oauth_log() returns trigger language plpgsql as $$
        begin if new.operation = 'oauth.refresh' and new.status = 'ok' then raise exception 'falla simulada de registro'; end if; return new; end $$`).execute(db);
      await sql`create trigger test_fail_oauth_log before insert on integration_logs for each row execute function test_fail_oauth_log()`.execute(db);
      try {
        await expect(mercadoLibreAccessToken(db)).rejects.toThrow(/falla simulada/);
        expect(http.calls.filter((c) => c.url.endsWith("/oauth/token"))).toHaveLength(1);
        const stored = await readCredentials<{ refreshToken: string; accessToken: string }>(db, "mercadolibre", encryptionKey()!);
        expect(stored?.value).toMatchObject({ refreshToken: "TG-rotado-1", accessToken: "APP_USR-1" });
      } finally {
        await sql`drop trigger if exists test_fail_oauth_log on integration_logs`.execute(db);
        await sql`drop function if exists test_fail_oauth_log()`.execute(db);
        http.restore();
      }
      // Con el token ya guardado, la siguiente llamada lo reutiliza sin volver a consumir el refresh token
      const again = mockHttp(mercadoLibreRoutes({ itemsPut503: false, requiredExtra: false, tokenSeq: 5 }));
      try {
        expect(await mercadoLibreAccessToken(db)).toBe("APP_USR-1");
        expect(again.calls).toHaveLength(0);
      } finally {
        again.restore();
      }
    });

    it("publicación trabada en syncing (worker muerto > 15 min): la reanudación horaria y el reintento manual la retoman", async () => {
      const db = testDb();
      await enableMercadoLibre();
      const http = mockHttp([]);
      try {
        await setFlag(db, "portal_sync", false);
        const p = await publishedProperty(db, admin);
        await setFlag(db, "portal_sync", true);
        await sql`delete from jobs where type = 'portals.sync'`.execute(db);
        const row = await pub(p.id);
        // Recién tomada por un worker: no se reintenta encima
        await sql`update property_publications set sync_status = 'syncing', last_attempt_at = now(), sync_locked_until = now() + interval '15 minutes' where id = ${row.id}`.execute(db);
        await expect(retryPublication(db, admin, { publicationId: row.id })).rejects.toThrow(/sincronizando/);
        // Worker muerto hace 20 minutos
        await sql`update property_publications set sync_status = 'syncing', last_attempt_at = now() - interval '20 minutes', sync_locked_until = now() - interval '5 minutes' where id = ${row.id}`.execute(db);
        await sql`update integrations set status = 'active' where key = 'mercadolibre'`.execute(db);
        const resumed = await resumePortalSync(db);
        expect(resumed.queued).toBeGreaterThanOrEqual(1);
        await sql`delete from jobs where type = 'portals.sync'`.execute(db);
        expect((await retryPublication(db, admin, { publicationId: row.id })).queued).toBe(true);
      } finally {
        http.restore();
      }
    });
  });
});
