/**
 * Métricas de imagen de AI Property con imágenes SINTÉTICAS generadas acá (sin fotos reales ni red): duplicadas
 * (dHash), oscuras (luminancia) y borrosas (varianza del Laplaciano). Calibración documentada en image-metrics.ts.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { scene } from "../helpers/images";
import { dHash, duplicateGroups, hammingDistance, imageMetrics, IMAGE_THRESHOLDS, isBlurry, isDark, luminanceStats, sharpness, sharpnessRatio } from "@/server/ai/property/image-metrics";

describe("dHash y duplicadas", () => {
  it("la misma foto re-encodeada, achicada y apenas más clara es duplicada; otra escena no", async () => {
    const a = await scene(1);
    const reencoded = await sharp(a).resize({ width: 800 }).modulate({ brightness: 1.05 }).jpeg({ quality: 55 }).toBuffer();
    const b = await scene(2);
    const [ha, hr, hb] = await Promise.all([dHash(a), dHash(reencoded), dHash(b)]);
    expect(ha).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistance(ha, hr)).toBeLessThanOrEqual(IMAGE_THRESHOLDS.duplicateMaxDistance);
    expect(hammingDistance(ha, hb)).toBeGreaterThan(IMAGE_THRESHOLDS.duplicateMaxDistance * 2);
  });

  it("agrupa duplicadas transitivas y deja afuera las únicas, conservando el orden", () => {
    const groups = duplicateGroups([
      { id: "a", dhash: "ffffffffffffffff" },
      { id: "b", dhash: "fffffffffffffff0" }, // 4 bits de a
      { id: "c", dhash: "0000000000000000" },
      { id: "d", dhash: "ffffffffffffff00" }, // 4 bits de b, 8 de a → mismo grupo por transitividad
    ]);
    expect(groups).toEqual([["a", "b", "d"]]);
    expect(duplicateGroups([{ id: "x", dhash: "0f0f0f0f0f0f0f0f" }])).toEqual([]);
  });
});

describe("oscuras", () => {
  it("una escena normal no es oscura; la misma al 25 % de luz sí", async () => {
    const a = await scene(3);
    const dark = await sharp(a).linear(0.25, 0).jpeg().toBuffer();
    const normal = await luminanceStats(a);
    const low = await luminanceStats(dark);
    expect(isDark({ luminanceMean: normal.mean, luminanceP95: normal.p95 })).toBe(false);
    expect(isDark({ luminanceMean: low.mean, luminanceP95: low.p95 })).toBe(true);
    expect(low.darkRatio).toBeGreaterThan(normal.darkRatio);
  });

  it("una foto con cielo claro y sombras (p95 alto) no se marca aunque la media sea baja", () => {
    expect(isDark({ luminanceMean: 55, luminanceP95: 210 })).toBe(false);
  });
});

describe("borrosas (varianza del Laplaciano / varianza de luminancia)", () => {
  it("nítida > umbral; desenfocada (σ=2 a 512 px) < umbral; suave (σ=1) no se marca", async () => {
    const a = await scene(4);
    const at512 = await sharp(a).resize({ width: 512 }).toBuffer();
    const crisp = await sharpness(a);
    const soft = await sharpness(await sharp(at512).blur(1).toBuffer());
    const blurred = await sharpness(await sharp(at512).blur(2).toBuffer());
    const veryBlurred = await sharpness(await sharp(a).blur(8).jpeg().toBuffer());
    expect(isBlurry(crisp)).toBe(false);
    expect(isBlurry(soft)).toBe(false);
    expect(isBlurry(blurred)).toBe(true);
    expect(isBlurry(veryBlurred)).toBe(true);
    expect(sharpnessRatio(crisp)!).toBeGreaterThan(sharpnessRatio(blurred)! * 5);
  });

  it("no depende de la exposición: una foto nítida oscurecida no es borrosa; oscura y desenfocada sí", async () => {
    const a = await scene(7);
    const dark = await sharpness(await sharp(a).linear(0.2, 0).jpeg().toBuffer());
    expect(isBlurry(dark)).toBe(false);
    const darkBlur = await sharpness(await sharp(await sharp(a).resize({ width: 512 }).toBuffer()).blur(3).linear(0.2, 0).png().toBuffer());
    expect(isBlurry(darkBlur)).toBe(true);
  });

  it("una imagen casi uniforme no se evalúa (no es «borrosa»)", async () => {
    const flat = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#d9d4cc" } }).jpeg().toBuffer();
    const m = await sharpness(flat);
    expect(sharpnessRatio(m)).toBeNull();
    expect(isBlurry(m)).toBe(false);
  });

  it("la medida no depende del tamaño de subida (normaliza a 512 px)", async () => {
    const a = await scene(5, 1600, 1200);
    const big = sharpnessRatio(await sharpness(a))!;
    const same = sharpnessRatio(await sharpness(await sharp(a).resize({ width: 1024 }).jpeg({ quality: 92 }).toBuffer()))!;
    expect(Math.abs(big - same) / big).toBeLessThan(0.35);
  });
});

describe("imageMetrics", () => {
  it("devuelve todas las métricas con dimensiones reales", async () => {
    const m = await imageMetrics(await scene(6, 640, 480));
    expect(m).toMatchObject({ width: 640, height: 480 });
    expect(m.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(m.luminanceMean).toBeGreaterThan(0);
    expect(isBlurry(m)).toBe(false);
    expect(m.luminanceVariance).toBeGreaterThan(IMAGE_THRESHOLDS.minLuminanceVariance);
  });

  it("rechaza bytes que no son imagen", async () => {
    await expect(imageMetrics(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});
