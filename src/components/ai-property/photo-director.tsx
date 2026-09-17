"use client";

/**
 * AI Photo Director en la pestaña Multimedia: etiqueta de ambiente por foto (manual; sugerencias de IA a aceptar),
 * avisos de calidad por foto y orden/portada sugeridos con «Aplicar orden sugerido» (confirmación + auditoría).
 */
import Image from "next/image";
import { useId, useState } from "react";
import { Alert, Badge, Button, Select } from "@/components/ui";
import { useAction } from "@/components/crm/use-action";
import type { SuggestedOrder } from "@/server/ai/property/photo-order";
import { ROOM_KEYS, ROOM_LABEL, type RoomKey } from "@/server/ai/property/rooms";
import { applySuggestedOrderAction, requestRoomSuggestionsAction, reviewRoomSuggestionsAction, setMediaRoomAction } from "@/app/crm/(panel)/propiedades/[id]/ai-actions";

export type DirectorItem = {
  room: RoomKey | null;
  roomSource: "manual" | "ai_accepted" | null;
  suggestion: { room: RoomKey; confidence: number } | null;
  stored: boolean;
  dark: boolean;
  blurry: boolean;
  duplicateOf: string | null;
};

export type DirectorData = {
  items: Record<string, DirectorItem>;
  suggestion: SuggestedOrder;
  pendingSuggestions: number;
  visionCandidates: number;
  aiAvailable: boolean;
  visionJobQueued: boolean;
};

type Preview = { id: string; kind: string; alt: string; src: string | null; optimize: boolean };

