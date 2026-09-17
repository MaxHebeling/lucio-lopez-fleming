/** Guía del Tour 360°: BFS sobre el grafo real de la demo, sinónimos, parser de intención y respuestas sin inventar. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { answerTourQuestion, buildTourFacts, describeRoute, findRoute, NOT_REGISTERED, parseTourQuestion, withArticle } from "@/server/tours/guide";

type Manifest = { scenes: Array<{ slug: string; name: string; hotspots: Array<{ type: "scene" | "info" | "cta"; target?: string; label: string; content?: string }> }> };
const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../public/tours/demo/residencia/manifest.json"), "utf8")) as Manifest;
/** El grafo de la demo tal como llega al navegador (ids = slugs para legibilidad). */
const scenes = manifest.scenes.map((s) => ({ id: s.slug, slug: s.slug, name: s.name, hotspots: s.hotspots.map((h) => ({ kind: h.type, targetSceneId: h.target ?? null, label: h.label, content: h.content ?? null })) }));
const names = Object.fromEntries(scenes.map((s) => [s.id, s.name]));

describe("BFS y descripción del camino", () => {
  it("camino más corto por hotspots de escena", () => {
    expect(findRoute(scenes, "living", "piscina")).toEqual(["living", "galeria", "piscina"]);
    expect(findRoute(scenes, "entrada", "bano")).toEqual(["entrada", "living", "pasillo", "dormitorio", "bano"]);
    expect(findRoute(scenes, "cocina", "cocina")).toEqual(["cocina"]);
    expect(findRoute(scenes, "cocina", "inexistente")).toBeNull();
  });

  it("escena sin salida hacia el destino → null (grafo dirigido)", () => {
    const g = [
      { id: "a", slug: "a", name: "Living", hotspots: [{ kind: "scene" as const, targetSceneId: "b", label: "", content: null }] },
      { id: "b", slug: "b", name: "Galería", hotspots: [] },
    ];
    expect(findRoute(g, "b", "a")).toBeNull();
  });

  it("texto natural con artículos y contracciones", () => {
    expect(describeRoute(["living", "galeria", "piscina"], names)).toBe("Desde el Living podés ir a la Galería y luego a la Piscina.");
    expect(describeRoute(["galeria", "living", "pasillo"], names)).toBe("Desde la Galería podés ir al Living y luego al Pasillo.");
    expect(withArticle("Jardín", "a")).toBe("al Jardín");
    expect(withArticle("Suite principal", "de")).toBe("de la Suite principal");
  });
});

describe("parser de intención y sinónimos", () => {
  it("¿dónde está…? y variantes → navegar", () => {
    expect(parseTourQuestion("¿Dónde está la cocina?", scenes)).toEqual({ kind: "navigate", sceneId: "cocina" });
    expect(parseTourQuestion("llevame a la pileta", scenes)).toEqual({ kind: "navigate", sceneId: "piscina" });
    expect(parseTourQuestion("quiero ver la suite", scenes)).toEqual({ kind: "navigate", sceneId: "dormitorio" });
    expect(parseTourQuestion("baño principal", scenes)).toEqual({ kind: "navigate", sceneId: "bano" });
    expect(parseTourQuestion("Comedor", scenes)).toEqual({ kind: "navigate", sceneId: "comedor" });
  });

  it("jardín → galería cuando no hay escena de jardín (y lo aclara)", () => {
    expect(parseTourQuestion("¿dónde está el jardín?", scenes)).toEqual({ kind: "navigate", sceneId: "galeria" });
    const a = answerTourQuestion({ question: "¿Dónde está el jardín?", scenes, currentSceneId: "living", facts: [] });
    expect(a).toMatchObject({ kind: "route", targetId: "galeria", path: ["living", "galeria"] });
    expect(a.text).toBe("No hay una escena de jardín en el tour; lo más cercano es la Galería. Desde el Living podés ir a la Galería.");
  });

  it("preguntas de datos → dato registrado o «No está registrado»", () => {
    const facts = buildTourFacts({ bedrooms: 3, bathrooms: 2, coveredAreaM2: 180, features: ["Parrilla", "Gas natural"] });
    expect(parseTourQuestion("¿cuántos dormitorios tiene?", scenes)).toEqual({ kind: "feature", factKey: "dormitorios", topic: "dormitorios" });
    expect(answerTourQuestion({ question: "¿Cuántos dormitorios tiene?", scenes, currentSceneId: "living", facts }).text).toBe("Dormitorios: 3.");
    expect(answerTourQuestion({ question: "¿Cuántos metros tiene?", scenes, currentSceneId: "living", facts }).text).toBe("Superficie: 180 m² cubiertos.");
    for (const q of ["¿Cuánto son las expensas?", "¿Está escriturada?", "¿Qué orientación tiene?", "¿Tiene seguridad?"]) {
      expect(answerTourQuestion({ question: q, scenes, currentSceneId: "living", facts })).toEqual({ kind: "not_registered", text: NOT_REGISTERED });
    }
  });

  it("presencia de ambientes, características y puntos de información (solo lo que consta)", () => {
    const facts = buildTourFacts({ features: ["Parrilla"] });
    expect(answerTourQuestion({ question: "¿Tiene pileta?", scenes, currentSceneId: "entrada", facts })).toMatchObject({ kind: "fact", sceneId: "piscina", text: "Sí: en el tour podés recorrer la Piscina." });
    expect(answerTourQuestion({ question: "¿Tiene parrilla?", scenes: scenes.filter((s) => s.id !== "galeria"), currentSceneId: "entrada", facts }).text).toBe("Sí: figura entre las características (Parrilla).");
    expect(answerTourQuestion({ question: "¿Hay hogar a leña?", scenes, currentSceneId: "cocina", facts: [] })).toMatchObject({ kind: "fact", sceneId: "living", text: "En el Living: Hogar a leña. " + scenes.find((s) => s.id === "living")!.hotspots.find((h) => h.label === "Hogar a leña")!.content });
    expect(answerTourQuestion({ question: "¿Tiene cochera?", scenes, currentSceneId: "entrada", facts: [] }).kind).toBe("not_registered");
  });

  it("ya estás ahí, saludo o ruido → respuestas honestas", () => {
    expect(answerTourQuestion({ question: "¿dónde está el living?", scenes, currentSceneId: "living", facts: [] })).toEqual({ kind: "here", text: "Ya estás en el Living.", targetId: "living" });
    expect(answerTourQuestion({ question: "hola", scenes, currentSceneId: "living", facts: [] }).kind).toBe("unknown");
    expect(answerTourQuestion({ question: "?", scenes, currentSceneId: "living", facts: [] }).kind).toBe("unknown");
  });

  it("intención externa (IA) se valida contra el tour: un id inventado no navega", () => {
    expect(answerTourQuestion({ question: "x", scenes, currentSceneId: "living", facts: [], intent: { kind: "navigate", sceneId: "sotano-secreto" } }).kind).toBe("unknown");
    expect(answerTourQuestion({ question: "x", scenes, currentSceneId: "living", facts: [], intent: { kind: "navigate", sceneId: "cocina" } })).toMatchObject({ kind: "route", path: ["living", "cocina"] });
  });

  it("hechos públicos: solo lo cargado", () => {
    expect(buildTourFacts({})).toEqual([]);
    expect(buildTourFacts({ ageYears: 0, creditEligible: false }).map((f) => `${f.key}=${f.value}`)).toEqual(["antiguedad=a estrenar", "credito=no"]);
  });
});
