import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clampPitch,
  externalTourDisplay,
  guidedSequence,
  guidedStartIndex,
  guidedStep,
  isEmbeddableUrl,
  isEquirectangular,
  mediaTabs,
  normalizeYaw,
  parseHttpsUrl,
  tourPublishBlockers,
  type GraphTour,
} from "@/server/tours/model";
import { manifestFiles, parseTourManifest } from "@/server/tours/manifest";

const PI = Math.PI;

describe("ángulos", () => {
  it("normaliza yaw a (−π, π]", () => {
    expect(normalizeYaw(0)).toBe(0);
    expect(normalizeYaw(PI)).toBeCloseTo(PI);
    expect(normalizeYaw(-PI)).toBeCloseTo(PI);
    expect(normalizeYaw(3 * PI)).toBeCloseTo(PI);
    expect(normalizeYaw(2 * PI + 0.5)).toBeCloseTo(0.5);
    expect(normalizeYaw(-2 * PI - 0.5)).toBeCloseTo(-0.5);
    expect(normalizeYaw(1.5 * PI)).toBeCloseTo(-0.5 * PI);
    expect(normalizeYaw(Number.NaN)).toBe(0);
    for (let v = -20; v <= 20; v += 0.37) {
      const y = normalizeYaw(v);
      expect(y > -PI && y <= PI).toBe(true);
    }
  });
  it("limita pitch a [−π/2, π/2]", () => {
    expect(clampPitch(2)).toBeCloseTo(PI / 2);
    expect(clampPitch(-2)).toBeCloseTo(-PI / 2);
    expect(clampPitch(0.3)).toBe(0.3);
    expect(clampPitch(Number.POSITIVE_INFINITY)).toBe(0);
  });
  it("equirectangular 2:1 con tolerancia de 1 %", () => {
    expect(isEquirectangular(8192, 4096)).toBe(true);
    expect(isEquirectangular(6080, 3040)).toBe(true);
    expect(isEquirectangular(8192, 4100)).toBe(true); // 1,998
    expect(isEquirectangular(8000, 4096)).toBe(false); // 1,95
    expect(isEquirectangular(4096, 4096)).toBe(false);
    expect(isEquirectangular(0, 0)).toBe(false);
  });
});

describe("tours externos: allowlist", () => {
  it("embebe solo https con host exacto del proveedor", () => {
    expect(isEmbeddableUrl("matterport", "https://my.matterport.com/show/?m=abc123")).toBe(true);
    expect(isEmbeddableUrl("kuula", "https://kuula.co/share/collection/7abc")).toBe(true);
    expect(isEmbeddableUrl("3dvista", "https://storage.net-fs.com/hosting/123/tour/index.htm")).toBe(true);
  });
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["http", "http://my.matterport.com/show/?m=abc"],
    ["sufijo engañoso", "https://kuula.co.evil.com/share/x"],
    ["prefijo engañoso", "https://evilkuula.co/share/x"],
    ["subdominio no listado", "https://evil.kuula.co/share/x"],
    ["credenciales", "https://user:pass@kuula.co/share/x"],
    ["puerto raro", "https://kuula.co:8443/share/x"],
    ["host de otro proveedor", "https://my.matterport.com/show/?m=abc"],
    ["espacios", "https://kuula.co/share/ x"],
    ["relativa", "/share/x"],
  ])("rechaza %s", (_, url) => {
    expect(isEmbeddableUrl("kuula", url)).toBe(false);
  });
  it("proveedor «otro» nunca se embebe: enlace en pestaña nueva", () => {
    expect(isEmbeddableUrl("other", "https://kuula.co/share/x")).toBe(false);
    expect(externalTourDisplay("other", "https://tours.ejemplo.com/casa", null)).toEqual({ mode: "link", href: "https://tours.ejemplo.com/casa" });
  });
  it("host fuera de la lista → enlace; URL no https → nada", () => {
    expect(externalTourDisplay("matterport", "https://matterport.com.evil.com/x", null)).toEqual({ mode: "link", href: "https://matterport.com.evil.com/x" });
    expect(externalTourDisplay("matterport", "javascript:alert(1)", "https://my.matterport.com/show/?m=1")).toBeNull();
    expect(externalTourDisplay("matterport", "https://my.matterport.com/show/?m=1", "https://evil.com/embed")).toEqual({ mode: "link", href: "https://my.matterport.com/show/?m=1" });
    expect(externalTourDisplay("matterport", "https://my.matterport.com/show/?m=1", null)).toEqual({ mode: "embed", src: "https://my.matterport.com/show/?m=1", href: "https://my.matterport.com/show/?m=1" });
  });
  it("parseHttpsUrl", () => {
    expect(parseHttpsUrl("https://kuula.co/x")?.hostname).toBe("kuula.co");
    expect(parseHttpsUrl("https://localhost/x")).toBeNull();
    expect(parseHttpsUrl("ftp://kuula.co/x")).toBeNull();
    expect(parseHttpsUrl(`https://kuula.co/${"a".repeat(2100)}`)).toBeNull();
  });
});

