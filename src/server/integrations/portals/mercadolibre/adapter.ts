/**
 * Adaptador Mercado Libre Inmuebles (API pública documentada).
 * - OAuth: POST https://api.mercadolibre.com/oauth/token (grant_type=refresh_token, form-urlencoded).
 *   access_token dura 6 h; el refresh_token es DE UN SOLO USO y cada renovación devuelve uno nuevo → se guarda
 *   cifrado en integration_credentials. MERCADOLIBRE_REFRESH_TOKEN solo se usa como arranque (o si cambia).
 *   La renovación se serializa con un advisory lock de sesión sobre UNA conexión (nada de transacción + segunda
 *   conexión del pool): dos workers nunca consumen el mismo refresh_token, y el token nuevo se guarda apenas llega
 *   (autocommit), antes de cualquier otra escritura que pudiera fallar. El POST de token no se reintenta.
 * - 401/403 de la API → awaiting_credentials con instrucción de reautorizar (docs/INTEGRATIONS.md).
 * - Items: POST /items (crear), PUT /items/{id} (actualizar, status paused/active/closed),
 *   PUT /items/{id}/description, GET /items/{id}, GET /users/{id}/items/search?sku= (por seller_custom_field).
 * - POST /items NO es idempotente: nunca se reintenta; timeout/5xx → resultado incierto (sin reintento automático).
 *   Cada aviso lleva seller_custom_field = LLF-<código>; si hubo un intento incierto (o el aviso guardado ya no
 *   existe: 404) se busca por esa referencia y se adopta el existente en lugar de crear otro.
 * - "remove" PAUSA el aviso (reversible). Cerrar (closed) es irreversible y no se hace automáticamente.
 */
import { createHash } from "node:crypto";
import { sql, type Database } from "../../../db";
import { log } from "../../../log";
import { callIntegration, UncertainOutcomeError } from "../../../resilience";
import { NotConfiguredError, PermanentIntegrationError, isRetryable, requestJson } from "../../http";
import { encryptionKey, readCredentials, writeCredentials } from "../../secrets";
import type {
  PortalAdapter,
  PortalConfiguration,
  PortalFailure,
  PortalFindResult,
  PortalOpResult,
  PortalProperty,
  PortalPublishOptions,
  PortalRemoteState,
  PortalRemoveResult,
  PortalStatusResult,
} from "../types";
import {
  ML_INDIVIDUAL_SUBTYPE,
  deriveListAttributes,
  mapToMercadoLibre,
  missingRequiredAttributes,
  normalizeName,
  type MercadoLibreItemDraft,
  type MlAttributeDef,
  type MlCategory,
} from "./mapping";

export const ML_INTEGRATION_KEY = "mercadolibre";
const API = "https://api.mercadolibre.com";
const TOKEN_LOCK = "integration_token:mercadolibre";
export const ML_TOKEN_TIMEOUT_MS = 30_000;
export const ML_REAUTHORIZE_HINT = "Volvé a autorizar la aplicación en Mercado Libre y cargá el refresh token nuevo en MERCADOLIBRE_REFRESH_TOKEN (ver docs/INTEGRATIONS.md → Mercado Libre → Reautorizar).";

/** Referencia propia del aviso (seller_custom_field): permite encontrarlo si se perdió la respuesta de la creación. */
export function mercadoLibreReference(code: number): string {
  return `LLF-${code}`;
}

type StoredTokens = { accessToken: string; refreshToken: string; userId: number | null; bootstrapFingerprint: string | null };
type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; user_id?: number };

function env() {
  return {
    clientId: process.env.MERCADOLIBRE_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.MERCADOLIBRE_CLIENT_SECRET?.trim() ?? "",
    refreshToken: process.env.MERCADOLIBRE_REFRESH_TOKEN?.trim() ?? "",
    listingTypeId: process.env.MERCADOLIBRE_LISTING_TYPE?.trim() || "silver",
    whatsapp: process.env.MERCADOLIBRE_CONTACT_WHATSAPP?.trim() ?? "",
  };
}

const fingerprint = (s: string) => (s ? createHash("sha256").update(s).digest("hex") : null);

