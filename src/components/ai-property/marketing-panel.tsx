"use client";

/**
 * Director de marketing en la ficha del CRM: genera borradores por canal (plantillas o IA con guardas), se revisan y
 * editan acá (SEO, WhatsApp, email, guion de Reel) o en Contenido (Instagram y Facebook, con su aprobación). Nada se
 * publica solo.
 */
import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Button, Field, Input, Textarea } from "@/components/ui";
import { useAction } from "@/components/crm/use-action";
import { CopyButton } from "@/components/visits/copy-button";
import type { MarketingDirectorView } from "@/server/ai/property/marketing-director";
import { applySeoDraftAction, discardMarketingDraftAction, generateMarketingDraftsAction, updateMarketingDraftAction } from "@/app/crm/(panel)/propiedades/[id]/ai-actions";

type Draft = MarketingDirectorView["drafts"][number];
type Scene = { shot: string; voiceover: string; on_screen: string };

const ORIGIN: Record<string, { label: string; tone: "neutral" | "info" | "success" }> = {
  template: { label: "Plantilla", tone: "neutral" },
  ai: { label: "Redactado por IA", tone: "info" },
  human: { label: "Editado", tone: "success" },
};
const STATUS: Record<string, string> = { draft: "Borrador", in_review: "En revisión", approved: "Aprobado", scheduled: "Programado", publishing: "Publicando", published: "Publicado", failed: "Con error" };
const TITLE: Record<Draft["channel"], string> = { site_seo: "Sitio web (SEO)", whatsapp: "WhatsApp", email: "Email", reel_script: "Guion de Reel" };

