import { Monogram } from "@/components/experience/Monogram";

/** Respuesta única para cualquier link inválido, vencido, revocado o con el módulo apagado: no revela cuál es el caso. */
export default function VisitLinkUnavailable() {
  return (
    <main className="vx">
      <div className="vx-wrap">
        <div className="vx-brand">
          <Monogram className="h-9 w-auto text-brick" />
          <span className="vx-brand-name">
            Lucio López Fleming<span className="vx-brand-tag">Buenos negocios</span>
          </span>
        </div>
        <section>
          <p className="vx-eyebrow">Tu visita</p>
          <h1 className="vx-display vx-h2 mt-3">Este enlace no está disponible.</h1>
          <p className="mt-4 text-base text-ink-2">Puede haber vencido o haber sido reemplazado. Si tenés una visita coordinada, pedile a tu asesor un enlace nuevo.</p>
        </section>
      </div>
    </main>
  );
}