async function configuration(db: Database): Promise<PortalConfiguration> {
  const e = env();
  const missing: string[] = [];
  if (!e.clientId) missing.push("MERCADOLIBRE_CLIENT_ID");
  if (!e.clientSecret) missing.push("MERCADOLIBRE_CLIENT_SECRET");
  if (!e.whatsapp) missing.push("MERCADOLIBRE_CONTACT_WHATSAPP");
  const key = encryptionKey();
  if (!key) missing.push("INTEGRATIONS_ENCRYPTION_KEY (32 bytes base64/hex)");
  if (!e.refreshToken) {
    const stored = await db.selectFrom("integration_credentials").select("integration_key").where("integration_key", "=", ML_INTEGRATION_KEY).executeTakeFirst();
    if (!stored) missing.push("MERCADOLIBRE_REFRESH_TOKEN");
  }
  return missing.length ? { configured: false, reason: `Faltan: ${missing.join(", ")}` } : { configured: true };
}

/** La integración queda esperando credenciales con el motivo (visible en el panel). No pisa `disabled`. */
async function markReauthorizationRequired(db: Database, reason: string): Promise<void> {
  await db
    .updateTable("integrations")
    .set({ status: "awaiting_credentials", last_error: reason.slice(0, 1000), updated_at: new Date() })
    .where("key", "=", ML_INTEGRATION_KEY)
    .where("status", "<>", "disabled")
    .execute();
}

/** Access token vigente (renueva con el refresh_token rotativo si hace falta). */
export async function mercadoLibreAccessToken(db: Database): Promise<string> {
  const e = env();
  const key = encryptionKey();
  if (!key || !e.clientId || !e.clientSecret) throw new NotConfiguredError("Mercado Libre sin credenciales completas");
  const envFp = fingerprint(e.refreshToken);
  const read = (ex: Database) =>
    readCredentials<StoredTokens>(ex, ML_INTEGRATION_KEY, key).catch((err) => {
      throw new NotConfiguredError(`No se pudieron descifrar las credenciales guardadas de Mercado Libre (¿cambió INTEGRATIONS_ENCRYPTION_KEY?): ${(err as Error).message}`);
    });
  const usable = (c: Awaited<ReturnType<typeof read>>): boolean =>
    !!c && !!c.accessExpiresAt && c.accessExpiresAt.getTime() - Date.now() > 5 * 60_000 && (!envFp || c.value.bootstrapFingerprint === envFp);
  const quick = await read(db);
  if (quick && usable(quick)) return quick.value.accessToken;

  // Una sola conexión para lock + lectura + llamada + guardado (no se toma una segunda conexión del pool con el lock
  // tomado). Cada escritura es autocommit: el token nuevo queda guardado aunque después falle otra cosa.
  return db.connection().execute(async (conn) => {
    await sql`select pg_advisory_lock(hashtext(${TOKEN_LOCK}))`.execute(conn);
    try {
      const current = await read(conn);
      if (current && usable(current)) return current.value.accessToken;
      const envChanged = !!envFp && current?.value.bootstrapFingerprint !== envFp;
      const refreshToken = envChanged || !current ? e.refreshToken : current.value.refreshToken;
      if (!refreshToken) throw new NotConfiguredError(`Falta MERCADOLIBRE_REFRESH_TOKEN. ${ML_REAUTHORIZE_HINT}`);
      try {
        return await callIntegration(conn, ML_INTEGRATION_KEY, "oauth.refresh", async () => {
          const { data } = await requestJson<TokenResponse>(`${API}/oauth/token`, {
            method: "POST",
            label: "Mercado Libre oauth",
            form: { grant_type: "refresh_token", client_id: e.clientId, client_secret: e.clientSecret, refresh_token: refreshToken },
            nonIdempotent: true, // consume el refresh_token: reintentar a ciegas lo invalidaría
            timeoutMs: ML_TOKEN_TIMEOUT_MS,
          });
          if (!data?.access_token || !data.refresh_token) throw new PermanentIntegrationError("Mercado Libre respondió sin tokens");
          // Primero se guarda (el refresh_token viejo ya no sirve); recién después se registra el éxito.
          await writeCredentials(
            conn,
            ML_INTEGRATION_KEY,
            key,
            { accessToken: data.access_token, refreshToken: data.refresh_token, userId: data.user_id ?? null, bootstrapFingerprint: envFp } satisfies StoredTokens,
            new Date(Date.now() + (data.expires_in ?? 21_600) * 1000),
          );
          return data.access_token;
        });
      } catch (err) {
        if (err instanceof PermanentIntegrationError && err.status !== undefined) {
          const reason = `Mercado Libre rechazó el refresh token (invalid_grant/invalid_client). ${ML_REAUTHORIZE_HINT} ${err.message}`;
          await markReauthorizationRequired(conn, reason);
          throw new NotConfiguredError(reason);
        }
        if (err instanceof UncertainOutcomeError) {
          log.error("mercadolibre.token_refresh_uncertain", { error: err.message });
          throw new UncertainOutcomeError(
            `Mercado Libre no respondió la renovación del token: puede haber consumido el refresh token. Se reintenta con el guardado; si lo rechaza, hay que reautorizar. ${err.message}`,
          );
        }
        throw err;
      }
    } finally {
      await sql`select pg_advisory_unlock(hashtext(${TOKEN_LOCK}))`.execute(conn);
    }
  });
}

