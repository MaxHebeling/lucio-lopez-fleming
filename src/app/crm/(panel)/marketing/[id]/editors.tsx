"use client";

import { useActionState, useState } from "react";
import { Button, Field, Input, Textarea, cx } from "@/components/ui";
import type { InlineAction, InlineActionState } from "@/components/crm/inline-action";

function Result({ state }: { state: InlineActionState }) {
  return (
    <p aria-live="polite" className={cx("min-h-4 text-xs", state && !state.ok ? "text-danger" : "text-success")}>
      {state ? (state.ok ? (state.message ?? "") : state.error) : ""}
    </p>
  );
}

export function CaptionEditor({ postId, caption, limit, disabled, action, warnReset }: { postId: string; caption: string; limit: number; disabled: boolean; action: InlineAction; warnReset: boolean }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [value, setValue] = useState(caption);
  const over = value.length > limit;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="postId" value={postId} />
      <Field label="Texto de la publicación" htmlFor="caption" hint={warnReset ? "Si cambiás el texto, la publicación vuelve a borrador y hay que aprobarla de nuevo." : undefined}>
        <Textarea id="caption" name="caption" rows={12} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled} aria-invalid={over} className="font-[inherit] leading-relaxed" />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cx("text-xs tabular-nums", over ? "text-danger" : "text-stone")}>
          {value.length} / {limit} caracteres
        </span>
        <Button type="submit" size="sm" disabled={disabled || pending || over || value === caption}>
          {pending ? "Guardando…" : "Guardar texto"}
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

export type PickerImage = { id: string; url: string | null; isCover: boolean; status: string; alt: string | null };

export function PhotoPicker({ postId, images, selected, max, disabled, action }: { postId: string; images: PickerImage[]; selected: string[]; max: number; disabled: boolean; action: InlineAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [order, setOrder] = useState<string[]>(selected.filter((id) => images.some((i) => i.id === id)));
  const toggle = (id: string) => setOrder((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= max ? cur : [...cur, id]));
  const move = (id: string, delta: number) =>
    setOrder((cur) => {
      const i = cur.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const changed = order.join(",") !== selected.join(",");

  if (!images.length) return <p className="text-sm text-stone">La propiedad no tiene fotos disponibles.</p>;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="postId" value={postId} />
      {order.map((id) => (
        <input key={id} type="hidden" name="mediaIds" value={id} />
      ))}
      <p className="text-xs text-stone">
        Tocá las fotos en el orden en que deben salir (máximo {max}). La primera es la portada del post. {order.length} elegidas.
      </p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {images.map((img) => {
          const pos = order.indexOf(img.id);
          const on = pos >= 0;
          return (
            <li key={img.id} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => toggle(img.id)}
                disabled={disabled}
                aria-pressed={on}
                aria-label={`${on ? `Quitar foto ${pos + 1}` : "Agregar foto"}${img.isCover ? " (portada de la propiedad)" : ""}`}
                className={cx("relative aspect-square overflow-hidden rounded-[var(--radius-md)] border-2 bg-paper-2", on ? "border-brick" : "border-transparent opacity-80 hover:opacity-100")}
              >
                {img.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- miniaturas de origen/CDN
                  <img src={img.url} alt={img.alt ?? ""} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center p-1 text-center text-[10px] text-stone">Sin URL pública</span>
                )}
                {on ? <span className="absolute left-1 top-1 flex size-6 items-center justify-center rounded-full bg-brick text-xs font-bold text-white">{pos + 1}</span> : null}
                {img.status !== "verified" && img.status !== "stored" ? <span className="absolute bottom-1 left-1 rounded bg-white/90 px-1 text-[10px] text-warning">Sin verificar</span> : null}
              </button>
              {on && order.length > 1 ? (
                <div className="flex justify-center gap-1">
                  <button type="button" onClick={() => move(img.id, -1)} disabled={disabled || pos === 0} className="rounded px-2 text-xs text-ink-2 hover:bg-paper-2 disabled:opacity-40" aria-label="Mover antes">
                    ←
                  </button>
                  <button type="button" onClick={() => move(img.id, 1)} disabled={disabled || pos === order.length - 1} className="rounded px-2 text-xs text-ink-2 hover:bg-paper-2 disabled:opacity-40" aria-label="Mover después">
                    →
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-end">
        <Button type="submit" size="sm" disabled={disabled || pending || !changed || order.length === 0}>
          {pending ? "Guardando…" : "Guardar fotos"}
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function ScheduleForm({ postId, defaultValue, min, action }: { postId: string; defaultValue: string; min: string; action: InlineAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="postId" value={postId} />
      <Field label="Fecha y hora (Salta)" htmlFor="localDateTime">
        <Input id="localDateTime" name="localDateTime" type="datetime-local" required defaultValue={defaultValue} min={min} />
      </Field>
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? "Programando…" : "Programar"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function RejectForm({ postId, action }: { postId: string; action: InlineAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="postId" value={postId} />
      <Field label="Motivo del rechazo" htmlFor="reason">
        <Input id="reason" name="reason" required minLength={3} maxLength={500} placeholder="Ej.: cambiar la foto de portada" />
      </Field>
      <Button type="submit" size="sm" variant="danger" disabled={pending} className="self-start">
        {pending ? "Rechazando…" : "Rechazar"}
      </Button>
      <Result state={state} />
    </form>
  );
}
