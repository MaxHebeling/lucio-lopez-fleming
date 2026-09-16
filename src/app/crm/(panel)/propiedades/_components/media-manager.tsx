"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Alert, Badge, Button, cx, Input, Select } from "@/components/ui";
import { useAction } from "@/components/crm/use-action";
import { altTextAction, deleteMediaAction, reorderMediaAction, setCoverAction } from "../actions";

export type MediaItem = {
  id: string;
  kind: string;
  file_id: string | null;
  source_url: string | null;
  is_cover: boolean;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  status: string;
  last_error: string | null;
};

const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 15 * 1024 * 1024;
const KIND_LABEL: Record<string, string> = { image: "Foto", floor_plan: "Plano", video: "Video", virtual_tour: "Recorrido virtual" };

type Upload = { key: string; name: string; progress: number; state: "queued" | "uploading" | "done" | "error"; error?: string };

function xhrSend(method: string, url: string, body: XMLHttpRequestBodyInit, headers: Record<string, string>, onProgress: (pct: number) => void): Promise<{ status: number; text: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => resolve({ status: 0, text: "" });
    xhr.send(body);
  });
}

function errorMessage(text: string, fallback: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    // Respuesta no JSON (p. ej. límite del proxy): queda el mensaje genérico.
    return fallback;
  }
}

/**
 * Subida de una foto. Con storage S3 va directo al bucket (URL firmada) y el servidor la procesa después:
 * así no aplica el límite de ~4,5 MB por request de la plataforma. Con storage local usa la ruta clásica.
 */
async function uploadOne(propertyId: string, file: File, kind: string, onProgress: (pct: number) => void): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = `/api/crm/propiedades/${propertyId}/multimedia`;
  const intentRes = await fetch(`${base}/intent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contentType: file.type, size: file.size }) });
  const intentText = await intentRes.text();
  if (!intentRes.ok) return { ok: false, error: errorMessage(intentText, "No se pudo preparar la subida.") };
  const intent = (JSON.parse(intentText) as { data: { mode: "direct"; uploadUrl: string; token: string } | { mode: "proxy" } }).data;

  if (intent.mode === "direct") {
    const put = await xhrSend("PUT", intent.uploadUrl, file, { "content-type": file.type }, (pct) => onProgress(Math.min(95, pct)));
    if (put.status < 200 || put.status >= 300) return { ok: false, error: put.status === 0 ? "Error de red al subir. Probá de nuevo." : "El almacenamiento rechazó la foto." };
    const done = await fetch(`${base}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: intent.token, kind, name: file.name }) });
    if (!done.ok) return { ok: false, error: errorMessage(await done.text(), "No se pudo procesar la foto.") };
    onProgress(100);
    return { ok: true };
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  const r = await xhrSend("POST", base, fd, {}, onProgress);
  if (r.status >= 200 && r.status < 300) return { ok: true };
  return { ok: false, error: r.status === 0 ? "Error de red al subir. Probá de nuevo." : errorMessage(r.text, "No se pudo subir la foto.") };
}

