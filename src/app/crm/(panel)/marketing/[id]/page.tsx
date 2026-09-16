import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { socialPostDetail } from "@/server/marketing/queries";
import { CAPTION_MAX } from "@/server/marketing/copy";
import { MAX_POST_ASSETS } from "@/server/marketing/drafts";
import { utcToZonedLocal } from "@/server/marketing/time";
import { Alert, Badge, Card, PageHeader, buttonClass, formatDateTime } from "@/components/ui";
import { InlineAction } from "@/components/crm/inline-action";
import { approveAction, rejectAction, saveAssetsAction, saveCaptionAction, scheduleAction, unscheduleAction } from "../actions";
import { CHANNEL_LABEL, GENERATED_BY, POST_STATUS } from "../labels";
import { CaptionEditor, PhotoPicker, RejectForm, ScheduleForm } from "./editors";

export const metadata: Metadata = { title: "Publicación · Contenido · CRM" };

const EDITABLE = ["draft", "in_review", "approved", "scheduled", "rejected", "failed"];

export default async function SocialPostPage({ params }: PageProps<"/crm/marketing/[id]">) {
  const actor = await requireStaffPage("marketing.read");
  const { id } = await params;
  let detail: Awaited<ReturnType<typeof socialPostDetail>>;
  try {
    detail = await socialPostDetail(getDb(), actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { post, images, selectedIds, flags } = detail;
  const canEdit = can(actor, "marketing.create") && EDITABLE.includes(post.status);
  const canApprove = can(actor, "marketing.approve");
  const status = POST_STATUS[post.status] ?? { label: post.status, tone: "neutral" as const };
  const channel = post.channel as "instagram" | "facebook";
  const preview = selectedIds.map((sid) => images.find((i) => i.id === sid)).filter((x): x is (typeof images)[number] => Boolean(x));
  const cover = preview[0];
  const now = new Date();
  const defaultWhen = post.scheduled_at ? utcToZonedLocal(new Date(post.scheduled_at)) : `${utcToZonedLocal(new Date(now.getTime() + 86_400_000)).slice(0, 10)}T10:00`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/crm/marketing" className="text-sm text-stone hover:text-ink">
          ← Contenido
        </Link>
      </div>
      <PageHeader
        title={`${CHANNEL_LABEL[channel] ?? channel}${post.code ? ` · código ${post.code}` : ""}`}
        description={post.property_title ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {post.property_id ? (
              <Link href={`/crm/propiedades/${post.property_id}`} className={buttonClass("secondary", "sm")}>
                Ver propiedad
              </Link>
            ) : null}
          </div>
        }
      />

      {post.last_error ? <Alert tone={post.status === "failed" ? "danger" : "warning"}>{post.last_error}</Alert> : null}
      {post.status === "rejected" && post.rejected_reason ? <Alert tone="warning">Rechazada: {post.rejected_reason}</Alert> : null}
      {post.status === "scheduled" && !flags.publishing ? (
        <Alert tone="info">Programada, pero la publicación automática está apagada (feature flag social_publishing): no saldrá hasta activarla.</Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section aria-label="Vista previa" className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-brick text-xs font-bold text-white" aria-hidden>
                LLF
              </span>
              <span className="text-sm font-semibold text-ink">Lucio López Fleming</span>
              <span className="ml-auto text-xs text-stone">Vista previa · {CHANNEL_LABEL[channel]}</span>
            </div>
            <div className="relative aspect-[4/5] w-full bg-paper-2">
              {cover?.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- vista previa con la URL que usará Meta
                <img src={cover.url} alt={cover.alt ?? ""} className="h-full w-full object-cover" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-stone">
                  {preview.length ? "La foto elegida no tiene URL pública todavía" : "Elegí al menos una foto"}
                </span>
              )}
              {preview.length > 1 ? <span className="absolute right-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-xs text-white">1/{preview.length}</span> : null}
            </div>
            {preview.length > 1 ? (
              <ul className="flex gap-1 overflow-x-auto border-t border-line p-2">
                {preview.map((img, i) => (
                  <li key={img.id} className="size-12 shrink-0 overflow-hidden rounded bg-paper-2">
                    {img.url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- miniatura
                      <img src={img.url} alt={`Foto ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="whitespace-pre-line break-words px-3 py-3 text-sm leading-relaxed text-ink">{post.caption}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-stone">Origen del texto</dt>
            <dd className="text-ink-2">
              {GENERATED_BY[post.generated_by] ?? post.generated_by}
              {post.template_key ? ` (${post.template_key})` : ""}
            </dd>
            <dt className="text-stone">Creada</dt>
            <dd className="text-ink-2">{formatDateTime(post.created_at)}</dd>
            {post.approved_at ? (
              <>
                <dt className="text-stone">Aprobada</dt>
                <dd className="text-ink-2">
                  {formatDateTime(post.approved_at)}
                  {post.approved_by_name ? ` · ${post.approved_by_name}` : ""}
                </dd>
              </>
            ) : null}
            {post.scheduled_at ? (
              <>
                <dt className="text-stone">Programada</dt>
                <dd className="text-ink-2">{formatDateTime(post.scheduled_at)} (Salta)</dd>
              </>
            ) : null}
            {post.published_at ? (
              <>
                <dt className="text-stone">Publicada</dt>
                <dd className="text-ink-2">
                  {formatDateTime(post.published_at)} · id {post.external_post_id}
                </dd>
              </>
            ) : null}
          </dl>
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Aprobación">
            {post.status === "published" ? (
              <p className="text-sm text-ink-2">Esta publicación ya salió. No se puede modificar.</p>
            ) : !canApprove ? (
              <p className="text-sm text-stone">Tu rol puede preparar el contenido; la aprobación y programación las hace alguien con permiso de aprobar.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {["draft", "in_review"].includes(post.status) ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-sm text-ink-2">Revisá texto y fotos. Al aprobar, queda lista para programar.</p>
                    <InlineAction action={approveAction} fields={{ postId: post.id }} label="Aprobar" pendingLabel="Aprobando…" variant="primary" />
                  </div>
                ) : null}
                {["approved", "scheduled", "failed"].includes(post.status) ? (
                  <ScheduleForm postId={post.id} defaultValue={defaultWhen} min={utcToZonedLocal(new Date(now.getTime() + 5 * 60_000))} action={scheduleAction} />
                ) : null}
                {post.status === "scheduled" ? (
                  <InlineAction action={unscheduleAction} fields={{ postId: post.id }} label="Cancelar programación" variant="ghost" confirmText="¿Cancelar la programación? Queda aprobada sin fecha." />
                ) : null}
                {["draft", "in_review", "approved", "scheduled", "failed"].includes(post.status) ? (
                  <details className="rounded-[var(--radius-md)] border border-line px-3 py-2">
                    <summary className="cursor-pointer text-sm font-semibold text-ink-2">Rechazar</summary>
                    <div className="pt-3">
                      <RejectForm postId={post.id} action={rejectAction} />
                    </div>
                  </details>
                ) : null}
              </div>
            )}
          </Card>

          <Card title="Texto">
            <CaptionEditor
              postId={post.id}
              caption={post.caption}
              limit={CAPTION_MAX[channel] ?? CAPTION_MAX.instagram}
              disabled={!canEdit}
              action={saveCaptionAction}
              warnReset={["approved", "scheduled"].includes(post.status)}
            />
          </Card>

          <Card title="Fotos">
            <PhotoPicker postId={post.id} images={images} selected={selectedIds} max={MAX_POST_ASSETS} disabled={!canEdit} action={saveAssetsAction} />
          </Card>
        </div>
      </div>
    </div>
  );
}
