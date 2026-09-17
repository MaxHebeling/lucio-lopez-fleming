"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { revalidatePublicSiteInRequest } from "@/server/site/revalidate";
import {
  addHotspot,
  createTour,
  deleteHotspot,
  deleteScene,
  deleteTour,
  publishTour,
  removeFloorPlan,
  reorderScenes,
  unpublishTour,
  updateExternalTour,
  updateHotspot,
  updateScene,
  updateTourSettings,
} from "@/server/tours/service";

/** Toda acción del editor refresca la vista e invalida el sitio (un tour publicado puede haber cambiado). */
function done<T extends { ok: boolean }>(r: T): T {
  if (r.ok) {
    refresh();
    revalidatePublicSiteInRequest();
  }
  return r;
}

const id = z.uuid();
const anyInput = z.unknown();

export async function createTourAction(propertyId: string, input: unknown) {
  return done(await runAction("tours.create", z.object({ id, input: anyInput }), { id: propertyId, input }, (d, actor) => createTour(getDb(), actor, d.id, d.input)));
}
export async function updateExternalTourAction(tourId: string, input: unknown) {
  return done(await runAction("tours.update_external", z.object({ id, input: anyInput }), { id: tourId, input }, (d, actor) => updateExternalTour(getDb(), actor, d.id, d.input)));
}
export async function deleteTourAction(tourId: string) {
  return done(await runAction("tours.delete", id, tourId, (d, actor) => deleteTour(getDb(), actor, d)));
}
export async function publishTourAction(tourId: string) {
  return done(await runAction("tours.publish", id, tourId, (d, actor) => publishTour(getDb(), actor, d)));
}
export async function unpublishTourAction(tourId: string) {
  return done(await runAction("tours.unpublish", id, tourId, (d, actor) => unpublishTour(getDb(), actor, d)));
}
export async function updateTourSettingsAction(tourId: string, input: unknown) {
  return done(await runAction("tours.settings", z.object({ id, input: anyInput }), { id: tourId, input }, (d, actor) => updateTourSettings(getDb(), actor, d.id, d.input)));
}
export async function updateSceneAction(sceneId: string, input: unknown) {
  return done(await runAction("tours.scene_update", z.object({ id, input: anyInput }), { id: sceneId, input }, (d, actor) => updateScene(getDb(), actor, d.id, d.input)));
}
export async function reorderScenesAction(tourId: string, ids: string[]) {
  return done(await runAction("tours.scenes_reorder", z.object({ id, ids: z.array(id).max(60) }), { id: tourId, ids }, (d, actor) => reorderScenes(getDb(), actor, d.id, d.ids)));
}
export async function deleteSceneAction(sceneId: string) {
  return done(await runAction("tours.scene_delete", id, sceneId, (d, actor) => deleteScene(getDb(), actor, d)));
}
export async function addHotspotAction(sceneId: string, input: unknown) {
  return done(await runAction("tours.hotspot_add", z.object({ id, input: anyInput }), { id: sceneId, input }, (d, actor) => addHotspot(getDb(), actor, d.id, d.input)));
}
export async function updateHotspotAction(hotspotId: string, input: unknown) {
  return done(await runAction("tours.hotspot_update", z.object({ id, input: anyInput }), { id: hotspotId, input }, (d, actor) => updateHotspot(getDb(), actor, d.id, d.input)));
}
export async function deleteHotspotAction(hotspotId: string) {
  return done(await runAction("tours.hotspot_delete", id, hotspotId, (d, actor) => deleteHotspot(getDb(), actor, d)));
}
export async function removeFloorPlanAction(tourId: string) {
  return done(await runAction("tours.floor_plan_remove", id, tourId, (d, actor) => removeFloorPlan(getDb(), actor, d)));
}