export function MediaManager({ propertyId, media, canManage }: { propertyId: string; media: MediaItem[]; canManage: boolean }) {
  const router = useRouter();
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState(media);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [kind, setKind] = useState("image");
  const [announce, setAnnounce] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const reorder = useAction(reorderMediaAction);

  // Tras un refresh del servidor, la lista autoritativa vuelve a mandar.
  const signature = media.map((m) => `${m.id}:${m.is_cover}:${m.alt_text ?? ""}`).join("|");
  const [seenSignature, setSeenSignature] = useState(signature);
  if (signature !== seenSignature) {
    setSeenSignature(signature);
    setItems(media);
  }

  const busy = uploads.some((u) => u.state === "queued" || u.state === "uploading");

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const batch: Upload[] = list.map((f, i) => {
      const invalid = !ACCEPT.includes(f.type) ? "Formato no admitido (JPG, PNG, WebP o AVIF)" : f.size > MAX_BYTES ? "Supera 15 MB" : undefined;
      return { key: `${Date.now()}-${i}-${f.name}`, name: f.name, progress: 0, state: invalid ? "error" : "queued", error: invalid };
    });
    setUploads((prev) => [...prev.filter((u) => u.state !== "done"), ...batch]);
    let uploaded = 0;
    for (const [i, file] of list.entries()) {
      const u = batch[i]!;
      if (u.state === "error") continue;
      setUploads((prev) => prev.map((x) => (x.key === u.key ? { ...x, state: "uploading" } : x)));
      const r = await uploadOne(propertyId, file, kind, (pct) => setUploads((prev) => prev.map((x) => (x.key === u.key ? { ...x, progress: pct } : x))));
      setUploads((prev) => prev.map((x) => (x.key === u.key ? (r.ok ? { ...x, state: "done", progress: 100 } : { ...x, state: "error", error: r.error }) : x)));
      if (r.ok) uploaded++;
    }
    if (uploaded) {
      setAnnounce(`${uploaded} archivo(s) subido(s).`);
      router.refresh();
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function commitOrder(next: MediaItem[], message: string) {
    const prev = items;
    setItems(next);
    setAnnounce(message);
    const r = await reorder.run(propertyId, next.map((m) => m.id));
    if (!r.ok) setItems(prev);
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [it] = next.splice(index, 1);
    next.splice(target, 0, it!);
    void commitOrder(next, `Movido a la posición ${target + 1} de ${next.length}.`);
    requestAnimationFrame(() => document.getElementById(`${uid}-${it!.id}-${delta < 0 ? "up" : "down"}`)?.focus());
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {canManage ? (
        <div
          onDragOver={(e) => {
            if (dragId) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            if (dragId) return;
            e.preventDefault();
            setDragOver(false);
            void handleFiles(e.dataTransfer.files);
          }}
          className={cx("flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border-2 border-dashed px-4 py-6 text-center transition-colors", dragOver ? "border-ink bg-paper-2" : "border-line bg-paper")}
        >
          <p className="text-sm text-ink-2">Arrastrá fotos acá o elegilas desde tu dispositivo.</p>
          <p className="text-xs text-stone">JPG, PNG, WebP o AVIF · hasta 15 MB cada una. Se quitan los datos de ubicación (GPS) y se optimizan automáticamente.</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <label htmlFor={`${uid}-kind`} className="sr-only">
              Tipo de archivo
            </label>
            <Select id={`${uid}-kind`} value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto">
              <option value="image">Fotos</option>
              <option value="floor_plan">Planos</option>
            </Select>
            <label htmlFor={`${uid}-file`} className="inline-flex h-10 cursor-pointer items-center rounded-[var(--radius-md)] bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brick">
              Elegir archivos
              <input
                ref={inputRef}
                id={`${uid}-file`}
                type="file"
                accept={ACCEPT.join(",")}
                multiple
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  if (e.target.files) void handleFiles(e.target.files);
                }}
              />
            </label>
          </div>
        </div>
      ) : null}

      {uploads.length ? (
        <ul className="flex flex-col gap-2" aria-label="Subidas">
          {uploads.map((u) => (
            <li key={u.key} className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-line bg-white px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{u.name}</span>
                <span className={cx("shrink-0 text-xs", u.state === "error" ? "text-danger" : "text-stone")}>
                  {u.state === "queued" ? "En espera" : u.state === "uploading" ? `${u.progress}%` : u.state === "done" ? "Listo" : "Error"}
                </span>
              </div>
              {u.state === "uploading" ? (
                <div className="h-1.5 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuenow={u.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Subiendo ${u.name}`}>
                  <div className="h-full bg-ink" style={{ width: `${u.progress}%` }} />
                </div>
              ) : null}
              {u.error ? (
                <p role="alert" className="text-xs text-danger">
                  {u.error}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {reorder.error ? <Alert tone="danger">{reorder.error}</Alert> : null}

      {items.length === 0 ? (
        <p className="text-sm text-stone">Todavía no hay fotos. Para publicar se necesita al menos una.</p>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((m, i) => (
            <li
              key={m.id}
              draggable={canManage}
              onDragStart={(e) => {
                setDragId(m.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (dragId) e.preventDefault();
              }}
              onDrop={(e) => {
                if (!dragId || dragId === m.id) return;
                e.preventDefault();
                const from = items.findIndex((x) => x.id === dragId);
                const next = [...items];
                const [moved] = next.splice(from, 1);
                next.splice(i, 0, moved!);
                setDragId(null);
                void commitOrder(next, `Movido a la posición ${i + 1} de ${next.length}.`);
              }}
              className={cx("flex flex-col overflow-hidden rounded-[var(--radius-lg)] border bg-white", dragId === m.id ? "border-ink opacity-60" : "border-line")}
            >
              <MediaThumb item={m} position={i + 1} />
              <div className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-stone">#{i + 1}</span>
                  {m.is_cover ? <Badge tone="brand">Portada</Badge> : null}
                  <Badge>{KIND_LABEL[m.kind] ?? m.kind}</Badge>
                  {m.status === "source_only" ? <Badge tone="warning">En sitio anterior</Badge> : null}
                  {m.status === "failed" ? <Badge tone="danger">Con error</Badge> : null}
                  {m.width && m.height ? <span className="text-xs text-stone">{m.width}×{m.height}</span> : null}
                </div>
                {m.last_error ? <p className="text-xs text-danger">{m.last_error}</p> : null}
                {canManage ? <AltTextEditor propertyId={propertyId} item={m} /> : m.alt_text ? <p className="text-xs text-ink-2">{m.alt_text}</p> : null}
                {canManage ? (
                  <MediaButtons
                    uid={uid}
                    propertyId={propertyId}
                    item={m}
                    first={i === 0}
                    last={i === items.length - 1}
                    onMove={(d) => move(i, d)}
                    disabled={reorder.pending}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MediaThumb({ item, position }: { item: MediaItem; position: number }) {
  const src = item.file_id ? `/api/files/${item.file_id}` : item.source_url;
  const alt = item.alt_text || `${KIND_LABEL[item.kind] ?? "Archivo"} ${position}`;
  if (!src || (item.kind !== "image" && item.kind !== "floor_plan")) {
    return <div className="flex aspect-[4/3] items-center justify-center bg-paper-2 text-xs text-stone">{KIND_LABEL[item.kind] ?? item.kind}</div>;
  }
  return (
    <div className="relative aspect-[4/3] bg-paper-2">
      <Image src={src} alt={alt} fill unoptimized sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw" className={item.kind === "floor_plan" ? "object-contain" : "object-cover"} />
    </div>
  );
}

function AltTextEditor({ propertyId, item }: { propertyId: string; item: MediaItem }) {
  const id = useId();
  const [value, setValue] = useState(item.alt_text ?? "");
  const save = useAction(altTextAction);
  const dirty = value.trim() !== (item.alt_text ?? "");
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        await save.run(propertyId, item.id, value);
      }}
    >
      <label htmlFor={id} className="text-xs font-semibold text-ink-2">
        Texto alternativo
      </label>
      <div className="flex gap-2">
        <Input id={id} value={value} maxLength={250} placeholder="Ej.: Living con ventanal al jardín" onChange={(e) => setValue(e.target.value)} className="h-9" />
        <Button type="submit" size="sm" variant="secondary" disabled={!dirty || save.pending} className="h-9">
          {save.pending ? "…" : "Guardar"}
        </Button>
      </div>
      {save.error ? (
        <p role="alert" className="text-xs text-danger">
          {save.fieldErrors?.altText?.[0] ?? save.error}
        </p>
      ) : null}
    </form>
  );
}

function MediaButtons({ uid, propertyId, item, first, last, onMove, disabled }: { uid: string; propertyId: string; item: MediaItem; first: boolean; last: boolean; onMove: (delta: number) => void; disabled: boolean }) {
  const cover = useAction(setCoverAction);
  const del = useAction(deleteMediaAction);
  const error = cover.error ?? del.error;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        <Button id={`${uid}-${item.id}-up`} size="sm" variant="ghost" disabled={first || disabled} onClick={() => onMove(-1)} aria-label="Mover antes">
          ↑ Antes
        </Button>
        <Button id={`${uid}-${item.id}-down`} size="sm" variant="ghost" disabled={last || disabled} onClick={() => onMove(1)} aria-label="Mover después">
          ↓ Después
        </Button>
        {item.kind === "image" && !item.is_cover ? (
          <Button size="sm" variant="secondary" disabled={cover.pending} onClick={() => void cover.run(propertyId, item.id)}>
            {cover.pending ? "…" : "Usar de portada"}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="text-danger"
          disabled={del.pending}
          onClick={() => {
            if (window.confirm("¿Borrar este archivo? Deja de mostrarse en el sitio y en el CRM.")) void del.run(propertyId, item.id);
          }}
        >
          {del.pending ? "Borrando…" : "Borrar"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
