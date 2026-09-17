"use client";

/**
 * Link temporal del cliente. El token se muestra UNA vez (en la base solo queda su hash): si se pierde, se rota.
 * Compartir es siempre una acción humana (copiar, WhatsApp con texto, menú de compartir del teléfono).
 */
import { useState } from "react";
import { Alert, Button, formatDateTime } from "@/components/ui";
import { useAction } from "@/components/crm/use-action";
import { clientLinkShareText } from "@/server/visits/rules";
import { createClientLinkAction, revokeClientLinkAction, rotateClientLinkAction } from "@/app/crm/(panel)/mis-visitas/actions";
import { CopyButton } from "./copy-button";

type ActiveLink = { createdAt: string; lastOpenedAt: string | null; openCount: number; expiresAt: string; expired: boolean } | null;

export function ClientLinkPanel({
  appointmentId,
  active,
  terminal,
  canManage,
  clientFirstName,
  clientWhatsappE164,
}: {
  appointmentId: string;
  active: ActiveLink;
  terminal: boolean;
  canManage: boolean;
  clientFirstName: string | null;
  clientWhatsappE164: string | null;
}) {
  const create = useAction(createClientLinkAction);
  const rotate = useAction(rotateClientLinkAction);
  const revoke = useAction(revokeClientLinkAction);
  const [url, setUrl] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "rotate" | "revoke">(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const error = create.error ?? rotate.error ?? revoke.error ?? shareError;

  const shareText = url ? clientLinkShareText({ clientFirstName, url }) : "";
  const waUrl = url ? `https://wa.me/${clientWhatsappE164 ? clientWhatsappE164.replace(/\D/g, "") : ""}?text=${encodeURIComponent(shareText)}` : null;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-stone">
        El cliente ve el estado de la visita (programada, en camino, llegada confirmada, en curso) sin tu ubicación. Al terminar ve solo el cierre y, si lo preparás, tu agradecimiento.
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {url ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-success/30 bg-[#eef6f0] p-3">
          <p className="font-semibold text-success">Link listo. Compartilo ahora: por seguridad no se vuelve a mostrar.</p>
          <label htmlFor="client-link-url" className="sr-only">
            Link del cliente
          </label>
          <input id="client-link-url" readOnly value={url} className="h-10 w-full rounded-[var(--radius-md)] border border-line bg-white px-3 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <div className="grid gap-2 sm:grid-cols-3">
            <CopyButton text={url} label="Copiar link" className="h-11" />
            {waUrl ? (
              <a href={waUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink-2">
                Enviar por WhatsApp
              </a>
            ) : null}
            {typeof navigator !== "undefined" && "share" in navigator ? (
              <Button
                variant="secondary"
                className="h-11"
                onClick={() =>
                  navigator.share({ title: "Tu visita", text: shareText }).catch((e: unknown) => {
                    // Cerrar el menú de compartir no es un error; cualquier otra falla se informa.
                    if (!(e instanceof DOMException && e.name === "AbortError")) setShareError("No se pudo abrir el menú de compartir: copiá el link.");
                  })
                }
              >
                Compartir…
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {active && !url ? (
        <dl className="grid grid-cols-2 gap-2 rounded-[var(--radius-md)] border border-line bg-paper p-3">
          <div>
            <dt className="text-xs text-stone">Estado</dt>
            <dd className="font-semibold">{active.expired ? "Vencido" : "Activo"}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone">Aperturas</dt>
            <dd className="font-semibold">{active.openCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone">Última apertura</dt>
            <dd>{active.lastOpenedAt ? formatDateTime(active.lastOpenedAt) : "Todavía no lo abrió"}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone">{active.expired ? "Venció" : "Vence"}</dt>
            <dd>{formatDateTime(active.expiresAt)}</dd>
          </div>
        </dl>
      ) : null}

      {canManage ? (
        confirm ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-line bg-white p-3">
            <p className="font-semibold">{confirm === "rotate" ? "El link anterior deja de funcionar en el acto. ¿Generar uno nuevo?" : "El cliente ya no va a poder abrir el link. ¿Revocarlo?"}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" className="h-11" onClick={() => setConfirm(null)}>
                Volver
              </Button>
              <Button
                variant={confirm === "revoke" ? "danger" : "primary"}
                className="h-11"
                disabled={rotate.pending || revoke.pending}
                onClick={() => {
                  if (confirm === "rotate")
                    void rotate.run({ appointmentId }).then((r) => {
                      if (r.ok) setUrl(r.data.url);
                      setConfirm(null);
                    });
                  else
                    void revoke.run({ appointmentId }).then(() => {
                      setUrl(null);
                      setConfirm(null);
                    });
                }}
              >
                {confirm === "rotate" ? (rotate.pending ? "Rotando…" : "Sí, rotar") : revoke.pending ? "Revocando…" : "Sí, revocar"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {!active && !terminal ? (
              <Button className="h-11" disabled={create.pending} aria-busy={create.pending} onClick={() => void create.run({ appointmentId }).then((r) => r.ok && setUrl(r.data.url))}>
                {create.pending ? "Generando…" : "Generar link para el cliente"}
              </Button>
            ) : null}
            {active && !terminal ? (
              <Button variant="secondary" className="h-11" onClick={() => setConfirm("rotate")}>
                {url ? "Rotar link" : "Generar link nuevo (rotar)"}
              </Button>
            ) : null}
            {active ? (
              <Button variant="ghost" className="h-11" onClick={() => setConfirm("revoke")}>
                Revocar link
              </Button>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
