"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { searchContacts, searchProperties } from "@/server/crm/lookups";
import { logOutreach, outreachSchema } from "@/server/activities/outreach";
import { addNote, addNoteSchema } from "@/server/notes/service";

const STATUS: Record<string, string> = { draft: "Borrador", available: "Disponible", reserved: "Reservada", sold: "Vendida", rented: "Alquilada", paused: "Pausada", archived: "Archivada" };

export async function searchPropertiesAction(q: string) {
  return runAction("crm.search_properties", z.string().max(100), q, async (term, actor) => {
    const rows = await searchProperties(getDb(), actor, term);
    return rows.map((p) => ({ id: p.id, label: `${p.code} · ${p.title}`, sublabel: [p.address, STATUS[p.status] ?? p.status].filter(Boolean).join(" · ") }));
  });
}

export async function searchContactsAction(q: string) {
  return runAction("crm.search_contacts", z.string().max(100), q, async (term, actor) => {
    const rows = await searchContacts(getDb(), actor, term);
    return rows.map((c) => ({ id: c.id, label: c.displayName, sublabel: [c.phone, c.email].filter(Boolean).join(" · ") || null }));
  });
}

export async function logOutreachAction(input: z.input<typeof outreachSchema>) {
  return runAction("crm.log_outreach", outreachSchema, input, (data, actor) => logOutreach(getDb(), actor, data));
}

export async function addNoteAction(fd: FormData) {
  const r = await runAction(
    "crm.add_note",
    addNoteSchema,
    { entityType: fd.get("entityType"), entityId: fd.get("entityId"), body: fd.get("body") ?? "", idempotencyKey: fd.get("idempotencyKey") },
    (data, actor) => addNote(getDb(), actor, data),
  );
  if (r.ok) refresh();
  return r;
}
