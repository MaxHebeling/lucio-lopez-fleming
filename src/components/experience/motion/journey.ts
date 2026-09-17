import { DESKTOP_MQ, FINE_POINTER_MQ, clamp, noop } from "./config";
import { reaimAnchor, type Engine } from "./smooth-scroll";

/**
 * Recorrido arquitectónico de la portada (docs/WEB_EXPERIENCE.md §4.1) · solo desktop con puntero fino, sin movimiento
 * reducido y con el motor (Lenis + GSAP/ScrollTrigger) ya cargado en idle.
 *
 * Arma una línea de tiempo scrub sobre un escenario sticky (`.jr[data-pinned]`, ver journey.css) leyendo solo el
 * marcado: `data-transition` de cada escena y `data-aperture` de cada foto (ventana, puerta o arco reales). No conoce
 * ninguna imagen: sirve para cualquier recorrido de `hero-journey.ts`.
 *
 * - Solo transform, opacity y clip-path. Estados de partida explícitos (fromTo) y medidas en funciones: con
 *   `invalidateOnRefresh` todo se recalcula al cambiar el tamaño de la ventana.
 * - Carga progresiva: una escena recibe `data-armed` (y recién ahí se descarga su foto) cuando el scroll se acerca.
 * - Al activar el modo fijado se compensa el scroll si la página ya estaba más abajo (recarga a mitad de página).
 * - Foco con teclado dentro de una escena que no está a la vista → se lleva el scroll hasta esa escena.
 * - Limpieza total con `gsap.matchMedia`: al salir de desktop, al pasar a movimiento reducido o al desmontar se
 *   revierten tweens y ScrollTriggers, se quitan listeners, timers y atributos, y la portada vuelve al modo flujo.
 */

type Rect = { x: number; y: number; w: number; h: number };
type Aperture = Rect & { shape: "rect" | "arch" };
type Vars = Record<string, unknown>;

/** Unidades de la línea de tiempo → alto de scroll (svh). ~13 unidades ≈ 440 svh. */
const SVH_PER_UNIT = 33;
const HOLD_START = 0.3;
const HOLD = 0.65;
const HOLD_END = 0.9;
/** Losa entre fotos apiladas de una escena vertical: 112 % (journey.css). */
const REEL_STEP = 112;
/** Cuánto antes de su entrada se habilita (y descarga) una escena, en unidades. */
const LOOKAHEAD = 1.2;
/** Radio de las esquinas del encuadre final. */
const R = 2;

const MQ = `${DESKTOP_MQ} and ${FINE_POINTER_MQ} and (prefers-reduced-motion: no-preference)`;

function offsetRect(el: HTMLElement, stage: HTMLElement): Rect {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== stage) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

function parseAperture(el: Element | null): Aperture | null {
  const raw = el?.getAttribute("data-aperture");
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Aperture;
    return [a.x, a.y, a.w, a.h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) ? a : null;
  } catch {
    return null;
  }
}

/** Posición de la abertura en el escenario, con la foto recortada como `object-fit: cover` en `box`. */
function apertureRect(box: Rect, natural: { w: number; h: number }, focal: { x: number; y: number }, a: Aperture): Rect {
  const s = Math.max(box.w / natural.w, box.h / natural.h);
  const rw = natural.w * s;
  const rh = natural.h * s;
  const ox = box.x + (box.w - rw) * (focal.x / 100);
  const oy = box.y + (box.h - rh) * (focal.y / 100);
  return { x: ox + a.x * rw, y: oy + a.y * rh, w: a.w * rw, h: a.h * rh };
}

function objectPosition(img: HTMLElement | null): { x: number; y: number } {
  if (!img) return { x: 50, y: 50 };
  const [x = "50%", y = "50%"] = getComputedStyle(img).objectPosition.split(" ");
  const pct = (v: string) => (v.endsWith("%") ? clamp(parseFloat(v), 0, 100) : 50);
  return { x: pct(x), y: pct(y) };
}

const scaleRect = (r: Rect, s: number): Rect => ({ x: r.x + r.w / 2 - (r.w * s) / 2, y: r.y + r.h / 2 - (r.h * s) / 2, w: r.w * s, h: r.h * s });
const px = (n: number) => `${n.toFixed(2)}px`;

