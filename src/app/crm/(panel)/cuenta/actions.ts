"use server";

import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { changeOwnPassword, changeOwnPasswordSchema } from "@/server/account/password";

export async function changePasswordAction(input: unknown) {
  return runAction("account.change_password", changeOwnPasswordSchema, input, (d, actor) => changeOwnPassword(getDb(), actor, d));
}