describe("grafo y publicación", () => {
  const scene = (id: string, isPublished = true, hotspots: GraphTour["scenes"][number]["hotspots"] = []) => ({ id, name: id.toUpperCase(), isPublished, hotspots });
  const base = (over: Partial<GraphTour> = {}): GraphTour => ({
    kind: "internal",
    startSceneId: "a",
    guidedSceneIds: ["a", "b"],
    scenes: [scene("a", true, [{ kind: "scene", targetSceneId: "b", label: "Ir a B" }, { kind: "info", targetSceneId: null, label: "Dato" }]), scene("b", true, [{ kind: "scene", targetSceneId: "a", label: "Volver" }])],
    ...over,
  });
  it("un tour completo es publicable", () => {
    expect(tourPublishBlockers(base())).toEqual([]);
  });
  it("sin escenas publicadas ni escena inicial", () => {
    expect(tourPublishBlockers(base({ scenes: [], startSceneId: null, guidedSceneIds: [] }))).toEqual(["Falta al menos una escena publicada", "Elegí la escena inicial"]);
  });
  it("escena inicial oculta", () => {
    const t = base();
    t.scenes[0]!.isPublished = false;
    expect(tourPublishBlockers(t)).toContain("La escena inicial está oculta");
  });
  it("destino inexistente u oculto y guiado inválido", () => {
    const t = base({ guidedSceneIds: ["a", "zzz", "b"] });
    t.scenes[0]!.hotspots.push({ kind: "scene", targetSceneId: "nope", label: "Roto" });
    t.scenes[1]!.isPublished = false;
    const b = tourPublishBlockers(t);
    expect(b).toContain("«A»: el punto «Roto» no tiene un destino válido");
    expect(b).toContain("«A»: el punto «Ir a B» lleva a «B», que está oculta");
    expect(b).toContain("El recorrido guiado incluye una escena que ya no existe");
    expect(b).toContain("El recorrido guiado incluye «B», que está oculta");
  });
  it("puntos de una escena oculta no bloquean (no se muestran)", () => {
    const t = base({ guidedSceneIds: ["a"] });
    t.scenes.push(scene("c", false, [{ kind: "scene", targetSceneId: "nope", label: "X" }]));
    expect(tourPublishBlockers(t)).toEqual([]);
  });
  it("externo: proveedor y https", () => {
    expect(tourPublishBlockers({ kind: "external", provider: "kuula", externalUrl: "https://kuula.co/share/x", embedUrl: null, startSceneId: null, guidedSceneIds: [], scenes: [] })).toEqual([]);
    expect(tourPublishBlockers({ kind: "external", provider: "kuula", externalUrl: "http://kuula.co/share/x", embedUrl: "javascript:x", startSceneId: null, guidedSceneIds: [], scenes: [] })).toHaveLength(2);
  });
});

