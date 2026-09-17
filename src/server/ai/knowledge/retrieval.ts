/**
 * Retrieval de la base de conocimiento SIN embeddings: full-text en español (`tsvector` generado con stemming
 * `spanish` sobre texto sin acentos ni signos) + cobertura de términos + afinidad por módulo.
 * Siempre filtra por organización y por permisos del actor (un fragmento con permisos se ve si el actor tiene
 * al menos uno). Sin evidencia suficiente devuelve [] y el copiloto lo dice.
 */
import { sql, type Executor } from "../../db";
import type { StaffActor } from "../../auth/actor";
import type { KnowledgeDomain } from "./parse";

/** Palabras que no aportan a la búsqueda de procedimientos (además de las stopwords de Postgres). */
const NOISE = new Set([
  "hago", "hace", "hacer", "haces", "puedo", "podes", "puede", "quiero", "queres", "necesito", "tengo", "tenes", "donde", "como", "cual",
  "cuales", "que", "crm", "sistema", "pantalla", "boton", "favor", "hola", "gracias", "ayuda", "ayudame", "explicame", "decime", "paso",
  "pasos", "forma", "manera", "algo", "alguna", "alguno", "aca", "ahi", "esto", "esta", "este", "ese", "esa", "veo", "ver", "hay", "encuentro",
  "encontrar", "hacerlo", "funciona", "anda",
]);

export function normalizeQuery(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Términos saneados (solo [a-z0-9]) para armar un tsquery OR sin riesgo de inyección de sintaxis. */
export function queryTokens(text: string): string[] {
  const tokens = normalizeQuery(text)
    .split(" ")
    .filter((t) => t.length >= 2 && t.length <= 40 && !NOISE.has(t));
  return [...new Set(tokens)].slice(0, 12);
}

/** Módulo del CRM → dominio de la guía (desempate cuando la pregunta sirve para varios). */
const MODULE_DOMAIN: Record<string, KnowledgeDomain> = {
  properties: "properties",
  contacts: "leads",
  leads: "leads",
  opportunities: "leads",
  conversations: "leads",
  agenda: "agenda",
  visits: "visits",
  tasks: "agenda",
  rentals: "rentals",
  reports: "rentals",
  marketing: "marketing",
  publications: "marketing",
  automations: "operations",
  system: "operations",
  audit: "operations",
  migration: "operations",
  integrations: "integrations",
  users: "agents",
  dashboard: "crm",
  search: "crm",
  notifications: "crm",
  account: "crm",
};

export type KnowledgeHit = {
  chunkId: string;
  path: string;
  anchor: string;
  domain: string;
  documentTitle: string;
  heading: string;
  body: string;
  route: string | null;
  coverage: number;
  terms: number;
  rank: number;
};

export async function searchKnowledge(db: Executor, actor: StaffActor, question: string, opts: { limit?: number; module?: string | null } = {}): Promise<KnowledgeHit[]> {
  const tokens = queryTokens(question);
  if (!tokens.length) return [];
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
  const tsq = tokens.join(" | ");
  const normalized = tokens.join(" ");
  const allPermissions = actor.roles.includes("super_admin");
  const perms = [...actor.permissions];
  const rows = await sql<{
    id: string;
    path: string;
    anchor: string;
    domain: string;
    title: string;
    heading: string;
    body: string;
    route: string | null;
    rank: number;
    coverage: number;
    heading_coverage: number;
    terms: number;
  }>`
    with q as (
      select to_tsquery('spanish', ${tsq}) as tsq,
             tsvector_to_array(to_tsvector('spanish', ${normalized})) as terms
    )
    select c.id, d.path, c.anchor, d.domain, d.title, c.heading, c.body, c.route,
           ts_rank(c.search, q.tsq, 1)::float8 as rank,
           (select count(*) from unnest(tsvector_to_array(c.search)) l where l = any(q.terms))::int as coverage,
           (select count(*) from unnest(tsvector_to_array(to_tsvector('spanish', regexp_replace(lower(f_unaccent(c.heading)), '[^a-z0-9]+', ' ', 'g')))) l
             where l = any(q.terms))::int as heading_coverage,
           cardinality(q.terms)::int as terms
      from ai_knowledge_chunks c
      join ai_knowledge_documents d on d.id = c.document_id
     cross join q
     where c.search @@ q.tsq
       and (d.organization_id is null or d.organization_id = ${actor.organizationId})
       and (${allPermissions} or cardinality(c.permissions) = 0 or c.permissions && ${perms}::text[])
     order by heading_coverage desc, coverage desc, rank desc
     limit ${limit * 6}`.execute(db);

  const preferred = opts.module ? MODULE_DOMAIN[opts.module] : undefined;
  const terms = rows.rows[0]?.terms ?? tokens.length;
  // Evidencia mínima: algún término en el TÍTULO de la sección y, con 3 o más términos, al menos 2 en el fragmento.
  // Un término suelto en un párrafo largo no alcanza: mejor decir "no lo encontré" que mostrar algo no relacionado.
  const minCoverage = terms >= 3 ? 2 : 1;
  return rows.rows
    .filter((r) => r.coverage >= minCoverage && r.heading_coverage >= 1)
    .map((r) => ({ r, score: r.heading_coverage * 4 + r.coverage * 2 + (preferred && r.domain === preferred ? 2 : 0) + Number(r.rank) * 20 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => ({
      chunkId: r.id,
      path: r.path,
      anchor: r.anchor,
      domain: r.domain,
      documentTitle: r.title,
      heading: r.heading,
      body: r.body,
      route: r.route,
      coverage: r.coverage,
      terms: r.terms,
      rank: Number(r.rank),
    }));
}

/** Extracto legible (cortado en un límite de oración/párrafo). */
export function excerpt(body: string, max = 700): string {
  const clean = body.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const at = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return `${(at > max * 0.5 ? cut.slice(0, at + 1) : cut).trim()}…`;
}

export async function knowledgeStats(db: Executor): Promise<{ documents: number; chunks: number; lastUpdated: Date | null }> {
  const r = await sql<{ documents: number; chunks: number; last: Date | null }>`
    select (select count(*) from ai_knowledge_documents)::int as documents,
           (select count(*) from ai_knowledge_chunks)::int as chunks,
           (select max(updated_at) from ai_knowledge_documents) as last`.execute(db);
  const row = r.rows[0];
  return { documents: row?.documents ?? 0, chunks: row?.chunks ?? 0, lastUpdated: row?.last ?? null };
}
