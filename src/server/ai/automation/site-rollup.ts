/**
 * Eventos de negocio agregados desde la analítica first-party (`site_events`), UNO por propiedad y día de Salta — nunca
 * uno por request (docs/ai/EVENTS.md). Job diario `ai.site_events_rollup` (día anterior), idempotente por dedupe_key.
 *
 * - `property.viewed`: vistas de la ficha (`property_viewed`) y sesiones distintas.
 * - `tour.started`: sesiones que abrieron el tour 360° (`virtual_tour_opened`).
 * - `tour.completed`: sesiones que recorrieron todas las escenas publicadas del tour (mínimo 2), contando escenas vistas
 *   distintas o el `scenesViewed` informado al cerrar (lo mayor).
 * Payload: solo contadores, fecha e ids. Sin sesiones, IP ni datos personales.
 */
import "server-only";
import { sql, type Database } from "../../db";
import type { SystemActor } from "../../auth/actor";
import { emitEvent } from "../../events";
import { saltaDayStart, saltaToday } from "../management-settings";

export async function rollupSiteEvents(db: Database, system: SystemActor, day = saltaToday(new Date(), -1)): Promise<{ day: string; viewed: number; toursStarted: number; toursCompleted: number }> {
  const from = saltaDayStart(day);
  const to = new Date(from.getTime() + 86_400_000);
  const [views, tours] = await Promise.all([
    sql<{ property_id: string; views: number; sessions: number }>`
      select e.property_id, count(*)::int as views, count(distinct e.session_key)::int as sessions
        from site_events e join properties p on p.id = e.property_id and p.organization_id = ${system.organizationId} and not p.is_demo
       where e.name = 'property_viewed' and e.occurred_at >= ${from} and e.occurred_at < ${to}
       group by e.property_id`.execute(db),
    sql<{ property_id: string; started: number; completed: number }>`
      with s as (
        select e.property_id, e.tour_id, e.session_key,
               bool_or(e.name = 'virtual_tour_opened') as opened,
               count(distinct e.scene_id) filter (where e.name = 'virtual_tour_scene_viewed') as scenes,
               coalesce(max((e.props->>'scenesViewed')::int) filter (where e.name = 'virtual_tour_closed'), 0) as closed_scenes
          from site_events e
         where e.tour_id is not null and e.property_id is not null and e.occurred_at >= ${from} and e.occurred_at < ${to}
         group by 1, 2, 3
      ), totals as (
        select t.id as tour_id, count(sc.id) filter (where sc.is_published) as published_scenes
          from virtual_tours t left join virtual_tour_scenes sc on sc.tour_id = t.id group by t.id
      )
      select s.property_id, count(*) filter (where s.opened)::int as started,
             count(*) filter (where tt.published_scenes >= 2 and greatest(s.scenes, s.closed_scenes) >= tt.published_scenes)::int as completed
        from s join totals tt on tt.tour_id = s.tour_id join properties p on p.id = s.property_id and p.organization_id = ${system.organizationId} and not p.is_demo
       group by s.property_id`.execute(db),
  ]);
  let viewed = 0;
  let toursStarted = 0;
  let toursCompleted = 0;
  await db.transaction().execute(async (trx) => {
    for (const v of views.rows) {
      if (await emitEvent(trx, system, { type: "property.viewed", aggregateType: "property", aggregateId: v.property_id, payload: { date: day, views: v.views, sessions: v.sessions }, dedupeKey: `property.viewed:${v.property_id}:${day}` })) viewed++;
    }
    for (const t of tours.rows) {
      if (t.started > 0 && (await emitEvent(trx, system, { type: "tour.started", aggregateType: "property", aggregateId: t.property_id, payload: { date: day, sessions: t.started }, dedupeKey: `tour.started:${t.property_id}:${day}` }))) toursStarted++;
      if (t.completed > 0 && (await emitEvent(trx, system, { type: "tour.completed", aggregateType: "property", aggregateId: t.property_id, payload: { date: day, sessions: t.completed }, dedupeKey: `tour.completed:${t.property_id}:${day}` }))) toursCompleted++;
    }
  });
  return { day, viewed, toursStarted, toursCompleted };
}