type Scene = {
  li: HTMLElement;
  transition: string;
  close: boolean;
  clip: HTMLElement;
  frame: HTMLElement;
  reel: HTMLElement | null;
  inners: HTMLElement[];
  shade: HTMLElement | null;
  caption: HTMLElement | null;
  rule: HTMLElement | null;
  num: HTMLElement | null;
  slab: HTMLElement | null;
  levels: HTMLElement[];
  lastMedia: HTMLElement | null;
};

/** Lo que una escena "anterior" ofrece a la siguiente: el nodo a acercar, su abertura y cómo desaparecer. */
type Previous = {
  zoom: HTMLElement;
  zoomRect: () => Rect;
  frameRect: () => Rect;
  aperture: () => Rect | null;
  shade: HTMLElement | null;
  hide: HTMLElement;
  captionOut: (at: number) => void;
};

export function initJourney(engine: Engine): () => void {
  const root = document.querySelector<HTMLElement>("[data-journey]");
  if (!root) return noop;
  const mm = engine.gsap.matchMedia();
  let started = false;
  // Las escenas son una isla cliente diferida: si todavía no llegaron, se arma cuando avisan (HeroScenes).
  const start = () => {
    if (started || !root.querySelector("[data-jr-scene]")) return;
    started = true;
    mm.add(MQ, () => buildJourney(engine, root));
    markScrollTriggers(engine);
  };
  start();
  if (!started) window.addEventListener("journey:scenes", start);
  const stopKeeping = keepTargetsBelow(engine, root);
  return () => {
    window.removeEventListener("journey:scenes", start);
    stopKeeping();
    mm.revert();
  };
}

/**
 * El recorrido cambia de alto cuando llegan las escenas y al pasar a/desde el modo fijado (y ScrollTrigger recalcula).
 * Si eso ocurre durante el scroll suave hacia un ancla de la misma página («Quiero vender mi propiedad», «Saltar
 * recorrido»), se vuelve a apuntar al elemento (smooth-scroll.ts → reaimAnchor) para que el scroll termine donde el
 * usuario pidió. Cualquier gesto propio (rueda, touch, tecla) cancela la corrección.
 */
function keepTargetsBelow({ ScrollTrigger }: Engine, root: HTMLElement): () => void {
  let height = root.offsetHeight;
  const ro =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          const next = root.offsetHeight;
          if (Math.abs(next - height) < 1) return;
          height = next;
          reaimAnchor();
        });
  ro?.observe(root);
  ScrollTrigger.addEventListener("refresh", reaimAnchor);
  return () => {
    ro?.disconnect();
    ScrollTrigger.removeEventListener("refresh", reaimAnchor);
  };
}

/** Diagnóstico (QA/e2e): disparadores vivos en el documento. Volver a una ruta no debe duplicarlos. */
export function markScrollTriggers({ ScrollTrigger }: Engine): void {
  document.documentElement.setAttribute("data-scroll-triggers", String(ScrollTrigger.getAll().length));
}

