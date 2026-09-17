"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import {
  checkIn,
  checkInSchema,
  createClientLink,
  createVisitFollowUp,
  finishVisit,
  followUpSchema,
  locationProblemSchema,
  markEnRoute,
  markThanksSent,
  reassignSchema,
  reassignVisit,
  reportLocationProblem,
  reportSchema,
  revokeClientLink,
  rotateClientLink,
  saveThanks,
  saveVisitReport,
  startVisit,
  thanksSchema,
  thanksSentSchema,
  visitIdSchema,
  type CreatedClientLink,
} from "@/server/visits/service";

type IdInput = z.input<typeof visitIdSchema>;

function appUrl(path: string): string {
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

/** El token viaja una sola vez, a quien generó el link. No se loguea ni se guarda en claro. */
const linkResult = (l: CreatedClientLink) => ({ url: appUrl(l.path) });

export async function enRouteAction(input: IdInput) {
  const r = await runAction("visits.en_route", visitIdSchema, input, (d, actor) => markEnRoute(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function checkInAction(input: z.input<typeof checkInSchema>) {
  const r = await runAction("visits.check_in", checkInSchema, input, (d, actor) => checkIn(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function locationProblemAction(input: z.input<typeof locationProblemSchema>) {
  const r = await runAction("visits.location_problem", locationProblemSchema, input, (d, actor) => reportLocationProblem(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function startVisitAction(input: IdInput) {
  const r = await runAction("visits.start", visitIdSchema, input, (d, actor) => startVisit(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function finishVisitAction(input: IdInput) {
  const r = await runAction("visits.finish", visitIdSchema, input, (d, actor) => finishVisit(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function createClientLinkAction(input: IdInput) {
  const r = await runAction("visits.client_link.create", visitIdSchema, input, async (d, actor) => linkResult(await createClientLink(getDb(), actor, d)));
  if (r.ok) refresh();
  return r;
}

export async function rotateClientLinkAction(input: IdInput) {
  const r = await runAction("visits.client_link.rotate", visitIdSchema, input, async (d, actor) => linkResult(await rotateClientLink(getDb(), actor, d)));
  if (r.ok) refresh();
  return r;
}

export async function revokeClientLinkAction(input: IdInput) {
  const r = await runAction("visits.client_link.revoke", visitIdSchema, input, (d, actor) => revokeClientLink(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function saveReportAction(input: z.input<typeof reportSchema>) {
  const r = await runAction("visits.report.save", reportSchema, input, (d, actor) => saveVisitReport(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function createFollowUpAction(input: z.input<typeof followUpSchema>) {
  const r = await runAction("visits.followup.create", followUpSchema, input, (d, actor) => createVisitFollowUp(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function saveThanksAction(input: z.input<typeof thanksSchema>) {
  const r = await runAction("visits.thanks.save", thanksSchema, input, (d, actor) => saveThanks(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function markThanksSentAction(input: z.input<typeof thanksSentSchema>) {
  const r = await runAction("visits.thanks.sent", thanksSentSchema, input, (d, actor) => markThanksSent(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function reassignVisitAction(input: z.input<typeof reassignSchema>) {
  const r = await runAction("visits.reassign", reassignSchema, input, (d, actor) => reassignVisit(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}
