"use server";

import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import {
  approvePost,
  assetsSchema,
  captionSchema,
  idSchema,
  rejectPost,
  rejectSchema,
  schedulePost,
  scheduleSchema,
  setPostAssets,
  unschedulePost,
  updatePostCaption,
} from "@/server/marketing/service";
import { formatDateTime } from "@/components/ui/format";
import type { InlineActionState } from "@/components/crm/inline-action";

type Result = { ok: true; data: unknown } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function done(r: Result, message: string): InlineActionState {
  if (!r.ok) return { ok: false, error: r.fieldErrors ? Object.values(r.fieldErrors).flat()[0] ?? r.error : r.error, fieldErrors: r.fieldErrors };
  refresh();
  return { ok: true, message };
}

export async function saveCaptionAction(_prev: InlineActionState, fd: FormData): Promise<InlineActionState> {
  const r = await runAction("marketing.caption", captionSchema, { postId: fd.get("postId"), caption: fd.get("caption") }, (d, actor) => updatePostCaption(getDb(), actor, d));
  return done(r, "Texto guardado");
}

export async function saveAssetsAction(_prev: InlineActionState, fd: FormData): Promise<InlineActionState> {
  const r = await runAction("marketing.assets", assetsSchema, { postId: fd.get("postId"), mediaIds: fd.getAll("mediaIds") }, (d, actor) => setPostAssets(getDb(), actor, d));
  return done(r, "Fotos guardadas");
}

export async function approveAction(_prev: InlineActionState, fd: FormData): Promise<InlineActionState> {
  const r = await runAction("marketing.approve", idSchema, { postId: fd.get("postId") }, (d, actor) => approvePost(getDb(), actor, d));
  return done(r, "Aprobada");
}

export async function rejectAction(_prev: InlineActionState, fd: FormData): Promise<InlineActionState> {
  const r = await runAction("marketing.reject", rejectSchema, { postId: fd.get("postId"), reason: fd.get("reason") }, (d, actor) => rejectPost(getDb(), actor, d));
  return done(r, "Rechazada");
}

export async function scheduleAction(_prev: InlineActionState, fd: FormData): Promise<InlineActionState> {
  let when = "";
  const r = await runAction("marketing.schedule", scheduleSchema, { postId: fd.get("postId"), localDateTime: fd.get("localDateTime") }, async (d, actor) => {
    const res = await schedulePost(getDb(), actor, d);
    when = formatDateTime(res.scheduledAt);
    return res;
  });
  return done(r, `Programada para ${when} (hora de Salta)`);
}

export async function unscheduleAction(_prev: InlineActionState, fd: FormData): Promise<InlineActionState> {
  const r = await runAction("marketing.unschedule", idSchema, { postId: fd.get("postId") }, (d, actor) => unschedulePost(getDb(), actor, d));
  return done(r, "Programación cancelada");
}