function buildJourney({ gsap, ScrollTrigger, lenis }: Engine, root: HTMLElement): () => void {
  const stage = root.querySelector<HTMLElement>("[data-jr-stage]");
  const cover = root.querySelector<HTMLElement>("[data-jr-cover]");
  const plate = root.querySelector<HTMLElement>("[data-cover-plate]");
  const lis = Array.from(root.querySelectorAll<HTMLElement>("[data-jr-scene]"));
  if (!stage || !cover || !plate || !lis.length) return noop;

  const q = <T extends HTMLElement>(el: ParentNode, sel: string) => el.querySelector<T>(sel);
  const scenes: Scene[] = lis.map((li) => {
    const inners = Array.from(li.querySelectorAll<HTMLElement>("[data-jr-media-inner]"));
    const medias = li.querySelectorAll<HTMLElement>("[data-jr-media]");
    return {
      li,
      transition: li.dataset.transition ?? "widen",
      close: li.dataset.frame === "close",
      clip: q<HTMLElement>(li, "[data-jr-clip]")!,
      frame: q<HTMLElement>(li, "[data-jr-frame]")!,
      reel: q<HTMLElement>(li, "[data-jr-reel]"),
      inners,
      shade: q<HTMLElement>(li, "[data-jr-shade]"),
      caption: q<HTMLElement>(li, "[data-jr-caption]"),
      rule: q<HTMLElement>(li, "[data-jr-rule]"),
      num: q<HTMLElement>(li, "[data-jr-num]"),
      slab: q<HTMLElement>(li, "[data-jr-slab]"),
      levels: Array.from(li.querySelectorAll<HTMLElement>("[data-jr-level]")),
      lastMedia: medias[medias.length - 1] ?? null,
    };
  });
  if (scenes.some((s) => !s.clip || !s.frame)) return noop;

  // ── Modo fijado sin salto visible: si la página ya estaba debajo del recorrido, se compensa el cambio de alto.
  const next = root.nextElementSibling;
  const y0 = window.scrollY;
  const nextTopBefore = next?.getBoundingClientRect().top ?? 0;
  // Con un scroll suave en curso (un ancla) no se salta: keepTargetsBelow corrige su destino.
  const pastHero = y0 > 0 && nextTopBefore <= window.innerHeight && lenis.isScrolling !== "smooth";
  root.style.setProperty("--jr-track", `${(estimateUnits(scenes) * SVH_PER_UNIT).toFixed(1)}svh`);
  root.setAttribute("data-pinned", "");
  root.setAttribute("data-active-index", "0");
  if (pastHero && next) {
    const delta = next.getBoundingClientRect().top - nextTopBefore;
    if (Math.abs(delta) > 1) {
      const target = window.scrollY + delta;
      window.scrollTo(0, target);
      lenis.resize();
      lenis.scrollTo(target, { immediate: true, force: true });
    }
  }

  const W = () => stage.clientWidth;
  const H = () => stage.clientHeight;
  // clip-path se interpola sobre un objeto (no como texto): el navegador normaliza `inset(... round 0px)` y GSAP
  // compararía cadenas con distinta cantidad de números. `rt` = radio de las esquinas superiores (arco), `rb` inferiores.
  type Box = { t: number; r: number; b: number; l: number; rt: number; rb: number };
  const box = (rect: Rect, rt = 0, rb = 0): Box => ({ t: rect.y, r: W() - rect.x - rect.w, b: H() - rect.y - rect.h, l: rect.x, rt, rb });
  const archTop = (rect: Rect, a: Aperture | null) => (a?.shape === "arch" ? rect.w / 2 : 0);
  const clipBoxes = new Map<HTMLElement, Box>();
  const lastClip = new Map<HTMLElement, string>();
  // Se aplica desde el onUpdate de la línea y tras cada refresh (ScrollTrigger renderiza sin eventos al recalcular).
  const applyClips = () =>
    clipBoxes.forEach((v, el) => {
      const value = `inset(${px(v.t)} ${px(v.r)} ${px(v.b)} ${px(v.l)} round ${px(v.rt)} ${px(v.rt)} ${px(v.rb)} ${px(v.rb)})`;
      if (lastClip.get(el) === value) return;
      lastClip.set(el, value);
      el.style.clipPath = value;
    });
  const KEYS = ["t", "r", "b", "l", "rt", "rb"] as const;
  let onToggle = noop;
  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: root, start: "top top", end: "bottom bottom", scrub: 0.7, invalidateOnRefresh: true, onToggle: () => onToggle() },
  });

  // Primer tween de cada (nodo, propiedad) fija su estado inicial; los siguientes no (immediateRender: false).
  const used = new WeakMap<object, Set<string>>();
  const META = new Set(["duration", "ease", "transformOrigin", "immediateRender"]);
  const tween = (el: object | null, from: Vars, to: Vars, at: number) => {
    if (!el) return;
    const props = Object.keys(to).filter((k) => !META.has(k));
    const seen = used.get(el) ?? new Set<string>();
    const first = props.every((p) => !seen.has(p));
    props.forEach((p) => seen.add(p));
    used.set(el, seen);
    tl.fromTo(el, from, { ...to, immediateRender: first }, at);
  };

  const clipTween = (el: HTMLElement, from: () => Box, to: () => Box, vars: Vars, at: number) => {
    const proxy = clipBoxes.get(el) ?? { t: 0, r: 0, b: 0, l: 0, rt: 0, rb: 0 };
    clipBoxes.set(el, proxy);
    const pick = (fn: () => Box) => Object.fromEntries(KEYS.map((k) => [k, () => fn()[k]]));
    tween(proxy, pick(from), { ...pick(to), ...vars }, at);
  };

  const captionIn = (s: Scene, at: number) => {
    tween(s.caption, { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, at);
    tween(s.rule, { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power2.inOut" }, at + 0.05);
    tween(s.num, { opacity: 0, yPercent: 18 }, { opacity: 1, yPercent: 0, duration: 0.8, ease: "power2.out" }, at - 0.2);
  };
  const captionOut = (s: Scene, at: number) => {
    tween(s.caption, { opacity: 1, y: 0 }, { opacity: 0, y: -40, duration: 0.35, ease: "power1.in" }, at);
    tween(s.num, { opacity: 1, yPercent: 0 }, { opacity: 0, yPercent: -18, duration: 0.5, ease: "power1.in" }, at);
  };

  const depth = q<HTMLElement>(plate, ".cover-depth") ?? plate;
  const coverImg = q<HTMLElement>(plate, "img");
  const coverAperture = parseAperture(plate);
  const coverNatural = { w: Number(plate.dataset.width) || 1200, h: Number(plate.dataset.height) || 1600 };
  const copy = q<HTMLElement>(cover, "[data-cover-copy]");
  const search = q<HTMLElement>(cover, "[data-cover-search]");
  const ghost = q<HTMLElement>(cover, "[data-cover-ghost]");

  let prev: Previous = {
    zoom: plate,
    zoomRect: () => offsetRect(plate, stage),
    frameRect: () => offsetRect(plate, stage),
    aperture: () => (coverAperture ? apertureRect(offsetRect(depth, stage), coverNatural, objectPosition(coverImg), coverAperture) : null),
    shade: q<HTMLElement>(plate, "[data-jr-shade]"),
    hide: cover,
    captionOut: (at) => {
      tween(copy, { opacity: 1, y: 0 }, { opacity: 0, y: -70, duration: 0.5, ease: "power1.in" }, at);
      tween(search, { opacity: 1, y: 0 }, { opacity: 0, y: 50, duration: 0.42, ease: "power1.in" }, at);
      tween(ghost, { opacity: 1, xPercent: 0 }, { opacity: 0, xPercent: -12, duration: 1, ease: "power1.inOut" }, at);
    },
  };
  let prevAperture: Aperture | null = coverAperture;

  const marks: number[] = [0];
  const entries: number[] = [0];
  /** Momento en que cada escena queda completa (texto incluido): destino del foco con teclado. */
  const settled: number[] = [0];
  const levelSwitch = new Map<Scene, number>();
  let paperAt = Number.POSITIVE_INFINITY;
  let t = HOLD_START;

  scenes.forEach((s, idx) => {
    const P = prev;
    const at = t;
    const frameRect = () => offsetRect(s.frame, stage);
    const entryRect = () => (s.close ? P.frameRect() : frameRect());
    const inner0 = s.inners[0] ?? null;
    entries.push(at);
    let dur = 0;

    tween(s.clip, { opacity: 0 }, { opacity: 1, duration: s.transition === "dusk" ? 1 : 0.05, ease: "sine.inOut" }, at);
    if (s.close) {
      const flip = () => {
        const from = P.frameRect();
        const to = frameRect();
        return { x: from.x - to.x, y: from.y - to.y, scale: from.w / to.w };
      };
      tween(s.frame, { x: () => flip().x, y: () => flip().y, scale: () => flip().scale, transformOrigin: "0 0" }, { x: () => flip().x, y: () => flip().y, scale: () => flip().scale, transformOrigin: "0 0", duration: 0.01 }, at);
    }

    if (s.transition === "through" && prevAperture) {
      const A = 0.55;
      const B = 0.7;
      const pa = prevAperture;
      const ap = () => P.aperture() ?? scaleRect(entryRect(), 0.1);
      const s1 = () => clamp(Math.min(entryRect().w / ap().w, entryRect().h / ap().h) * 0.4, 1.5, 3.2);
      const origin = () => {
        const r = ap();
        const z = P.zoomRect();
        return `${px(r.x + r.w / 2 - z.x)} ${px(r.y + r.h / 2 - z.y)}`;
      };
      tween(P.zoom, { scale: 1, transformOrigin: origin }, { scale: s1, transformOrigin: origin, duration: A, ease: "power1.in" }, at);
      const scaled = () => scaleRect(ap(), s1());
      clipTween(s.clip, () => box(ap(), archTop(ap(), pa)), () => box(scaled(), archTop(scaled(), pa)), { duration: A, ease: "power1.in" }, at);
      tween(P.zoom, { scale: s1, transformOrigin: origin }, { scale: () => s1() * 1.6, transformOrigin: origin, duration: B, ease: "power2.out" }, at + A);
      clipTween(s.clip, () => box(scaled(), archTop(scaled(), pa)), () => box(entryRect(), R, R), { duration: B, ease: "power2.inOut" }, at + A);
      tween(P.shade, { opacity: 0 }, { opacity: 0.9, duration: A + B * 0.6, ease: "power1.in" }, at);
      tween(inner0, { scale: 1.3 }, { scale: 1.06, duration: A + B + 0.2, ease: "power2.out" }, at);
      tween(P.hide, { opacity: 1 }, { opacity: 0, duration: 0.02 }, at + A + B);
      P.captionOut(at);
      dur = A + B;
    } else if (s.transition === "rise") {
      const E = 1;
      const C = 1.4;
      tween(P.hide, { y: 0 }, { y: () => -H() * 0.5, duration: E, ease: "power2.in" }, at);
      tween(P.hide, { opacity: 1 }, { opacity: 0, duration: E * 0.6, ease: "power1.in" }, at + E * 0.1);
      clipTween(s.clip, () => box({ ...frameRect(), y: frameRect().y + frameRect().h, h: 0 }), () => box(frameRect(), R, R), { duration: E, ease: "power2.inOut" }, at);
      tween(inner0, { scale: 1.25 }, { scale: 1.06, duration: E + 0.3, ease: "power2.out" }, at);
      P.captionOut(at);
      dur = E;
      const stops = s.inners.length - 1;
      if (stops > 0 && s.reel) {
        const climb = at + E + 0.25;
        tween(s.reel, { yPercent: 0 }, { yPercent: -REEL_STEP * stops, duration: C * stops, ease: "power2.inOut" }, climb);
        tween(s.inners[stops] ?? null, { scale: 1.2 }, { scale: 1.06, duration: C * stops, ease: "power1.out" }, climb);
        tween(s.slab, { opacity: 0, y: () => H() * 0.42 }, { opacity: 1, y: () => -H() * 0.04, duration: C * stops * 0.55, ease: "power1.inOut" }, climb);
        tween(s.slab, { opacity: 1, y: () => -H() * 0.04 }, { opacity: 0, y: () => -H() * 0.48, duration: C * stops * 0.45, ease: "power1.in" }, climb + C * stops * 0.55);
        levelSwitch.set(s, climb + C * stops * 0.55);
        dur = E + 0.25 + C * stops;
      }
    } else if (s.transition === "dusk") {
      const E = 1;
      tween(inner0, { scale: 1.1 }, { scale: 1.06, duration: E + 1, ease: "power1.out" }, at);
      tween(P.hide, { opacity: 1 }, { opacity: 0, duration: 0.02 }, at + E);
      P.captionOut(at);
      dur = E;
    } else {
      // widen (y respaldo de `through` sin abertura)
      const E = 1.1;
      const slit = () => {
        const f = entryRect();
        return box({ x: f.x + f.w * 0.46, y: f.y + f.h * 0.06, w: f.w * 0.08, h: f.h * 0.88 });
      };
      clipTween(s.clip, slit, () => box(entryRect(), R, R), { duration: E, ease: "power3.inOut" }, at);
      tween(inner0, { scale: 1.3 }, { scale: 1.06, duration: E + 0.2, ease: "power2.out" }, at);
      tween(P.zoom, { scale: 1 }, { scale: 0.9, duration: E, ease: "power2.inOut" }, at);
      tween(P.hide, { opacity: 1 }, { opacity: 0, duration: E * 0.4, ease: "power1.in" }, at + E * 0.6);
      P.captionOut(at);
      dur = E;
    }

    if (s.close) {
      // La vista se asienta en su composición final sobre papel: la primera hoja del home.
      const S = 1.25;
      const settle = at + dur + 0.15;
      const flip = () => {
        const from = P.frameRect();
        const to = frameRect();
        return { x: from.x - to.x, y: from.y - to.y, scale: from.w / to.w };
      };
      if (s.transition !== "dusk") clipTween(s.clip, () => box(entryRect(), R, R), () => box({ x: 0, y: 0, w: W(), h: H() }), { duration: 0.01 }, settle - 0.01);
      tween(s.frame, { x: () => flip().x, y: () => flip().y, scale: () => flip().scale, transformOrigin: "0 0" }, { x: 0, y: 0, scale: 1, transformOrigin: "0 0", duration: S, ease: "power3.inOut" }, settle);
      // El papel nace detrás de la foto (mismo rectángulo) y se abre hasta los bordes mientras la foto se asienta.
      const paper = root.querySelector<HTMLElement>("[data-jr-paper]");
      if (paper) {
        tween(paper, { opacity: 0 }, { opacity: 1, duration: 0.01 }, settle);
        clipTween(paper, () => box(P.frameRect()), () => box({ x: 0, y: 0, w: W(), h: H() }), { duration: S * 0.9, ease: "power2.inOut" }, settle);
      }
      paperAt = settle + S * 0.45;
      captionIn(s, settle + S * 0.6);
      marks.push(settle);
      dur = dur + 0.15 + S;
    } else {
      captionIn(s, at + dur * 0.55);
      marks.push(at + dur * 0.5);
    }
    settled.push(at + dur + 0.05);
    // Profundidad mientras se lee: la foto baja apenas y el texto sube (velocidades distintas).
    tween(inner0, { yPercent: 2 }, { yPercent: -2, duration: dur + HOLD, ease: "none" }, at + dur * 0.4);

    const frame = s.frame;
    prevAperture = parseAperture(s.lastMedia);
    const lastImg = s.lastMedia ? q<HTMLElement>(s.lastMedia, "img") : null;
    const natural = { w: Number(s.lastMedia?.dataset.width) || 4, h: Number(s.lastMedia?.dataset.height) || 3 };
    const parsed = prevAperture;
    prev = {
      zoom: frame,
      zoomRect: () => offsetRect(frame, stage),
      frameRect: () => offsetRect(frame, stage),
      // Al terminar una escena vertical su última foto ocupa el encuadre: la abertura se mide sobre el encuadre.
      aperture: () => (parsed ? apertureRect(offsetRect(frame, stage), natural, objectPosition(lastImg), parsed) : null),
      shade: s.shade,
      hide: s.clip,
      captionOut: (a) => captionOut(s, a),
    };
    t = at + dur + (idx === scenes.length - 1 ? HOLD_END : HOLD);
  });
  tl.to({}, { duration: 0.001 }, t);
  root.style.setProperty("--jr-track", `${(tl.duration() * SVH_PER_UNIT).toFixed(1)}svh`);

  // ── Estado derivado del tiempo de la línea (no del scroll crudo: respeta el scrub)
  const fill = root.querySelector<HTMLElement>("[data-jr-fill]");
  const count = root.querySelector<HTMLElement>("[data-jr-count]");
  const name = root.querySelector<HTMLElement>("[data-jr-name]");
  const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-jr-step]"));
  const labels = steps.map((st) => st.textContent ?? "");
  let active = -1;
  let tone = "";
  let headerDark = false;
  const sync = () => {
    applyClips();
    const time = tl.time();
    let now = 0;
    marks.forEach((m, i) => {
      if (time >= m) now = i;
    });
    if (now !== active) {
      active = now;
      root.setAttribute("data-active-index", String(now));
      scenes.forEach((s, i) => s.li.toggleAttribute("data-active", i + 1 === now));
      if (count) count.textContent = String(now + 1).padStart(2, "0");
      if (name) name.textContent = labels[now] ?? "";
      steps.forEach((st, i) => (i === now ? st.setAttribute("aria-current", "step") : st.removeAttribute("aria-current")));
    }
    scenes.forEach((s, i) => {
      if (!s.li.hasAttribute("data-armed") && time >= entries[i + 1]! - LOOKAHEAD) s.li.setAttribute("data-armed", "");
      const sw = levelSwitch.get(s);
      if (sw !== undefined) s.levels.forEach((l, li) => l.toggleAttribute("data-on", li === (time >= sw ? s.levels.length - 1 : 0)));
    });
    // Cabecera transparente mientras el recorrido está oscuro y en pantalla.
    const st = tl.scrollTrigger;
    const dark = Boolean(st?.isActive) && time < paperAt;
    if (dark !== headerDark) {
      headerDark = dark;
      if (dark) document.documentElement.setAttribute("data-jr-header", "dark");
      else document.documentElement.removeAttribute("data-jr-header");
    }
    const nextTone = time >= paperAt ? "paper" : "";
    if (nextTone !== tone) {
      tone = nextTone;
      if (tone) root.setAttribute("data-tone", tone);
      else root.removeAttribute("data-tone");
    }
    if (fill) fill.style.transform = `scaleY(${tl.progress().toFixed(4)})`;
  };
  tl.eventCallback("onUpdate", sync);
  onToggle = sync;
  sync();

  // ── Foco con teclado: la escena del control enfocado se trae a la vista.
  const timeOf = (index: number) => (index === 0 ? 0 : Math.min(tl.duration(), settled[index] ?? 0));
  const onFocusIn = (e: FocusEvent) => {
    const el = e.target;
    if (!(el instanceof Element) || !el.matches(":focus-visible")) return;
    const li = el.closest<HTMLElement>("[data-jr-scene]");
    const index = li ? lis.indexOf(li) + 1 : el.closest("[data-jr-cover]") ? 0 : -1;
    const st = tl.scrollTrigger;
    if (index < 0 || index === active || !st) return;
    const y = st.start + (st.end - st.start) * (timeOf(index) / tl.duration());
    lenis.scrollTo(y, { immediate: true, force: true });
  };
  root.addEventListener("focusin", onFocusIn);

  // ── Fotos y fuentes cambian medidas: recalcular (con pausa, fuera de ráfagas de carga).
  let refreshTimer = 0;
  const onLoad = (e: Event) => {
    if (!(e.target instanceof HTMLImageElement)) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 500);
  };
  root.addEventListener("load", onLoad, true);
  ScrollTrigger.addEventListener("refresh", sync);
  ScrollTrigger.refresh();

  return () => {
    window.clearTimeout(refreshTimer);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("load", onLoad, true);
    ScrollTrigger.removeEventListener("refresh", sync);
    tl.eventCallback("onUpdate", null);
    document.documentElement.removeAttribute("data-jr-header");
    for (const attr of ["data-pinned", "data-active-index", "data-tone"]) root.removeAttribute(attr);
    root.style.removeProperty("--jr-track");
    for (const s of scenes) {
      // `data-armed` queda: la foto ya está descargada.
      s.li.removeAttribute("data-active");
      s.levels.forEach((l) => l.removeAttribute("data-on"));
    }
    clipBoxes.forEach((_, el) => el.style.removeProperty("clip-path"));
    if (fill) fill.style.transform = "";
    if (count) count.textContent = "01";
    if (name) name.textContent = labels[0] ?? "";
    steps.forEach((st, i) => (i === 0 ? st.setAttribute("aria-current", "step") : st.removeAttribute("aria-current")));
  };
}

/** Duración total aproximada (unidades) para reservar el alto del recorrido antes de armar la línea de tiempo. */
function estimateUnits(scenes: Scene[]): number {
  let u = HOLD_START;
  scenes.forEach((s, i) => {
    const stops = Math.max(0, s.inners.length - 1);
    const entry = s.transition === "through" ? 1.25 : s.transition === "rise" ? 1 + (stops ? 0.25 + 1.4 * stops : 0) : s.transition === "dusk" ? 1 : 1.1;
    u += entry + (s.close ? 1.4 : 0) + (i === scenes.length - 1 ? HOLD_END : HOLD);
  });
  return u;
}
