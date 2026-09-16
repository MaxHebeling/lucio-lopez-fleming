"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction, type ActionResult } from "@/server/next/action";
import {
  closeConversation,
  replyAsHuman,
  replySchema,
  retryOutboundMessage,
  returnToBot,
  sendReengagementTemplate,
  takeConversation,
} from "@/server/conversations/service";

export type ConversationActionState = ActionResult<unknown> | null;

const idSchema = z.object({ conversationId: z.uuid() });
const messageSchema = z.object({ messageId: z.uuid() });
const templateSchema = z.object({ conversationId: z.uuid(), idempotencyKey: z.string().min(8).max(100) });

function field(fd: FormData, name: string): string | undefined {
  const v = fd.get(name);
  return typeof v === "string" ? v : undefined;
}

async function done<T>(r: ActionResult<T>): Promise<ActionResult<T>> {
  if (r.ok) refresh();
  return r;
}

export async function replyAction(_prev: ConversationActionState, fd: FormData): Promise<ConversationActionState> {
  return done(
    await runAction("conversations.reply", replySchema, { conversationId: field(fd, "conversationId"), body: field(fd, "body"), idempotencyKey: field(fd, "idempotencyKey") }, (data, actor) =>
      replyAsHuman(getDb(), actor, data),
    ),
  );
}

export async function takeAction(_prev: ConversationActionState, fd: FormData): Promise<ConversationActionState> {
  return done(await runAction("conversations.take", idSchema, { conversationId: field(fd, "conversationId") }, (d, actor) => takeConversation(getDb(), actor, d.conversationId)));
}

export async function returnToBotAction(_prev: ConversationActionState, fd: FormData): Promise<ConversationActionState> {
  return done(await runAction("conversations.return_to_bot", idSchema, { conversationId: field(fd, "conversationId") }, (d, actor) => returnToBot(getDb(), actor, d.conversationId)));
}

export async function closeAction(_prev: ConversationActionState, fd: FormData): Promise<ConversationActionState> {
  return done(await runAction("conversations.close", idSchema, { conversationId: field(fd, "conversationId") }, (d, actor) => closeConversation(getDb(), actor, d.conversationId)));
}

export async function retryMessageAction(_prev: ConversationActionState, fd: FormData): Promise<ConversationActionState> {
  return done(await runAction("conversations.retry_message", messageSchema, { messageId: field(fd, "messageId") }, (d, actor) => retryOutboundMessage(getDb(), actor, d.messageId)));
}

export async function templateAction(_prev: ConversationActionState, fd: FormData): Promise<ConversationActionState> {
  return done(
    await runAction("conversations.template", templateSchema, { conversationId: field(fd, "conversationId"), idempotencyKey: field(fd, "idempotencyKey") }, (d, actor) =>
      sendReengagementTemplate(getDb(), actor, d.conversationId, d.idempotencyKey),
    ),
  );
}
