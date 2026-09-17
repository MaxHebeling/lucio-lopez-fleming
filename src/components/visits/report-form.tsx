"use client";

/**
 * Informe post-visita: el agente escribe (o dicta) su comentario y completa los campos estructurados.
 * Se guarda como borrador o se confirma. Si en el futuro hay una propuesta de IA (`proposal`), se muestra para
 * «Revisá y confirmá»: nunca se guarda sola.
 */
import { useState } from "react";
import { Alert, Button, Field, Input, Textarea, cx } from "@/components/ui";
import { useAction } from "@/components/crm/use-action";
import { utcToLocalInput } from "@/server/crm/time";
import { FOLLOW_UP_DELAY_HOURS, INTEREST_LABEL, suggestFollowUpAt, type Interest } from "@/server/visits/rules";
import type { VisitReportProposal } from "@/server/visits/ai-extension";
import { saveReportAction } from "@/app/crm/(panel)/mis-visitas/actions";
import { proposeReportAction } from "@/app/crm/(panel)/mis-visitas/ai-actions";
import { DictationButton } from "./dictation-button";

export type ReportValues = {
  body: string;
  interest: Interest | null;
  positives: string;
  objections: string;
  nextStep: string;
  followUpAt: string;
  status: "draft" | "confirmed" | null;
};

const delayLabel = (i: Interest | null) => {
  const h = FOLLOW_UP_DELAY_HOURS[i ?? "medium"];
  return h % 24 === 0 && h >= 48 ? `${h / 24} días` : `${h} h`;
};