/** Tras un 401/403: el access token guardado deja de usarse (la próxima llamada intenta renovarlo). */
async function expireAccessToken(db: Database): Promise<void> {
  await db.updateTable("integration_credentials").set({ access_expires_at: new Date(0).toISOString() }).where("integration_key", "=", ML_INTEGRATION_KEY).execute();
}

type ApiInit = { method?: string; body?: unknown; entityId?: string; nonIdempotent?: boolean };

async function api<T>(db: Database, operation: string, path: string, init: ApiInit = {}): Promise<T> {
  const token = await mercadoLibreAccessToken(db);
  try {
    return await callIntegration(
      db,
      ML_INTEGRATION_KEY,
      operation,
      async () =>
        (
          await requestJson<T>(`${API}${path}`, {
            method: init.method ?? "GET",
            body: init.body,
            label: `Mercado Libre ${operation}`,
            headers: { authorization: `Bearer ${token}` },
            timeoutMs: 20_000,
            attempts: 2,
            nonIdempotent: init.nonIdempotent,
          })
        ).data,
      { entityType: "property", entityId: init.entityId },
    );
  } catch (e) {
    if (e instanceof PermanentIntegrationError && (e.status === 401 || e.status === 403)) {
      await expireAccessToken(db);
      const reason = `Mercado Libre rechazó el acceso (HTTP ${e.status}). ${ML_REAUTHORIZE_HINT}`;
      await markReauthorizationRequired(db, reason);
      throw new NotConfiguredError(`${reason} · ${e.message}`);
    }
    throw e;
  }
}

const isNotFound = (e: unknown) => e instanceof PermanentIntegrationError && e.status === 404;

const categoryCache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = categoryCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.value as T;
  const value = await load();
  categoryCache.set(key, { at: Date.now(), value });
  return value;
}

export function clearMercadoLibreCacheForTests(): void {
  categoryCache.clear();
}

/** Tipo → operación → subtipo "Propiedades Individuales" (o la operación si no tiene hijos). */
export async function resolveFinalCategory(db: Database, draft: MercadoLibreItemDraft): Promise<string> {
  const typeCat = await cached(`cat:${draft.typeCategoryId}`, () => api<MlCategory>(db, "categories.get", `/categories/${draft.typeCategoryId}`));
  const opChild = typeCat.children_categories?.find((c) => normalizeName(c.name) === normalizeName(draft.operationName));
  if (!opChild) throw new PermanentIntegrationError(`Mercado Libre no ofrece "${draft.operationName}" en la categoría ${typeCat.name}`);
  const opCat = await cached(`cat:${opChild.id}`, () => api<MlCategory>(db, "categories.get", `/categories/${opChild.id}`));
  if (!opCat.children_categories?.length) return opCat.id;
  const individual = opCat.children_categories.find((c) => normalizeName(c.name) === normalizeName(ML_INDIVIDUAL_SUBTYPE));
  if (!individual) throw new PermanentIntegrationError(`No se encontró la subcategoría "${ML_INDIVIDUAL_SUBTYPE}" en ${typeCat.name} › ${opCat.name}`);
  return individual.id;
}