export function RoomTagger({ propertyId, mediaId, item, canManage, position }: { propertyId: string; mediaId: string; item: DirectorItem | undefined; canManage: boolean; position: number }) {
  const id = useId();
  const set = useAction(setMediaRoomAction);
  const review = useAction(reviewRoomSuggestionsAction);
  const [value, setValue] = useState<string>(item?.room ?? "");
  const [seen, setSeen] = useState(item?.room ?? "");
  if ((item?.room ?? "") !== seen) {
    setSeen(item?.room ?? "");
    setValue(item?.room ?? "");
  }
  const error = set.error ?? review.error;
  return (
    <div className="flex flex-col gap-1.5">
      {canManage ? (
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="shrink-0 text-xs font-semibold text-ink-2">
            Ambiente
          </label>
          <Select
            id={id}
            className="h-9"
            value={value}
            disabled={set.pending}
            aria-describedby={item?.roomSource === "ai_accepted" ? `${id}-src` : undefined}
            onChange={(e) => {
              const next = e.target.value;
              setValue(next);
              void set.run({ propertyId, mediaId, room: next ? (next as RoomKey) : null }).then((r) => {
                if (!r.ok) setValue(item?.room ?? "");
              });
            }}
          >
            <option value="">Sin etiquetar</option>
            {ROOM_KEYS.map((k) => (
              <option key={k} value={k}>
                {ROOM_LABEL[k]}
              </option>
            ))}
          </Select>
        </div>
      ) : item?.room ? (
        <p className="text-xs text-ink-2">Ambiente: {ROOM_LABEL[item.room]}</p>
      ) : null}
      {item?.roomSource === "ai_accepted" ? (
        <p id={`${id}-src`} className="text-[11px] text-stone">
          Sugerida por IA y aceptada por una persona
        </p>
      ) : null}
      {item?.suggestion && canManage ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] bg-paper px-2 py-1.5 text-xs" aria-label={`Sugerencia de IA para la foto ${position}`}>
          <span>
            IA sugiere: <strong>{ROOM_LABEL[item.suggestion.room]}</strong> ({Math.round(item.suggestion.confidence * 100)} %)
          </span>
          <Button size="sm" variant="secondary" className="h-7 px-2" disabled={review.pending} onClick={() => void review.run({ propertyId, mediaIds: [mediaId], decision: "accept" })}>
            Aceptar
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" disabled={review.pending} onClick={() => void review.run({ propertyId, mediaIds: [mediaId], decision: "dismiss" })}>
            Descartar
          </Button>
        </div>
      ) : null}
      {item ? (
        <div className="flex flex-wrap gap-1">
          {item.duplicateOf ? <Badge tone="warning">Posible repetida</Badge> : null}
          {item.dark ? <Badge tone="warning">Posiblemente oscura</Badge> : null}
          {item.blurry ? <Badge tone="warning">Posiblemente borrosa</Badge> : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SuggestedOrderPanel({ propertyId, data, previews, canManage }: { propertyId: string; data: DirectorData; previews: Preview[]; canManage: boolean }) {
  const apply = useAction(applySuggestedOrderAction);
  const acceptAll = useAction(reviewRoomSuggestionsAction);
  const vision = useAction(requestRoomSuggestionsAction);
  const s = data.suggestion;
  const byId = new Map(previews.map((p) => [p.id, p]));
  const pendingIds = Object.entries(data.items)
    .filter(([, v]) => v.suggestion)
    .map(([k]) => k);
  const reasons = s.reasons.slice(0, 6);
  const external = Object.values(data.items).filter((i) => !i.stored).length;

  return (
    <section aria-labelledby={`director-${propertyId}`} className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-paper p-3 sm:p-4" data-testid="photo-director">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`director-${propertyId}`} className="text-sm font-bold text-ink">
          Director de fotos
        </h3>
        <div className="flex flex-wrap gap-2">
          {canManage && data.pendingSuggestions > 0 ? (
            <Button size="sm" variant="secondary" disabled={acceptAll.pending} onClick={() => void acceptAll.run({ propertyId, mediaIds: pendingIds, decision: "accept" })}>
              {acceptAll.pending ? "Aceptando…" : `Aceptar las ${data.pendingSuggestions} sugerencias`}
            </Button>
          ) : null}
          {canManage && data.aiAvailable && data.visionCandidates > 0 && !data.visionJobQueued ? (
            <Button size="sm" variant="secondary" disabled={vision.pending} onClick={() => void vision.run(propertyId)}>
              {vision.pending ? "Pidiendo…" : `Sugerir ambientes con IA (${data.visionCandidates})`}
            </Button>
          ) : null}
        </div>
      </div>
      {data.visionJobQueued ? <p className="text-xs text-stone">La IA está revisando las fotos. Las sugerencias aparecen acá para que las aceptes o descartes.</p> : null}
      {acceptAll.error || vision.error ? <Alert tone="danger">{acceptAll.error ?? vision.error}</Alert> : null}

      {s.basis === "none" ? (
        <p className="text-sm text-ink-2">
          Etiquetá el ambiente de cada foto (Fachada, Living, Cocina…) para ver una portada y un orden sugeridos.
          {external ? ` ${external === 1 ? "Hay 1 foto externa" : `Hay ${external} fotos externas`} (del sitio anterior): se etiquetan igual, pero no se analizan luz, nitidez ni repetidas.` : ""}
        </p>
      ) : !s.changed ? (
        <p className="text-sm text-success">El orden y la portada actuales coinciden con los sugeridos.</p>
      ) : (
        <>
          <p className="text-sm text-ink-2">Orden y portada sugeridos por reglas (no se borra ninguna foto):</p>
          <ol className="flex gap-2 overflow-x-auto pb-1" aria-label="Orden sugerido">
            {s.order.map((id, i) => {
              const p = byId.get(id);
              const it = data.items[id];
              return (
                <li key={id} className="w-24 shrink-0">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-sm)] bg-paper-2">
                    {p?.src ? <Image src={p.src} alt={p.alt} fill unoptimized={!p.optimize} sizes="96px" className={p.kind === "floor_plan" ? "object-contain" : "object-cover"} /> : null}
                    {id === s.heroId ? <span className="absolute left-1 top-1 rounded bg-ink px-1 text-[10px] font-bold text-paper">Portada</span> : null}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-stone">
                    {i + 1}. {it?.room ? ROOM_LABEL[it.room] : p?.kind === "floor_plan" ? "Plano" : "Sin etiquetar"}
                  </p>
                </li>
              );
            })}
          </ol>
          <ul className="list-disc pl-5 text-xs text-ink-2">
            {reasons.map((r, i) => (
              <li key={`${r.mediaId}-${i}`}>{r.reason}</li>
            ))}
          </ul>
          {apply.error ? <Alert tone="danger">{apply.error}</Alert> : null}
          {canManage ? (
            <Button
              size="sm"
              className="self-start"
              disabled={apply.pending}
              aria-busy={apply.pending}
              onClick={() => {
                if (!window.confirm("¿Aplicar el orden y la portada sugeridos? Cambia cómo se ven las fotos en el sitio y en los portales. Queda registrado en la auditoría y lo podés volver a ordenar a mano.")) return;
                void apply.run({ propertyId, order: s.order, heroId: s.heroId });
              }}
            >
              {apply.pending ? "Aplicando…" : "Aplicar orden sugerido"}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