describe("recorrido guiado", () => {
  const scenes = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("secuencia: solo escenas presentes, sin repetidas; vacía → orden de escenas", () => {
    expect(guidedSequence(["c", "x", "a", "c"], scenes)).toEqual(["c", "a"]);
    expect(guidedSequence([], scenes)).toEqual(["a", "b", "c"]);
  });
  it("pasos con límites y etiqueta n de N", () => {
    const seq = ["a", "b", "c"];
    expect(guidedStep(seq, 0)).toEqual({ index: 0, total: 3, sceneId: "a", hasPrev: false, hasNext: true, label: "1 de 3" });
    expect(guidedStep(seq, 2)?.hasNext).toBe(false);
    expect(guidedStep(seq, 9)?.index).toBe(2);
    expect(guidedStep(seq, -4)?.index).toBe(0);
    expect(guidedStep([], 0)).toBeNull();
  });
  it("arranca en la escena actual si está en la secuencia", () => {
    expect(guidedStartIndex(["a", "b", "c"], "b")).toBe(1);
    expect(guidedStartIndex(["a", "b", "c"], "z")).toBe(0);
  });
});

describe("pestañas de medios", () => {
  const base = { flagEnabled: true, hasTour: true, photoCount: 10, floorPlanCount: 0, tourHasFloorPlan: false, videoCount: 0 };
  it("sin tour o con el flag apagado no hay pestañas (ficha igual que antes)", () => {
    expect(mediaTabs({ ...base, hasTour: false, floorPlanCount: 2, videoCount: 1 })).toEqual([]);
    expect(mediaTabs({ ...base, flagEnabled: false })).toEqual([]);
  });
  it("solo las disponibles, en orden", () => {
    expect(mediaTabs(base)).toEqual(["fotos", "tour"]);
    expect(mediaTabs({ ...base, tourHasFloorPlan: true, videoCount: 1 })).toEqual(["fotos", "tour", "plano", "video"]);
    expect(mediaTabs({ ...base, photoCount: 0, floorPlanCount: 1 })).toEqual(["tour", "plano"]);
  });
});

describe("manifiesto del tour demo", () => {
  const dir = resolve(import.meta.dirname, "../../public/tours/demo/residencia");
  const real = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8"));

  it("el manifiesto versionado es válido y referencia 9 escenas con sus archivos", () => {
    const r = parseTourManifest(real);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.scenes.map((s) => s.slug)).toEqual(["entrada", "living", "cocina", "comedor", "pasillo", "dormitorio", "bano", "galeria", "piscina"]);
    expect(manifestFiles(r.manifest)).toHaveLength(2 + 9 * 3);
  });
  it("el grafo pedido: conexiones de ida y vuelta", () => {
    const r = parseTourManifest(real);
    if (!r.ok) throw new Error("manifiesto inválido");
    const edges = new Set(r.manifest.scenes.flatMap((s) => s.hotspots.flatMap((h) => (h.type === "scene" ? [`${s.slug}>${h.target}`] : []))));
    for (const [a, b] of [["entrada", "living"], ["living", "cocina"], ["living", "comedor"], ["living", "pasillo"], ["pasillo", "dormitorio"], ["dormitorio", "bano"], ["living", "galeria"], ["galeria", "piscina"]]) {
      expect(edges.has(`${a}>${b}`)).toBe(true);
      expect(edges.has(`${b}>${a}`)).toBe(true);
    }
  });
  const clone = () => JSON.parse(JSON.stringify(real));
  it("rechaza slugs repetidos, destinos inexistentes, 2:1 inválido y ángulos fuera de rango", () => {
    const m = clone();
    m.scenes[1].slug = "entrada";
    m.scenes[2].hotspots[0].target = "altillo";
    m.scenes[3].height = 1500;
    m.scenes[4].initialYaw = 4;
    m.scenes[5].hotspots[0].pitch = 2;
    m.tour.guided.push("sotano");
    m.tour.startScene = "terraza";
    const r = parseTourManifest(m);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const all = r.errors.join("\n");
    expect(all).toMatch(/Slug repetido: entrada/);
    expect(all).toMatch(/escena inexistente: altillo/);
    expect(all).toMatch(/no es 2:1/);
    expect(all).toMatch(/yaw fuera de/);
    expect(all).toMatch(/pitch fuera de/);
    expect(all).toMatch(/Recorrido guiado con escena inexistente: sotano/);
    expect(all).toMatch(/Escena inicial inexistente: terraza/);
  });
  it("rechaza rutas en nombres de archivo y campos desconocidos", () => {
    const m = clone();
    m.scenes[0].panorama = "../../secreto.jpg";
    m.scenes[0].extra = true;
    expect(parseTourManifest(m).ok).toBe(false);
  });
});
