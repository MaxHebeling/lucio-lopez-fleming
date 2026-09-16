import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { computeSignature, verifySignature, verifySubscription } from "@/server/integrations/whatsapp/signature";
import { parseWebhook } from "@/server/integrations/whatsapp/payload";
import { buildMessageBody, toApiError } from "@/server/integrations/whatsapp/client";
import { isWindowOpen, reengagementTemplate, whatsappSendConfig } from "@/server/integrations/whatsapp/config";
import { addCustomerText, emptyFacts, findViolations, parseArgentineNumber } from "@/server/ai/guards";
import { detectHandoff } from "@/server/ai/whatsapp/rules";
import { estimateCostMicros, priceFor } from "@/server/ai/pricing";
import { buildHistory, parseAssistantOutput } from "@/server/ai/whatsapp/agent";
import { inboundTextPayload, statusPayload } from "../helpers/whatsapp";

describe("firma y verificación del webhook de Meta", () => {
  const secret = "s3cr3t";
  const body = '{"object":"whatsapp_business_account","entry":[]}';

  it("acepta la firma HMAC SHA-256 correcta del cuerpo crudo", () => {
    expect(verifySignature(body, computeSignature(body, secret), secret)).toBe(true);
    expect(verifySignature(body, computeSignature(body, secret).toUpperCase().replace("SHA256=", "sha256="), secret)).toBe(true);
  });

  it("rechaza firma ausente, mal formada, de otro secreto o de un cuerpo alterado", () => {
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha1=abc", secret)).toBe(false);
    expect(verifySignature(body, computeSignature(body, "otro"), secret)).toBe(false);
    expect(verifySignature(`${body} `, computeSignature(body, secret), secret)).toBe(false);
    expect(verifySignature(body, computeSignature(body, secret), "")).toBe(false);
  });

  it("verificación GET: modo subscribe + token exacto devuelve el challenge", () => {
    const ok = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "12345" });
    expect(verifySubscription(ok, "tok")).toEqual({ ok: true, challenge: "12345" });
    expect(verifySubscription(ok, "otro")).toEqual({ ok: false, reason: "invalid" });
    expect(verifySubscription(ok, undefined)).toEqual({ ok: false, reason: "not_configured" });
    const badChallenge = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "<script>" });
    expect(verifySubscription(badChallenge, "tok").ok).toBe(false);
  });
});

describe("parser del webhook", () => {
  it("separa mensajes y estados con ids externos estables", () => {
    const msg = inboundTextPayload({ waId: "5493875551111", text: "Hola", wamid: "wamid.A" });
    const r = parseWebhook(msg.body);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ kind: "message", externalEventId: "message:wamid.A", waId: "5493875551111", text: "Hola", profileName: "Cliente Prueba", messageKind: "text" });

    const st = parseWebhook(statusPayload({ wamid: "wamid.B", status: "failed", recipient: "549387", errors: [{ code: 131047, title: "Re-engagement message" }] }));
    expect(st.ok && st.events[0]).toMatchObject({ kind: "status", externalEventId: "status:wamid.B:failed", status: "failed", error: { code: "131047" } });
  });

  it("tipos no soportados y objetos ajenos", () => {
    const audio = inboundTextPayload({ waId: "5493875551111", text: "", type: "audio", extra: { audio: { id: "x" } } });
    const r = parseWebhook(audio.body);
    expect(r.ok && r.events[0]).toMatchObject({ messageKind: "audio", text: null });
    expect(parseWebhook({ object: "page", entry: [] }).ok).toBe(false);
    expect(parseWebhook({ foo: 1 }).ok).toBe(false);
  });
});

