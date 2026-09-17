/** Señales de interés de un contacto, con el alcance comercial del usuario. Retención alineada con site_events. */
import "server-only";
import { sql, type Executor } from "../../db";
import type { Actor } from "../../auth/actor";
import { loadSalesContact } from "../scope";
import { computeIntentSignals, type SignalFacts } from "./rules";

export async function loadSignalFacts(db: Executor, contactId: string): Promise<SignalFacts> {
  const [events, leads, visits] = await Promise.all([
    sql<{ name: string; property_id: string | null; code: number | null; day: string; topic: string | null }>`
      select e.name, e.property_id, p.code, to_char(e.occurred_at at time zone 'America/Argentina/Salta', 'YYYY-MM-DD') as day, e.props->>'topic' as topic
        from site_session_links s
        join site_events e on e.session_key = s.session_key
        left join properties p on p.id = e.property_id
       where s.contact_id = ${contactId}
         and e.name in ('property_viewed', 'virtual_tour_opened', 'property_qa_asked', 'property_compared')
         and e.occurred_at > now() - interval '13 months'
       order by e.occurred_at desc
       limit 2000`.execute(db),
    sql<{ property_id: string; code: number; day: string }>`
      select l.property_id, p.code, to_char(l.created_at at time zone 'America/Argentina/Salta', 'YYYY-MM-DD') as day
        from leads l join properties p on p.id = l.property_id
       where l.contact_id = ${contactId} and l.deleted_at is null`.execute(db),
    sql<{ property_id: string | null; code: number | null; at: Date }>`
      select (a.metadata->>'propertyId')::uuid as property_id, p.code, a.occurred_at as at
        from activities a left join properties p on p.id = (a.metadata->>'propertyId')::uuid
       where a.entity_type = 'contact' and a.entity_id = ${contactId} and a.kind = 'visit_requested'
       order by a.occurred_at desc limit 20`.execute(db),
  ]);
  const compareSessions = new Set<string>();
  const facts: SignalFacts = { propertyDays: [], tours: [], qa: [], compared: 0, visitRequests: visits.rows.map((v) => ({ propertyId: v.property_id, code: v.code, at: v.at })) };
  for (const e of events.rows) {
    if (e.name === "property_viewed" && e.property_id && e.code) facts.propertyDays.push({ propertyId: e.property_id, code: e.code, day: e.day });
    else if (e.name === "virtual_tour_opened" && e.property_id && e.code) facts.tours.push({ propertyId: e.property_id, code: e.code });
    else if (e.name === "property_qa_asked") facts.qa.push({ propertyId: e.property_id, code: e.code, topic: e.topic ?? "unknown" });
    else if (e.name === "property_compared") compareSessions.add(`${e.day}`);
  }
  facts.compared = compareSessions.size;
  for (const l of leads.rows) facts.propertyDays.push({ propertyId: l.property_id, code: l.code, day: l.day });
  return facts;
}

export async function getIntentSignals(db: Executor, actor: Actor, contactId: string) {
  await loadSalesContact(db, actor, contactId);
  const [facts, linked] = await Promise.all([loadSignalFacts(db, contactId), db.selectFrom("site_session_links").select(sql<number>`count(*)::int`.as("n")).where("contact_id", "=", contactId).executeTakeFirstOrThrow()]);
  return { ...computeIntentSignals(facts), linkedSessions: linked.n };
}