export function ReportForm({ appointmentId, initial, finishedAt, proposal: storedProposal, aiAssist = false }: { appointmentId: string; initial: ReportValues; finishedAt: string; proposal: VisitReportProposal | null; aiAssist?: boolean }) {
  const action = useAction(saveReportAction);
  const propose = useAction(proposeReportAction);
  const [proposal, setProposal] = useState<VisitReportProposal | null>(storedProposal);
  const [v, setV] = useState(initial);
  const [dictated, setDictated] = useState(false);
  const [followTouched, setFollowTouched] = useState(Boolean(initial.followUpAt));
  const [editing, setEditing] = useState(initial.status !== "confirmed");
  const set = <K extends keyof ReportValues>(k: K, value: ReportValues[K]) => setV((p) => ({ ...p, [k]: value }));
  const fe = action.fieldErrors ?? {};

  const setInterest = (i: Interest) => {
    setV((p) => ({ ...p, interest: i, followUpAt: followTouched ? p.followUpAt : utcToLocalInput(suggestFollowUpAt(i, new Date(finishedAt))) }));
  };

  const submit = (confirm: boolean) =>
    void action.run({ appointmentId, body: v.body, interest: v.interest, positives: v.positives, objections: v.objections, nextStep: v.nextStep, followUpAt: v.followUpAt || null, dictated, confirm }).then((r) => {
      if (r.ok && confirm) setEditing(false);
    });

  if (!editing) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="rounded-[var(--radius-md)] border border-success/30 bg-[#eef6f0] px-3 py-2 font-semibold text-success">Informe confirmado</p>
        <p className="whitespace-pre-wrap break-words">{v.body}</p>
        <dl className="grid gap-2 sm:grid-cols-2">
          <Item label="Interés" value={v.interest ? INTEREST_LABEL[v.interest] : "—"} />
          <Item label="Siguiente paso" value={v.nextStep || "—"} />
          <Item label="Aspectos positivos" value={v.positives || "—"} />
          <Item label="Objeciones" value={v.objections || "—"} />
        </dl>
        <Button variant="secondary" className="h-11 self-start" onClick={() => setEditing(true)}>
          Editar informe
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      aria-label="Informe post-visita"
      onSubmit={(e) => {
        e.preventDefault();
        submit(true);
      }}
    >
      {proposal ? (
        <ProposalReview
          proposal={proposal}
          onApply={(p) => {
            setV((prev) => ({ ...prev, interest: p.interest ?? prev.interest, positives: p.positives ?? prev.positives, objections: p.objections ?? prev.objections, nextStep: p.nextStep ?? prev.nextStep, followUpAt: p.followUpAt ?? prev.followUpAt }));
            if (p.followUpAt) setFollowTouched(true);
            setProposal(null);
          }}
          onDismiss={() => setProposal(null)}
        />
      ) : null}
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      {action.ok ? <Alert tone="success">Borrador guardado.</Alert> : null}
      <Field label="¿Cómo fue la visita?" htmlFor="report-body" error={fe.body}>
        <Textarea
          id="report-body"
          rows={5}
          maxLength={10000}
          value={v.body}
          onChange={(e) => set("body", e.target.value)}
          placeholder="Qué le gustó, qué dudas tuvo, cómo quedaron…"
          aria-invalid={fe.body ? true : undefined}
        />
      </Field>
      {aiAssist ? (
        <div className="flex flex-col gap-1">
          <Button
            variant="secondary"
            className="h-11 self-start"
            disabled={propose.pending || v.body.trim().length < 10}
            aria-busy={propose.pending}
            onClick={() =>
              void propose.run({ appointmentId, text: v.body }).then((r) => {
                if (r.ok) setProposal(r.data);
              })
            }
          >
            {propose.pending ? "Leyendo el comentario…" : "Proponer campos con IA"}
          </Button>
          {propose.error ? (
            <p role="alert" className="text-xs text-danger">
              {propose.error}
            </p>
          ) : (
            <p className="text-xs text-stone">La IA lee tu comentario y propone interés, positivos, objeciones y siguiente paso. Vos revisás y confirmás.</p>
          )}
        </div>
      ) : null}
      <DictationButton
        controls="report-body"
        onText={(t) => {
          setDictated(true);
          setV((p) => ({ ...p, body: p.body ? `${p.body.trimEnd()} ${t}` : t }));
        }}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Interés del cliente</legend>
        <div className="grid grid-cols-3 gap-2">
          {(["low", "medium", "high"] as const).map((i) => (
            <label key={i} className={cx("flex h-12 cursor-pointer items-center justify-center rounded-[var(--radius-md)] border text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brick", v.interest === i ? "border-ink bg-ink text-paper" : "border-line bg-white text-ink")}>
              <input type="radio" name="interest" value={i} checked={v.interest === i} onChange={() => setInterest(i)} className="sr-only" />
              {INTEREST_LABEL[i]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Aspectos positivos" htmlFor="report-positives" error={fe.positives}>
        <Textarea id="report-positives" rows={2} maxLength={2000} value={v.positives} onChange={(e) => set("positives", e.target.value)} />
      </Field>
      <Field label="Objeciones" htmlFor="report-objections" error={fe.objections}>
        <Textarea id="report-objections" rows={2} maxLength={2000} value={v.objections} onChange={(e) => set("objections", e.target.value)} />
      </Field>
      <Field label="Siguiente paso" htmlFor="report-next" error={fe.nextStep}>
        <Input id="report-next" maxLength={500} value={v.nextStep} onChange={(e) => set("nextStep", e.target.value)} placeholder="Enviar comparables, segunda visita…" />
      </Field>
      <Field label="Fecha sugerida de seguimiento" htmlFor="report-follow" hint={`Sugerencia por interés ${v.interest ? INTEREST_LABEL[v.interest].toLowerCase() : "medio"}: ${delayLabel(v.interest)} después de la visita. Editable.`} error={fe.followUpAt}>
        <Input
          id="report-follow"
          type="datetime-local"
          step={300}
          value={v.followUpAt}
          onChange={(e) => {
            setFollowTouched(true);
            set("followUpAt", e.target.value);
          }}
        />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" className="h-12" disabled={action.pending} onClick={() => submit(false)}>
          Guardar borrador
        </Button>
        <Button type="submit" className="h-12" disabled={action.pending} aria-busy={action.pending}>
          {action.pending ? "Guardando…" : "Confirmar informe"}
        </Button>
      </div>
    </form>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone">{label}</dt>
      <dd className="whitespace-pre-wrap break-words">{value}</dd>
    </div>
  );
}

/** Propuesta estructurada (fase de IA). Solo aparece si existe una salida real; el agente decide qué aplicar. */
function ProposalReview({ proposal, onApply, onDismiss }: { proposal: VisitReportProposal; onApply: (p: VisitReportProposal) => void; onDismiss: () => void }) {
  const rows: Array<[string, string | null]> = [
    ["Interés", proposal.interest ? INTEREST_LABEL[proposal.interest] : null],
    ["Aspectos positivos", proposal.positives],
    ["Objeciones", proposal.objections],
    ["Siguiente paso", proposal.nextStep],
    ["Seguimiento", proposal.followUpAt ? proposal.followUpAt.replace("T", " ") : null],
  ];
  return (
    <section aria-label="Propuesta de la IA para revisar" className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-line bg-paper p-3 text-sm" data-testid="report-proposal">
      <p className="font-semibold">Revisá y confirmá · propuesta de la IA</p>
      <p className="whitespace-pre-wrap text-ink-2">{proposal.summary}</p>
      <dl className="grid gap-2 sm:grid-cols-2">
        {rows.map(([k, val]) => (
          <div key={k}>
            <dt className="text-xs text-stone">{k}</dt>
            <dd className="whitespace-pre-wrap break-words">{val ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-stone">Nada se guarda hasta que confirmes el informe.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="h-11" onClick={() => onApply(proposal)}>
          Usar estos campos
        </Button>
        <Button variant="ghost" className="h-11" onClick={onDismiss}>
          Descartar
        </Button>
      </div>
    </section>
  );
}
