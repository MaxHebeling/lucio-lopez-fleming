/**
 * Acción `create_social_drafts` (evento property.published): un borrador por evento y canal
 * (unique source_event_id+channel), copy desde content_templates y fotos verificadas (portada + hasta 9).
 * Nunca publica: queda en `draft` hasta que una persona apruebe y programe (lo exige el CHECK de social_posts).
 * Post + fotos en la misma transacción. Si un intento anterior dejó el post sin fotos (versión previa o corte), el
 * reintento las rehidrata mientras siga en borrador y nadie haya elegido fotos a mano.
 */
import { z } from "zod";
import { sql } from "../db";
import { registerAction } from "../automation/actions";
import { isEnabled } from "../flags";
import { notifyRole } from "../notifications";
import { propertyImages } from "../media/public-url";
import { loadPortalProperty } from "../integrations/portals/snapshot";
import { buildCopyVars, CAPTION_MAX, renderContentTemplate } from "./copy";

const params = z.object({ channels: z.array(z.enum(["instagram", "facebook"])).min(1).max(2).default(["instagram", "facebook"]) });

export const MAX_POST_ASSETS = 10;

registerAction("create_social_drafts", async (raw, ctx) => {
  const p = params.parse(raw);
  if (ctx.event.aggregateType !== "property") return { skipped: "el evento no es de una propiedad" };
  if (!(await isEnabled(ctx.db, "social_drafts"))) return { skipped: "feature flag social_drafts apagado" };
  const property = await loadPortalProperty(ctx.db, ctx.event.aggregateId);
  if (!property) return { skipped: "propiedad inexistente" };
  if (!property.isPublished) return { skipped: "la propiedad ya no está publicada" };

  const org = await ctx.db.selectFrom("organizations").select(["name", "founded_year"]).where("id", "=", ctx.actor.organizationId).executeTakeFirst();
  const vars = buildCopyVars(property, { name: org?.name ?? property.contact.name, foundedYear: org?.founded_year ?? null });
  const images = (await propertyImages(ctx.db, property.id, { onlyVerified: true })).slice(0, MAX_POST_ASSETS);

  const created: string[] = [];
  let rehydrated = 0;
  for (const channel of p.channels) {
    const template = await ctx.db
      .selectFrom("content_templates")
      .select(["key", "body"])
      .where("channel", "=", channel)
      .where("is_active", "=", true)
      .orderBy(sql`case when key = ${`property_published_${channel}`} then 0 else 1 end`)
      .orderBy("key")
      .executeTakeFirst();
    if (!template) continue;
    const caption = renderContentTemplate(template.body, vars).slice(0, CAPTION_MAX[channel]);
    const postId = await ctx.db.transaction().execute(async (trx) => {
      const inserted = await sql<{ id: string }>`
        insert into social_posts(property_id, channel, status, caption, template_key, generated_by, source_event_id)
        values (${property.id}, ${channel}, 'draft', ${caption}, ${template.key}, 'template', ${ctx.event.id})
        on conflict (source_event_id, channel) where source_event_id is not null do nothing
        returning id`.execute(trx);
      let id = inserted.rows[0]?.id ?? null;
      if (!id) {
        // Ya existía (reintento): solo se completan las fotos si quedó sin ninguna y sigue siendo un borrador sin tocar.
        const existing = await trx
          .selectFrom("social_posts as sp")
          .select(["sp.id", "sp.status", "sp.generated_by"])
          .select((eb) => eb.selectFrom("social_assets as sa").select(eb.fn.countAll<string>().as("n")).whereRef("sa.social_post_id", "=", "sp.id").as("assets"))
          .where("sp.source_event_id", "=", ctx.event.id)
          .where("sp.channel", "=", channel)
          .forUpdate("sp")
          .executeTakeFirst();
        if (!existing || existing.status !== "draft" || existing.generated_by !== "template" || Number(existing.assets ?? 0) > 0 || !images.length) return null;
        id = existing.id;
        rehydrated++;
      }
      if (images.length) {
        await trx
          .insertInto("social_assets")
          .values(images.map((img, i) => ({ social_post_id: id!, property_media_id: img.id, sort_order: i })))
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
      return inserted.rows[0]?.id ?? null;
    });
    if (!postId) continue;
    created.push(postId);
  }
  if (created.length || rehydrated) {
    await notifyRole(ctx.db, "marketing", {
      kind: "social_drafts",
      title: `Borradores de redes para revisar · código ${property.code}`,
      body: images.length ? null : "La propiedad no tiene fotos verificadas: agregá fotos antes de aprobar.",
      link: "/crm/marketing",
      entityType: "property",
      entityId: property.id,
      dedupeKey: ctx.dedupeBase,
    });
  }
  return { created: created.length, rehydrated, assets: images.length };
});
