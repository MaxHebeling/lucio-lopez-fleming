"use client";

import type { MouseEvent } from "react";
import type { TourScene } from "@/server/tours/model";

type Props = {
  plan: { url: string; width: number; height: number };
  scenes: Array<Pick<TourScene, "id" | "name" | "plan">>;
  currentSceneId: string | null;
  isDemo: boolean;
  /** Navegar a una escena (sitio). */
  onSelect?: (sceneId: string) => void;
  /** Editor: ubicar la escena actual con un clic en el plano (coordenadas 0..1). */
  onPick?: (point: { x: number; y: number }) => void;
  tone?: "dark" | "light";
};

/**
 * Plano con los ambientes ubicados. Cada ambiente es un botón (clic, toque o teclado) y el actual muestra «Estás aquí».
 * El plano se muestra como imagen (<img>): un SVG subido nunca se inserta en el DOM.
 */
export function FloorPlan({ plan, scenes, currentSceneId, isDemo, onSelect, onPick, tone = "dark" }: Props) {
  const placed = scenes.filter((s) => s.plan);
  const pick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    onPick({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
  };
  return (
    <figure className={`tour-plan tour-plan--${tone}`}>
      {isDemo ? <p className="tour-plan-flag">PLANO DEMOSTRATIVO</p> : null}
      <div className={`tour-plan-canvas ${onPick ? "is-picking" : ""}`} style={{ aspectRatio: `${plan.width} / ${plan.height}` }} onClick={onPick ? pick : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element -- plano estático o del storage, tamaño variable y sin optimizar (SVG) */}
        <img src={plan.url} alt={isDemo ? "Plano demostrativo de la residencia ficticia" : "Plano de la propiedad"} width={plan.width} height={plan.height} draggable={false} />
        {placed.map((s) => {
          const current = s.id === currentSceneId;
          const style = { left: `${s.plan!.x * 100}%`, top: `${s.plan!.y * 100}%` };
          const content = (
            <>
              <span className="tour-plan-dot" aria-hidden="true" />
              <span className="tour-plan-name">{current ? `Estás aquí · ${s.name}` : s.name}</span>
            </>
          );
          return onSelect ? (
            <button
              key={s.id}
              type="button"
              className="tour-plan-point"
              data-current={current || undefined}
              style={style}
              aria-current={current ? "location" : undefined}
              aria-label={current ? `${s.name} (estás aquí)` : `Ir a ${s.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(s.id);
              }}
            >
              {content}
            </button>
          ) : (
            <span key={s.id} className="tour-plan-point" data-current={current || undefined} style={style}>
              {content}
            </span>
          );
        })}
      </div>
      <figcaption className="sr-only">{placed.length ? `Ambientes en el plano: ${placed.map((s) => s.name).join(", ")}.` : "Todavía no hay ambientes ubicados en el plano."}</figcaption>
    </figure>
  );
}
