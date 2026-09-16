/**
 * Adaptador Mercado Libre Inmuebles (API pública documentada).
 * - OAuth: POST https://api.mercadolibre.com/oauth/token (grant_type=refresh_token, form-urlencoded).
 *   access_token dura 6 h; el refresh_token es DE UN SOLO USO y cada renovación devuelve uno nuevo → se guarda
 *   cifrado en integration_credentials. MERCADOLIBRE_REFRESH_TOKEN solo se usa como arranque (o si cambia).
 *   La renovación se serializa con un advisory lock: dos workers nunca consumen el mismo refresh_token.
 * - Items: POST /items (crear), PUT /items/{id} (actualizar, status paused/active/closed),
 *   PUT /items/{id}/description, GET /items/{id}.
 * - "remove" PAUSA el aviso (reversible). Cerrar (closed) es irreversible y no se hace automáticamente.
 */
import { createHash } from "node:crypto";
import { sql, type Database } from "../../../db";
import { callIntegration } from "../../../resilience";
import { NotConfiguredError, PermanentIntegrationError, isRetryable, requestJson } from "../../http";
import { encryptionKey, readCredentials, writeCredentials } from "../../secrets";
import type { PortalAdapter, PortalConfiguration, PortalFailure, PortalOpResult, PortalProperty, PortalRemoteState, PortalRemoveResult, PortalStatusResult } from "../types";
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

/** Access token vigente (renueva con el refresh_token rotativo si hace falta). */
export async function mercadoLibreAccessToken(db: Database): Promise<string> {
  const e = env();
  const key = encryptionKey();
  if (!key || !e.clientId || !e.clientSecret) throw new NotConfiguredError("Mercado Libre sin credenciales completas");
  const envFp = fingerprint(e.refreshToken);
  const quick = await readCredentials<StoredTokens>(db, ML_INTEGRATION_KEY, key).catch((err) => {
    throw new NotConfiguredError(`No se pudieron descifrar las credenciales guardadas de Mercado Libre (¿cambió INTEGRATIONS_ENCRYPTION_KEY?): ${(err as Error).message}`);
  });
  const usable = (c: typeof quick): boolean =>
    !!c && !!c.accessExpiresAt && c.accessExpiresAt.getTime() - Date.now() > 5 * 60_000 && (!envFp || c.value.bootstrapFingerprint === envFp);
  if (quick && usable(quick)) return quick.value.accessToken;

  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext('integration_token:mercadolibre'))`.execute(trx);
    const current = await readCredentials<StoredTokens>(trx, ML_INTEGRATION_KEY, key, { forUpdate: true });
    if (current && usable(current)) return current.value.accessToken;
    const envChanged = !!envFp && current?.value.bootstrapFingerprint !== envFp;
    const refreshToken = envChanged || !current ? e.refreshToken : current.value.refreshToken;
    if (!refreshToken) throw new NotConfiguredError("Falta MERCADOLIBRE_REFRESH_TOKEN (autorizar la aplicación en Mercado Libre)");
    let data: TokenResponse;
    try {
      data = await callIntegration(db, ML_INTEGRATION_KEY, "oauth.refresh", async () =>
        (
          await requestJson<TokenResponse>(`${API}/oauth/token`, {
            method: "POST",
            label: "Mercado Libre oauth",
            form: { grant_type: "refresh_token", client_id: e.clientId, client_secret: e.clientSecret, refresh_token: refreshToken },
            attempts: 1,
            timeoutMs: 15_000,
          })
        ).data,
      );
    } catch (err) {
      if (err instanceof PermanentIntegrationError) {
        throw new NotConfiguredError(`Mercado Libre rechazó el refresh token (invalid_grant/invalid_client): hay que volver a autorizar la aplicación. ${err.message}`);
      }
      throw err;
    }
    if (!data?.access_token || !data.refresh_token) throw new PermanentIntegrationError("Mercado Libre respondió sin tokens");
    await writeCredentials(
      trx,
      ML_INTEGRATION_KEY,
      key,
      { accessToken: data.access_token, refreshToken: data.refresh_token, userId: data.user_id ?? null, bootstrapFingerprint: envFp } satisfies StoredTokens,
      new Date(Date.now() + (data.expires_in ?? 21_600) * 1000),
    );
    return data.access_token;
  });
}

async function api<T>(db: Database, operation: string, path: string, init: { method?: string; body?: unknown; entityId?: string } = {}): Promise<T> {
  const token = await mercadoLibreAccessToken(db);
  return callIntegration(
    db,
    ML_INTEGRATION_KEY,
    operation,
    async () => (await requestJson<T>(`${API}${path}`, { method: init.method ?? "GET", body: init.body, label: `Mercado Libre ${operation}`, headers: { authorization: `Bearer ${token}` }, timeoutMs: 20_000, attempts: 2 })).data,
    { entityType: "property", entityId: init.entityId },
  );
}

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

async function publish(db: Database, p: PortalProperty): Promise<PortalOpResult> {
  const prepared = prepare(p);
  if (!prepared.ok) return { ok: false, reason: "invalid_data", error: prepared.errors.join(" · ") };
  try {
    const { categoryId, attributes } = await completeDraft(db, p, prepared.payload);
    const item = await api<MlItem>(db, "items.create", "/items", { method: "POST", body: { ...prepared.payload.item, attributes, category_id: categoryId }, entityId: p.id });
    if (!item?.id) return { ok: false, reason: "transient", error: "Mercado Libre respondió sin id de aviso" };
    return { ok: true, externalId: item.id, externalUrl: item.permalink ?? null };
  } catch (e) {
    return failure(e);
  }
}

async function update(db: Database, externalId: string, p: PortalProperty): Promise<PortalOpResult> {
  const prepared = prepare(p);
  if (!prepared.ok) return { ok: false, reason: "invalid_data", error: prepared.errors.join(" · ") };
  try {
    const current = await api<MlItem>(db, "items.get", `/items/${encodeURIComponent(externalId)}`, { entityId: p.id });
    // Un aviso cerrado no se reactiva: se publica uno nuevo y se reemplaza la referencia.
    if (stateOf(current) === "closed") return publish(db, p);
    const { attributes } = await completeDraft(db, p, prepared.payload);
    const it = prepared.payload.item;
    const item = await api<MlItem>(db, "items.update", `/items/${encodeURIComponent(externalId)}`, {
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
    await api(db, "items.description", `/items/${encodeURIComponent(externalId)}/description`, { method: "PUT", body: { plain_text: it.description.plain_text }, entityId: p.id });
    return { ok: true, externalId, externalUrl: item?.permalink ?? current.permalink ?? null };
  } catch (e) {
    return failure(e);
  }
}

async function remove(db: Database, externalId: string): Promise<PortalRemoveResult> {
  try {
    const current = await api<MlItem>(db, "items.get", `/items/${encodeURIComponent(externalId)}`);
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
};
