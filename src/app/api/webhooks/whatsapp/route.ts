import { after, NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { clientIpFromHeaders } from "@/server/auth/ip";
import { errorFields, log } from "@/server/log";
import { runJobs } from "@/server/jobs/runner";
import { markAwaitingCredentials } from "@/server/integrations/credentials";
import { WHATSAPP_INTEGRATION_KEY } from "@/server/integrations/whatsapp/config";
import { verifySubscription } from "@/server/integrations/whatsapp/signature";
import { ingestWhatsAppWebhook, MAX_WEBHOOK_BYTES } from "@/server/integrations/whatsapp/inbound";
import "@/server/jobs/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Verificación del webhook desde el panel de Meta (hub.mode / hub.verify_token / hub.challenge). */
export const GET = apiRoute("webhooks.whatsapp.verify", async (req: NextRequest) => {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  const result = verifySubscription(req.nextUrl.searchParams, expected);
  if (result.ok) return new NextResponse(result.challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  if (result.reason === "not_configured") {
    await markAwaitingCredentials(getDb(), WHATSAPP_INTEGRATION_KEY, ["WHATSAPP_VERIFY_TOKEN"]);
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
});

/**
 * Eventos de WhatsApp. Se lee el cuerpo crudo (la firma se calcula sobre los bytes exactos), se guarda cada evento
 * y se responde enseguida. El procesamiento corre en la cola; `after` la empuja para no esperar al cron.
 */
export const POST = apiRoute("webhooks.whatsapp.events", async (req: NextRequest) => {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const rawBody = await req.text();
  const db = getDb();
  const result = await ingestWhatsAppWebhook(db, {
    rawBody,
    signature: req.headers.get("x-hub-signature-256"),
    ip: clientIpFromHeaders((n) => req.headers.get(n)),
  });
  if (result.newEvents > 0) {
    after(async () => {
      try {
        await runJobs(db, { budgetMs: 40_000, batch: 5 });
      } catch (e) {
        log.error("whatsapp.after_run_jobs_failed", errorFields(e));
      }
    });
  }
  return NextResponse.json(result.body, { status: result.status });
});
