/**
 * Parser (puro) de las guías `knowledge/*.md`. Formato en knowledge/README.md:
 *   frontmatter (dominio, titulo, resumen, permisos) + una sección `##` por fragmento, con metadatos opcionales
 *   `<!-- ruta: /crm/...; permisos: a, b -->` en la línea siguiente al título.
 * Cualquier error de formato hace fallar la ingesta completa (mejor que indexar una guía rota a medias).
 */
import { createHash } from "node:crypto";

export const KNOWLEDGE_DOMAINS = ["crm", "properties", "leads", "agenda", "agents", "virtual-tours", "marketing", "rentals", "operations", "permissions", "integrations", "faq", "visits"] as const;
export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number];

export const MAX_CHUNK_CHARS = 6_000;
const ROUTE_RE = /^\/crm(\/[A-Za-z0-9_\[\]-]+)*$/;
const PERMISSION_RE = /^[a-z_]+\.[a-z_]+$/;

export type ParsedChunk = { anchor: string; ordinal: number; heading: string; body: string; route: string | null; permissions: string[]; hash: string };
export type ParsedDocument = { path: string; domain: KnowledgeDomain; title: string; summary: string | null; permissions: string[]; hash: string; chunks: ParsedChunk[] };

export class KnowledgeFormatError extends Error {
  constructor(readonly problems: string[]) {
    super(`Guías con errores de formato:\n- ${problems.join("\n- ")}`);
    this.name = "KnowledgeFormatError";
  }
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function slugify(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "seccion"
  );
}

function parsePermissions(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function parseMeta(line: string): Record<string, string> | null {
  const m = /^<!--([\s\S]*?)-->$/.exec(line.trim());
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const part of m[1]!.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

export function parseKnowledgeFile(path: string, raw: string): ParsedDocument {
  const problems: string[] = [];
  const text = raw.replace(/\r\n/g, "\n");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fm) throw new KnowledgeFormatError([`${path}: falta el frontmatter (--- … ---)`]);
  const meta: Record<string, string> = {};
  for (const line of fm[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const domain = meta.dominio as KnowledgeDomain;
  if (!KNOWLEDGE_DOMAINS.includes(domain)) problems.push(`${path}: dominio inválido "${meta.dominio ?? ""}"`);
  const title = meta.titulo ?? "";
  if (title.length < 2 || title.length > 200) problems.push(`${path}: falta "titulo"`);
  const summary = meta.resumen?.slice(0, 500) || null;
  const docPermissions = parsePermissions(meta.permisos);

  const lines = text.slice(fm[0].length).split("\n");
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | null = null;
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence && /^## /.test(line)) {
      current = { heading: line.slice(3).trim(), lines: [] };
      sections.push(current);
    } else if (current) current.lines.push(line);
  }
  if (!sections.length) problems.push(`${path}: no tiene secciones "## "`);

  const anchors = new Set<string>();
  const chunks: ParsedChunk[] = [];
  sections.forEach((s, ordinal) => {
    const where = `${path} › "${s.heading}"`;
    if (s.heading.length < 2 || s.heading.length > 200) problems.push(`${where}: título de sección inválido`);
    let body = s.lines;
    const firstIdx = body.findIndex((l) => l.trim() !== "");
    let route: string | null = null;
    let permissions = docPermissions;
    if (firstIdx >= 0) {
      const m = parseMeta(body[firstIdx]!);
      if (m) {
        route = m.ruta || null;
        if (m.permisos !== undefined) permissions = parsePermissions(m.permisos);
        body = body.slice(firstIdx + 1);
      }
    }
    if (route && !ROUTE_RE.test(route)) problems.push(`${where}: ruta inválida "${route}"`);
    for (const p of permissions) if (!PERMISSION_RE.test(p)) problems.push(`${where}: permiso inválido "${p}"`);
    const content = body.join("\n").trim();
    if (!content) problems.push(`${where}: sección vacía`);
    if (content.length > MAX_CHUNK_CHARS) problems.push(`${where}: sección demasiado larga (${content.length} > ${MAX_CHUNK_CHARS} caracteres): dividila`);
    let anchor = slugify(s.heading);
    for (let n = 2; anchors.has(anchor); n++) anchor = `${slugify(s.heading)}-${n}`;
    anchors.add(anchor);
    chunks.push({ anchor, ordinal, heading: s.heading, body: content, route, permissions, hash: sha256(JSON.stringify({ h: s.heading, b: content, r: route, p: permissions })) });
  });

  if (problems.length) throw new KnowledgeFormatError(problems);
  return { path, domain, title, summary, permissions: docPermissions, hash: sha256(text), chunks };
}
