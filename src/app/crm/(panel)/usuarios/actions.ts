"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { revalidatePublicSiteInRequest } from "@/server/site/revalidate";
import { inviteUser, inviteUserSchema, resendInvite, setUserActive, setUserBranches, setUserRoles, updateUserProfile, updateUserProfileSchema } from "@/server/users/service";

const id = z.uuid();

export async function inviteUserAction(input: unknown) {
  return runAction("users.invite", inviteUserSchema, input, async (d, actor) => {
    const r = await inviteUser(getDb(), actor, d);
    // El link NO vuelve al navegador: solo lo recibe la persona invitada por email.
    return { id: r.userId, emailQueued: r.emailQueued };
  });
}

export async function updateUserProfileAction(userId: string, input: unknown) {
  const r = await runAction("users.update", updateUserProfileSchema, input, (d, actor) => updateUserProfile(getDb(), actor, userId, d));
  if (r.ok) {
    refresh();
    revalidatePublicSiteInRequest(); // nombre y WhatsApp del asesor se muestran en las fichas
  }
  return r;
}

export async function setUserRolesAction(userId: string, roles: string[]) {
  const r = await runAction("users.roles", z.object({ id, roles: z.array(z.string().max(40)).max(10) }), { id: userId, roles }, (d, actor) => setUserRoles(getDb(), actor, d.id, d.roles));
  if (r.ok) refresh();
  return r;
}

export async function setUserBranchesAction(userId: string, branchIds: string[]) {
  const r = await runAction("users.branches", z.object({ id, branchIds: z.array(id).max(50) }), { id: userId, branchIds }, (d, actor) => setUserBranches(getDb(), actor, d.id, d.branchIds));
  if (r.ok) refresh();
  return r;
}

export async function setUserActiveAction(userId: string, active: boolean) {
  const r = await runAction("users.active", z.object({ id, active: z.boolean() }), { id: userId, active }, (d, actor) => setUserActive(getDb(), actor, d.id, d.active));
  if (r.ok) {
    refresh();
    revalidatePublicSiteInRequest(); // nombre y WhatsApp del asesor se muestran en las fichas
  }
  return r;
}

export async function resendInviteAction(userId: string) {
  const r = await runAction("users.resend_invite", id, userId, (d, actor) => resendInvite(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}