describe("cliente de WhatsApp (puro)", () => {
  it("arma el cuerpo de texto y plantilla según la API", () => {
    expect(buildMessageBody({ type: "text", to: "+54 9 387 555-1111", body: "Hola" })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5493875551111",
      type: "text",
      text: { preview_url: true, body: "Hola" },
    });
    expect(buildMessageBody({ type: "template", to: "549", name: "retomar", language: "es_AR" })).toMatchObject({ type: "template", template: { name: "retomar", language: { code: "es_AR" } } });
  });

  it("clasifica errores de Meta (ventana 24 h, reintentables, permanentes)", () => {
    const window = toApiError(400, { error: { code: 131047, message: "Re-engagement message" } });
    expect(window.windowExpired).toBe(true);
    expect(window.retryable).toBe(false);
    expect(toApiError(429, { error: { code: 130429 } }).retryable).toBe(true);
    expect(toApiError(401, { error: { code: 190, message: "token expired" } }).retryable).toBe(false);
    expect(toApiError(502, null).retryable).toBe(true);
  });

  it("configuración desde entorno sin secretos por defecto", () => {
    expect(whatsappSendConfig({} as NodeJS.ProcessEnv)).toEqual({ config: null, missing: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"] });
    expect(whatsappSendConfig({ WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1" } as NodeJS.ProcessEnv).config?.graphVersion).toBe("v26.0");
    expect(reengagementTemplate({} as NodeJS.ProcessEnv)).toBeNull();
    expect(reengagementTemplate({ WHATSAPP_REENGAGEMENT_TEMPLATE: "retomar_consulta" } as NodeJS.ProcessEnv)).toEqual({ name: "retomar_consulta", language: "es_AR" });
    expect(isWindowOpen(new Date(Date.now() - 23 * 3600_000))).toBe(true);
    expect(isWindowOpen(new Date(Date.now() - 25 * 3600_000))).toBe(false);
    expect(isWindowOpen(null)).toBe(false);
  });
});

describe("guardas contra datos inventados", () => {
  const facts = () => {
    const f = emptyFacts();
    f.propertyCodes.add(3021);
    f.amounts.add(230000);
    f.areas.add(180);
    f.urls.add("https://www.example.test/propiedades/casa-tres-cerritos-3021");
    return f;
  };

  it("números argentinos", () => {
    expect(parseArgentineNumber("230.000")).toBe(230000);
    expect(parseArgentineNumber("1.200.000,50")).toBe(1200000.5);
    expect(parseArgentineNumber("1,5")).toBe(1.5);
    expect(parseArgentineNumber("230,000")).toBe(230000);
  });

  it("una respuesta con datos de las herramientas pasa", () => {
    const reply = "Tenemos la casa código 3021 en venta a USD 230.000, 180 m². Mirala acá: https://www.example.test/propiedades/casa-tres-cerritos-3021";
    expect(findViolations(reply, facts())).toEqual([]);
    expect(findViolations("Sale U$S 230 mil", facts())).toEqual([]);
  });

  it("un precio, código, superficie, porcentaje o link inventado se detecta", () => {
    expect(findViolations("La casa cuesta USD 250.000", facts())).toEqual([{ kind: "amount", value: "250000" }]);
    expect(findViolations("También está la #4410", facts()).map((v) => v.kind)).toEqual(["property_code"]);
    expect(findViolations("Tiene 200 m2 cubiertos", facts()).map((v) => v.kind)).toEqual(["area"]);
    expect(findViolations("La comisión es del 3%", facts()).map((v) => v.kind)).toEqual(["percentage"]);
    expect(findViolations("Mirá https://otro.sitio/x", facts()).map((v) => v.kind)).toEqual(["url"]);
    expect(findViolations("Las expensas son 85.000", facts()).map((v) => v.kind)).toEqual(["amount"]);
    expect(findViolations("Llamanos al 387 421-4143", facts()).map((v) => v.kind)).toEqual(["phone"]);
    expect(findViolations("Precio: 120 mil dólares", facts())).toEqual([{ kind: "amount", value: "120000" }]);
  });

  it("montos que dijo el propio cliente se pueden repetir", () => {
    const f = facts();
    addCustomerText(f, "tengo un presupuesto de 150 mil");
    expect(findViolations("Anotado: presupuesto de USD 150.000", f)).toEqual([]);
  });
});

describe("reglas de derivación previas a la IA", () => {
  it.each([
    ["quiero hablar con una persona", "customer_request"],
    ["Me pasás con un asesor?", "customer_request"],
    ["Ofrezco 200 mil", "negotiation"],
    ["¿Es negociable el precio?", "negotiation"],
    ["Quiero dejar una seña", "reservation"],
    ["Quiero hacer un reclamo", "complaint"],
    ["Les mando la escritura", "documents"],
    ["La quiero, ¿cómo avanzo?", "closing_intent"],
  ])("%s → %s", (text, reason) => {
    expect(detectHandoff(text)).toBe(reason);
  });

  it("consultas normales no derivan", () => {
    expect(detectHandoff("Hola, busco una casa de 3 dormitorios en Tres Cerritos")).toBeNull();
    expect(detectHandoff("¿Qué departamentos tienen en alquiler?")).toBeNull();
  });
});

describe("costo y salida del modelo", () => {
  it("costo por modelo en micro-dólares y precio conservador para modelos desconocidos", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 100_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    expect(estimateCostMicros("claude-sonnet-5", usage)).toBe(3_000_000);
    expect(priceFor("claude-sonnet-5-20260101").known).toBe(true);
    expect(priceFor("modelo-nuevo").known).toBe(false);
    expect(estimateCostMicros("modelo-nuevo", usage)).toBe(15_000_000);
  });

  it("valida la salida JSON con zod", () => {
    const msg = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn" }) as unknown as Anthropic.Message;
    expect(parseAssistantOutput(msg('{"reply":"Hola","confidence":"high","handoff":false,"handoff_reason":"none","summary":"s"}')).ok).toBe(true);
    expect(parseAssistantOutput(msg("Hola, ¿cómo estás?")).ok).toBe(false);
    expect(parseAssistantOutput(msg('{"reply":"","confidence":"high","handoff":false,"handoff_reason":"none","summary":""}')).ok).toBe(false);
    expect(parseAssistantOutput(msg('{"reply":"x","confidence":"maybe","handoff":false,"handoff_reason":"none","summary":""}')).ok).toBe(false);
  });

  it("historial alternado que empieza y termina con el cliente", () => {
    const h = buildHistory([
      { direction: "outbound", body: "plantilla", kind: "template" },
      { direction: "inbound", body: "Hola", kind: "text" },
      { direction: "inbound", body: "busco casa", kind: "text" },
      { direction: "outbound", body: "¿En qué zona?", kind: "text" },
      { direction: "inbound", body: null, kind: "image" },
    ]);
    expect(h.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(h[0]!.content).toBe("Hola\nbusco casa");
    expect(String(h[2]!.content)).toContain("image");
  });
});
