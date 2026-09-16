/** Acciones del panel de portales: reintento manual y habilitar/deshabilitar canal (auditadas). */
import { z } from "zod";
import type { Database } from "../../db";
import { audit } from "../../audit";
import { requirePermission, type Actor } from "../../auth/actor";
import { conflict, invalid, notFound } from "../../errors";
import { isEnabled } from "../../flags";
import { enqueuePortalSync } from "./sync";

const retrySchema = z.object({ publicationId: z.uuid() });

export async function retryPublication(db: Database, actor: Actor, raw: unknown): Promise<{ queued: boolean }> {
  requirePermission(actor, "publications.manage");
  const input = retrySchema.parse(raw);
  if (!(await isEnabled(db, "portal_sync"))) throw invalid("La sincronización con portales está desactivada (feature flag portal_sync).");
  return db.transaction().execute(async (trx) => {
    const pub = await trx
      .selectFrom("property_publications as pp")
      .innerJoin("publication_channels as c", "c.key", "pp.channel_key")
      .select(["pp.id", "pp.property_id", "pp.channel_key", "pp.sync_status", "pp.last_error", "c.kind", "c.is_enabled"])
      .where("pp.id", "=", input.publicationId)
      .forUpdate("pp")
      .executeTakeFirst();
    if (!pub) throw notFound("Publicación");
    if (pub.kind !== "portal") throw invalid("Solo se reintentan publicaciones en portales");
    if (!pub.is_enabled) throw invalid("El canal está deshabilitado: habilitalo antes de reintentar");
    if (pub.sync_status === "syncing") throw conflict("Ya se está sincronizando");
    await trx.updateTable("property_publications").set({ sync_status: "pending", last_error: null }).where("id", "=", pub.id).execute();
    const jobId = await enqueuePortalSync(trx, pub.property_id, pub.channel_key, "manual");
    await audit(trx, actor, {
      action: "PUBLICATION_SYNC_RETRY",
      entityType: "property",
      entityId: pub.property_id,
      before: { channel: pub.channel_key, syncStatus: pub.sync_status, lastError: pub.last_error },
      after: { channel: pub.channel_key, syncStatus: "pending" },
      metadata: { publicationId: pub.id, jobQueued: Boolean(jobId) },
    });
    return { queued: Boolean(jobId) };
  });
}

const channelSchema = z.object({ channelKey: z.string().regex(/^[a-z0-9_]{2,40}$/), enabled: z.boolean() });

export async function setPortalChannelEnabled(db: Database, actor: Actor, raw: unknown): Promise<{ changed: boolean; queued: number }> {
  requirePermission(actor, "publications.manage");
  const input = channelSchema.parse(raw);
  const flagOn = await isEnabled(db, "portal_sync");
  return db.transaction().execute(async (trx) => {
    const ch = await trx.selectFrom("publication_channels").selectAll().where("key", "=", input.channelKey).forUpdate().executeTakeFirst();
    if (!ch) throw notFound("Canal");
    if (ch.kind !== "portal") throw invalid("Desde acá solo se gestionan portales");
    if (ch.is_enabled === input.enabled) return { changed: false, queued: 0 };
    await trx.updateTable("publication_channels").set({ is_enabled: input.enabled }).where("key", "=", ch.key).execute();
    let queued = 0;
    if (input.enabled) {
      const rows = await trx
        .updateTable("property_publications")
        .set({ sync_status: "pending", last_error: null })
        .where("channel_key", "=", ch.key)
        .where("sync_status", "=", "disabled")
        .returning("property_id")
        .execute();
      if (flagOn) for (const r of rows) if (await enqueuePortalSync(trx, r.property_id, ch.key, "channel_enabled")) queued++;
    } else {
      // Deshabilitar no borra avisos ya publicados en el portal: solo deja de sincronizar.
      await trx.updateTable("property_publications").set({ sync_status: "disabled" }).where("channel_key", "=", ch.key).where("sync_status", "<>", "syncing").execute();
    }
    await audit(trx, actor, {
      action: input.enabled ? "PUBLICATION_CHANNEL_ENABLED" : "PUBLICATION_CHANNEL_DISABLED",
      entityType: "publication_channel",
      entityId: ch.key,
      before: { isEnabled: ch.is_enabled },
      after: { isEnabled: input.enabled },
      metadata: { queued },
    });
    return { changed: true, queued };
  });
}