export function MarketingPanel({ propertyId, view }: { propertyId: string; view: MarketingDirectorView }) {
  const gen = useAction(generateMarketingDraftsAction);
  const [notice, setNotice] = useState<string | null>(null);
  const run = (mode: "template" | "ai") =>
    void gen.run({ propertyId, mode }).then((r) => {
      if (r.ok) setNotice(r.data.notice ?? (r.data.created || r.data.updated ? `Listo: ${r.data.created} nuevos y ${r.data.updated} actualizados${r.data.kept.length ? ` (se conservaron ${r.data.kept.length} editados a mano)` : ""}.` : "Los borradores ya estaban al día con los datos de la ficha."));
    });
  const empty = !view.drafts.length && !view.social.length;
  return (
    <div className="flex flex-col gap-4" data-testid="marketing-panel">
      <div className="flex flex-wrap items-center gap-2">
        {view.canCreate ? (
          <>
            <Button size="sm" variant={view.aiAvailable ? "secondary" : "primary"} disabled={gen.pending} aria-busy={gen.pending} onClick={() => run("template")}>
              {gen.pending ? "Generando…" : empty ? "Generar borradores" : "Regenerar con los datos actuales"}
            </Button>
            {view.aiAvailable ? (
              <Button size="sm" disabled={gen.pending} onClick={() => run("ai")}>
                Redactar con IA
              </Button>
            ) : null}
          </>
        ) : null}
        <Link href={`/crm/imprimir/propiedad/${propertyId}`} target="_blank" className="text-sm font-semibold underline underline-offset-4">
          Ficha imprimible
        </Link>
        <Link href="/crm/marketing" className="text-sm font-semibold underline underline-offset-4">
          Cola de contenido
        </Link>
      </div>
      <p className="text-xs text-stone">
        Los borradores se arman solo con datos de la ficha (sin adjetivos sobre lo que no consta).{view.aiAvailable ? " La IA redacta con las mismas guardas: si menciona algo que la ficha no tiene, se descarta." : " Sin IA configurada se usan plantillas."} Nada se publica
        solo: Instagram y Facebook se aprueban en Contenido.
      </p>
      {gen.error ? <Alert tone="danger">{gen.error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      {empty ? (
        <p className="text-sm text-stone">Todavía no hay borradores para esta propiedad.</p>
      ) : (
        <>
          {view.social.length ? (
            <section aria-label="Redes (cola de Contenido)">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone">Instagram y Facebook</h3>
              <ul className="grid gap-3 md:grid-cols-2">
                {view.social.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold capitalize">{s.channel}</span>
                      <Badge>{STATUS[s.status] ?? s.status}</Badge>
                      <Badge tone={ORIGIN[s.generatedBy]?.tone ?? "neutral"}>{ORIGIN[s.generatedBy]?.label ?? s.generatedBy}</Badge>
                    </div>
                    <p className="line-clamp-4 whitespace-pre-line text-ink-2">{s.caption}</p>
                    <Link href={`/crm/marketing/${s.id}`} className="self-start text-xs font-semibold underline underline-offset-4">
                      Revisar, elegir fotos y aprobar
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {view.drafts.map((d) => (
            <DraftEditor key={`${d.id}-${d.updatedAt.toString()}`} draft={d} canEdit={view.canCreate} canApplySeo={view.canApplySeo} />
          ))}
        </>
      )}
    </div>
  );
}

function plainText(d: Draft, c: Record<string, unknown>): string {
  if (d.channel === "site_seo") return `${c.title}\n${c.description}`;
  if (d.channel === "email") return `Asunto: ${c.subject}\n\n${c.body}`;
  if (d.channel === "reel_script") return ((c.scenes as Scene[]) ?? []).map((s, i) => `${i + 1}. ${s.shot}\nVoz: ${s.voiceover}${s.on_screen ? `\nTexto: ${s.on_screen}` : ""}`).join("\n\n");
  return String(c.text ?? "");
}

function DraftEditor({ draft, canEdit, canApplySeo }: { draft: Draft; canEdit: boolean; canApplySeo: boolean }) {
  const [c, setC] = useState<Record<string, unknown>>(draft.content);
  const save = useAction(updateMarketingDraftAction);
  const discard = useAction(discardMarketingDraftAction);
  const apply = useAction(applySeoDraftAction);
  const dirty = JSON.stringify(c) !== JSON.stringify(draft.content);
  const fe = save.fieldErrors ?? {};
  const id = `draft-${draft.id}`;
  const set = (k: string, v: unknown) => setC((p) => ({ ...p, [k]: v }));
  const scenes = (c.scenes as Scene[] | undefined) ?? [];
  const error = save.error ?? discard.error ?? apply.error;
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-line p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 id={`${id}-h`} className="text-sm font-semibold">
          {TITLE[draft.channel]}
        </h3>
        <Badge tone={ORIGIN[draft.generatedBy]?.tone ?? "neutral"}>{ORIGIN[draft.generatedBy]?.label ?? draft.generatedBy}</Badge>
      </div>
      {draft.channel === "site_seo" ? (
        <div className="grid gap-3">
          <Field label={`Título SEO (${String(c.title ?? "").length}/60)`} htmlFor={`${id}-title`} error={fe["title"]}>
            <Input id={`${id}-title`} value={String(c.title ?? "")} maxLength={70} readOnly={!canEdit} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label={`Descripción SEO (${String(c.description ?? "").length}/155)`} htmlFor={`${id}-desc`} error={fe["description"]}>
            <Textarea id={`${id}-desc`} rows={3} value={String(c.description ?? "")} maxLength={160} readOnly={!canEdit} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </div>
      ) : draft.channel === "email" ? (
        <div className="grid gap-3">
          <Field label="Asunto" htmlFor={`${id}-subject`} error={fe["subject"]}>
            <Input id={`${id}-subject`} value={String(c.subject ?? "")} maxLength={120} readOnly={!canEdit} onChange={(e) => set("subject", e.target.value)} />
          </Field>
          <Field label="Cuerpo" htmlFor={`${id}-body`} error={fe["body"]}>
            <Textarea id={`${id}-body`} rows={8} value={String(c.body ?? "")} maxLength={3000} readOnly={!canEdit} onChange={(e) => set("body", e.target.value)} />
          </Field>
        </div>
      ) : draft.channel === "reel_script" ? (
        <ol className="flex flex-col gap-3">
          {scenes.map((s, i) => (
            <li key={i} className="grid gap-2 rounded-[var(--radius-sm)] bg-paper p-2 sm:grid-cols-3">
              <Field label={`Escena ${i + 1} · toma`} htmlFor={`${id}-s${i}-shot`}>
                <Input id={`${id}-s${i}-shot`} value={s.shot} maxLength={160} readOnly={!canEdit} onChange={(e) => set("scenes", scenes.map((x, j) => (j === i ? { ...x, shot: e.target.value } : x)))} />
              </Field>
              <Field label="Voz en off" htmlFor={`${id}-s${i}-vo`}>
                <Input id={`${id}-s${i}-vo`} value={s.voiceover} maxLength={300} readOnly={!canEdit} onChange={(e) => set("scenes", scenes.map((x, j) => (j === i ? { ...x, voiceover: e.target.value } : x)))} />
              </Field>
              <Field label="Texto en pantalla" htmlFor={`${id}-s${i}-os`}>
                <Input id={`${id}-s${i}-os`} value={s.on_screen} maxLength={80} readOnly={!canEdit} onChange={(e) => set("scenes", scenes.map((x, j) => (j === i ? { ...x, on_screen: e.target.value } : x)))} />
              </Field>
            </li>
          ))}
        </ol>
      ) : (
        <Field label="Mensaje" htmlFor={`${id}-text`} error={fe["text"]}>
          <Textarea id={`${id}-text`} rows={7} value={String(c.text ?? "")} maxLength={900} readOnly={!canEdit} onChange={(e) => set("text", e.target.value)} />
        </Field>
      )}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <Button size="sm" variant="secondary" disabled={!dirty || save.pending} onClick={() => void save.run({ draftId: draft.id, content: c })}>
            {save.pending ? "Guardando…" : "Guardar cambios"}
          </Button>
        ) : null}
        <CopyButton text={plainText(draft, c)} label="Copiar" className="h-9 px-3 text-sm" />
        {draft.channel === "site_seo" && canApplySeo ? (
          <Button
            size="sm"
            disabled={dirty || apply.pending}
            title={dirty ? "Guardá los cambios antes de aplicar" : undefined}
            onClick={() => {
              if (window.confirm("¿Aplicar este título y descripción SEO a la ficha? Reemplaza los actuales y se ve en el sitio. Queda auditado.")) void apply.run({ draftId: draft.id });
            }}
          >
            {apply.pending ? "Aplicando…" : "Aplicar a la ficha"}
          </Button>
        ) : null}
        {canEdit ? (
          <Button size="sm" variant="ghost" disabled={discard.pending} onClick={() => void discard.run({ draftId: draft.id })}>
            Descartar
          </Button>
        ) : null}
      </div>
    </section>
  );
}