async function completeDraft(db: Database, p: PortalProperty, draft: MercadoLibreItemDraft) {
  const categoryId = await resolveFinalCategory(db, draft);
  const defs = await cached(`attrs:${categoryId}`, () => api<MlAttributeDef[]>(db, "categories.attributes", `/categories/${categoryId}/attributes`));
  const attributes = [...draft.item.attributes, ...deriveListAttributes(defs, draft, p.typeName)];
  const missing = missingRequiredAttributes(defs, attributes);
  if (missing.length) {
    throw new PermanentIntegrationError(`Faltan datos que Mercado Libre exige para esta categoría: ${missing.map((m) => m.name).join(", ")}`);
  }
  return { categoryId, attributes };
}

function failure(e: unknown): PortalFailure {
  const error = ((e as Error).message ?? String(e)).slice(0, 1000);
  if (e instanceof NotConfiguredError) return { ok: false, reason: "awaiting_credentials", error };
  if (e instanceof UncertainOutcomeError) return { ok: false, reason: "uncertain", error };
  if (e instanceof PermanentIntegrationError) return { ok: false, reason: "invalid_data", error };
  if (isRetryable(e)) return { ok: false, reason: "transient", error };
  return { ok: false, reason: "transient", error };
}

type MlItem = { id: string; permalink?: string; status?: string; sub_status?: string[] };

function prepare(p: PortalProperty) {
  const e = env();
  return mapToMercadoLibre(p, { listingTypeId: e.listingTypeId, whatsappE164: e.whatsapp });
}

function stateOf(item: MlItem): PortalRemoteState {
  switch (item.status) {
    case "active":
      return "active";
    case "paused":
      return "paused";
    case "closed":
      return "closed";
    case "under_review":
    case "not_yet_active":
    case "payment_required":
      return "under_review";
    default:
      return "unknown";
  }
}

async function userId(db: Database): Promise<number> {
  const key = encryptionKey();
  const stored = key ? await readCredentials<StoredTokens>(db, ML_INTEGRATION_KEY, key).catch(() => null) : null;
  if (stored?.value.userId) return stored.value.userId;
  const me = await api<{ id?: number }>(db, "users.me", "/users/me");
  if (!me?.id) throw new PermanentIntegrationError("Mercado Libre no devolvió el id de usuario");
  return me.id;
}

/** Aviso existente (no cerrado) con nuestra referencia. `null` si no hay: recién ahí es seguro crear. */
async function findByReference(db: Database, p: Pick<PortalProperty, "id" | "code">): Promise<PortalFindResult> {
  try {
    const uid = await userId(db);
    const ref = mercadoLibreReference(p.code);
    const found = await api<{ results?: string[] }>(db, "items.search_reference", `/users/${uid}/items/search?sku=${encodeURIComponent(ref)}`, { entityId: p.id });
    for (const id of (found?.results ?? []).slice(0, 10)) {
      const item = await api<MlItem>(db, "items.get", `/items/${encodeURIComponent(id)}`, { entityId: p.id });
      if (stateOf(item) !== "closed") return { ok: true, item: { externalId: item.id ?? id, externalUrl: item.permalink ?? null, state: stateOf(item) } };
    }
    return { ok: true, item: null };
  } catch (e) {
    return failure(e);
  }
}

async function publish(db: Database, p: PortalProperty, opts: PortalPublishOptions = {}): Promise<PortalOpResult> {
  const prepared = prepare(p);
  if (!prepared.ok) return { ok: false, reason: "invalid_data", error: prepared.errors.join(" · ") };
  if (opts.searchExisting) {
    const found = await findByReference(db, p);
    if (!found.ok) return found;
    if (found.item) {
      log.warn("mercadolibre.item_adopted", { propertyId: p.id, externalId: found.item.externalId });
      const adopted = await updateExisting(db, found.item.externalId, p, { searchExisting: false });
      return adopted.ok ? { ...adopted, adopted: true } : adopted;
    }
  }
  try {
    const { categoryId, attributes } = await completeDraft(db, p, prepared.payload);
    const item = await api<MlItem>(db, "items.create", "/items", {
      method: "POST",
      body: { ...prepared.payload.item, attributes, category_id: categoryId, seller_custom_field: mercadoLibreReference(p.code) },
      entityId: p.id,
      nonIdempotent: true,
    });
    if (!item?.id) return { ok: false, reason: "uncertain", error: uncertainCreateMessage(p.code, "Mercado Libre respondió sin id de aviso") };
    return { ok: true, externalId: item.id, externalUrl: item.permalink ?? null };
  } catch (e) {
    if (e instanceof UncertainOutcomeError) return { ok: false, reason: "uncertain", error: uncertainCreateMessage(p.code, e.message) };
    return failure(e);
  }
}

