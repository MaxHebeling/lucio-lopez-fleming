/**
 * Genera imágenes PROVISORIAS para la demo del tour (public/tours/demo/residencia) a partir del manifiesto:
 * panoramas equirectangulares 2:1 con cuadrícula de meridianos/paralelos, nombre del ambiente, marcas de yaw y las
 * puertas donde están los hotspots; previews 512×256, miniaturas 640×400 y portada 1600×1000.
 *
 * Son placeholders válidos (mismo esquema y nombres que los renders definitivos): cuando lleguen los renders se
 * reemplazan los archivos y se corre `pnpm seed:demo-tour`. No sobrescribe archivos existentes salvo con --force.
 * Uso: pnpm exec tsx scripts/tours/demo-placeholders.ts [--force]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { parseTourManifest, type TourManifest } from "../../src/server/tours/manifest";

const DIR = resolve(import.meta.dirname, "../../public/tours/demo/residencia");
const force = process.argv.includes("--force");
const PANO_W = 2048;
const PANO_H = 1024;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const x = (yaw: number) => (yaw / (2 * Math.PI) + 0.5) * PANO_W;
const y = (pitch: number) => (0.5 - pitch / Math.PI) * PANO_H;
const FONT = "Helvetica, Arial, sans-serif";

function panoramaSvg(m: TourManifest, scene: TourManifest["scenes"][number]): string {
  const names = new Map(m.scenes.map((s) => [s.slug, s.name]));
  const parts: string[] = [];
  parts.push(`<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#e9e3da"/><stop offset="0.5" stop-color="#d9d1c6"/><stop offset="0.5" stop-color="#8a8178"/><stop offset="1" stop-color="#3a3734"/></linearGradient></defs>`);
  parts.push(`<rect width="${PANO_W}" height="${PANO_H}" fill="url(#sky)"/>`);
  // Meridianos cada 15° (más marcados cada 90°) y paralelos cada 15°.
  for (let deg = -180; deg <= 180; deg += 15) {
    const px = x((deg * Math.PI) / 180);
    const strong = deg % 90 === 0;
    parts.push(`<line x1="${px}" y1="0" x2="${px}" y2="${PANO_H}" stroke="#141312" stroke-opacity="${strong ? 0.35 : 0.12}" stroke-width="${strong ? 2 : 1}"/>`);
    if (deg > -180) parts.push(`<text x="${px + 4}" y="${y(0) - 8}" font-family="${FONT}" font-size="14" fill="#141312" fill-opacity="0.55">${deg}°</text>`);
  }
  for (let deg = -75; deg <= 75; deg += 15) {
    const py = y((deg * Math.PI) / 180);
    parts.push(`<line x1="0" y1="${py}" x2="${PANO_W}" y2="${py}" stroke="#141312" stroke-opacity="${deg === 0 ? 0 : 0.1}" stroke-width="1"/>`);
  }
  parts.push(`<line x1="0" y1="${y(0)}" x2="${PANO_W}" y2="${y(0)}" stroke="#ae2c25" stroke-width="3"/>`);
  // Nombre del ambiente frente a la vista inicial y en el lado opuesto.
  for (const yaw of [scene.initialYaw, scene.initialYaw > 0 ? scene.initialYaw - Math.PI : scene.initialYaw + Math.PI]) {
    parts.push(`<text x="${x(yaw)}" y="${y(0.62)}" text-anchor="middle" font-family="${FONT}" font-size="64" font-weight="700" letter-spacing="8" fill="#141312">${esc(scene.name.toUpperCase())}</text>`);
    parts.push(`<text x="${x(yaw)}" y="${y(0.52)}" text-anchor="middle" font-family="${FONT}" font-size="20" letter-spacing="4" fill="#3a3734">IMAGEN PROVISORIA · RENDER PENDIENTE · RESIDENCIA FICTICIA</text>`);
  }
  // Puertas / puntos de interés donde están los hotspots.
  for (const h of scene.hotspots) {
    const hx = x(h.yaw);
    if (h.type === "scene") {
      parts.push(`<rect x="${hx - 70}" y="${y(0.28)}" width="140" height="${y(-0.2) - y(0.28)}" fill="#141312" fill-opacity="0.18" stroke="#ae2c25" stroke-width="3"/>`);
      parts.push(`<text x="${hx}" y="${y(0.3) - 10}" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="700" fill="#ae2c25">→ ${esc(names.get(h.target) ?? h.target)}</text>`);
    } else {
      parts.push(`<circle cx="${hx}" cy="${y(h.pitch)}" r="26" fill="none" stroke="#b8643f" stroke-width="3"/>`);
      parts.push(`<text x="${hx}" y="${y(h.pitch) + 50}" text-anchor="middle" font-family="${FONT}" font-size="18" fill="#141312">${esc(h.label)}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PANO_W}" height="${PANO_H}" viewBox="0 0 ${PANO_W} ${PANO_H}">${parts.join("")}</svg>`;
}

function coverSvg(): string {
  // Portada provisoria sobria: líneas finas de "agrimensura" sobre tinta (la ficha le superpone el título).
  const lines = Array.from({ length: 18 }, (_, i) => {
    const x = -200 + i * 120;
    return `<line x1="${x}" y1="1000" x2="${800 + (x - 800) * 0.25}" y2="420" stroke="#f4f0ea" stroke-opacity="0.09"/>`;
  }).join("");
  const rows = Array.from({ length: 8 }, (_, i) => {
    const y = 420 + Math.pow(i / 7, 1.8) * 580;
    return `<line x1="0" y1="${y}" x2="1600" y2="${y}" stroke="#f4f0ea" stroke-opacity="0.07"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
  <defs><radialGradient id="g" cx="0.62" cy="0.38" r="0.8"><stop offset="0" stop-color="#3a3734"/><stop offset="1" stop-color="#0f0e0d"/></radialGradient></defs>
  <rect width="1600" height="1000" fill="url(#g)"/>${lines}${rows}
  <line x1="0" y1="420" x2="1600" y2="420" stroke="#ae2c25" stroke-width="2" stroke-opacity="0.8"/>
  <text x="1540" y="80" text-anchor="end" font-family="${FONT}" font-size="22" letter-spacing="6" fill="#f4f0ea" fill-opacity="0.55">IMAGEN PROVISORIA · RENDER PENDIENTE</text>
</svg>`;
}

async function write(name: string, render: () => Promise<Buffer>) {
  const path = resolve(DIR, name);
  if (existsSync(path) && !force) {
    console.info(`= ${name} (existe; --force para regenerar)`);
    return;
  }
  writeFileSync(path, await render());
  console.info(`✔ ${name}`);
}

const parsed = parseTourManifest(JSON.parse(readFileSync(resolve(DIR, "manifest.json"), "utf8")));
if (!parsed.ok) {
  console.error(`Manifiesto inválido:\n${parsed.errors.join("\n")}`);
  process.exit(1);
}
const m = parsed.manifest;
for (const s of m.scenes) {
  const pano = await sharp(Buffer.from(panoramaSvg(m, s))).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  await write(s.panorama, async () => pano);
  await write(s.preview, () => sharp(pano).resize(512, 256).blur(1.2).jpeg({ quality: 70 }).toBuffer());
  // Miniatura: ventana de ~112° centrada en la vista inicial (se rota la imagen para que no corte en el borde).
  const shift = Math.round((((0.5 - (s.initialYaw / (2 * Math.PI) + 0.5)) % 1) + 1) % 1 * PANO_W);
  await write(s.thumbnail, async () => {
    const rolled = await sharp({ create: { width: PANO_W, height: PANO_H, channels: 3, background: "#000" } })
      .composite([
        { input: pano, left: shift, top: 0 },
        { input: pano, left: shift - PANO_W, top: 0 },
      ])
      .png()
      .toBuffer();
    return sharp(rolled).extract({ left: PANO_W / 2 - 320, top: PANO_H / 2 - 260, width: 640, height: 400 }).jpeg({ quality: 80 }).toBuffer();
  });
}
await write(m.tour.cover, () => sharp(Buffer.from(coverSvg())).jpeg({ quality: 82, mozjpeg: true }).toBuffer());
