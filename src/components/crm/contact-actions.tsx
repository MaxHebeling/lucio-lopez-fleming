"use client";

import { useTransition } from "react";
import { buttonClass } from "@/components/ui";
import type { ClientActionResult } from "./action-form";
import { telHref, waHref } from "./phone-links";

type Phone = { phone_e164: string | null; phone_raw: string; is_whatsapp: boolean };

/**
 * Llamar / WhatsApp: el enlace abre el teléfono o WhatsApp del agente y además registra la actividad en el CRM.
 * El registro no bloquea la navegación.
 */
export function ContactButtons({
  phone,
  entityType,
  entityId,
  log,
  size = "sm",
}: {
  phone: Phone | null | undefined;
  entityType: "contact" | "lead";
  entityId: string;
  log: (input: { entityType: "contact" | "lead"; entityId: string; channel: "call" | "whatsapp" }) => Promise<ClientActionResult<unknown>>;
  size?: "sm" | "md";
}) {
  const [, start] = useTransition();
  if (!phone) return <span className="text-sm text-stone">Sin teléfono cargado</span>;
  const wa = waHref(phone);
  const fire = (channel: "call" | "whatsapp") =>
    start(async () => {
      await log({ entityType, entityId, channel });
    });
  return (
    <div className="flex flex-wrap gap-2">
      <a href={telHref(phone)} onClick={() => fire("call")} className={buttonClass("primary", size)}>
        Llamar
      </a>
      {wa ? (
        <a href={wa} target="_blank" rel="noopener noreferrer" onClick={() => fire("whatsapp")} className={buttonClass("secondary", size)}>
          WhatsApp
        </a>
      ) : null}
    </div>
  );
}