export function uncertainCreateMessage(code: number, detail: string): string {
  return `Resultado incierto: Mercado Libre no confirmó la creación del aviso y pudo haberlo creado. Verificá en Mercado Libre (Mis publicaciones, SKU ${mercadoLibreReference(code)}) antes de reintentar; el reintento manual busca el aviso por esa referencia y lo adopta en lugar de crear otro. (${detail})`.slice(0, 1000);
}

async function update(db: Database, externalId: string, p: PortalProperty, opts: PortalPublishOptions = {}): Promise<PortalOpResult> {
  return updateExisting(db, externalId, p, opts);
}

async function updateExisting(db: Database, externalId: string, p: PortalProperty, opts: PortalPublishOptions): Promise<PortalOpResult> {
  const prepared = prepare(p);
  if (!prepared.ok) return { ok: false, reason: "invalid_data", error: prepared.errors.join(" · ") };
  try {
    let current: MlItem;
    try {
      current = await api<MlItem>(db, "items.get", `/items/${encodeURIComponent(externalId)}`, { entityId: p.id });
    } catch (e) {
      // El aviso guardado ya no existe (borrado en el portal): se recrea, buscando antes uno nuestro por referencia.
      if (isNotFound(e)) return publish(db, p, { searchExisting: true });
      throw e;
    }
    // Un aviso cerrado no se reactiva: se publica uno nuevo y se reemplaza la referencia.
    if (stateOf(current) === "closed") return publish(db, p, { searchExisting: opts.searchExisting ?? false });
    const { attributes } = await completeDraft(db, p, prepared.payload);
    const it = prepared.payload.item;
    let item: MlItem;
    try {
      item = await api<MlItem>(db, "items.update", `/items/${encodeURIComponent(externalId)}`, {
        method: "PUT",
        entityId: p.id,
        body: {
          title: it.title,
          price: it.price,
          currency_id: it.currency_id,
          pictures: it.pictures,
          attributes,
          location: it.location,
          seller_contact: it.seller_contact,
          ...(stateOf(current) === "paused" ? { status: "active" } : {}),
        },
      });
    } catch (e) {
      if (isNotFound(e)) return publish(db, p, { searchExisting: true });
      throw e;
    }
    await api(db, "items.description", `/items/${encodeURIComponent(externalId)}/description`, { method: "PUT", body: { plain_text: it.description.plain_text }, entityId: p.id });
    return { ok: true, externalId, externalUrl: item?.permalink ?? current.permalink ?? null };
  } catch (e) {
    return failure(e);
  }
}

async function remove(db: Database, externalId: string): Promise<PortalRemoveResult> {
  try {
    let current: MlItem;
    try {
      current = await api<MlItem>(db, "items.get", `/items/${encodeURIComponent(externalId)}`);
    } catch (e) {
      if (isNotFound(e)) return { ok: true }; // ya no existe: no queda nada visible que pausar
      throw e;
    }
    const state = stateOf(current);
    if (state === "paused" || state === "closed") return { ok: true };
    await api(db, "items.pause", `/items/${encodeURIComponent(externalId)}`, { method: "PUT", body: { status: "paused" } });
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

async function getStatus(db: Database, externalId: string): Promise<PortalStatusResult> {
  try {
    const item = await api<MlItem>(db, "items.get", `/items/${encodeURIComponent(externalId)}`);
    return { ok: true, state: stateOf(item), externalUrl: item.permalink ?? null };
  } catch (e) {
    return failure(e);
  }
}

export const mercadoLibreAdapter: PortalAdapter = {
  channelKey: "mercadolibre",
  integrationKey: ML_INTEGRATION_KEY,
  name: "Mercado Libre Inmuebles",
  configuration,
  prepare,
  publish,
  update,
  remove,
  getStatus,
  findByReference,
};
