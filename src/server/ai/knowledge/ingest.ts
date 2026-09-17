/**
 * Ingesta idempotente de `knowledge/*.md` a ai_knowledge_documents / ai_knowledge_chunks.
 *  - Documento sin cambios (mismo hash) → no se toca.
 *  - Documento cambiado → solo se insertan/actualizan/borran los fragmentos cuyo hash cambió (clave: anchor).
 *  - Guía eliminada del repo → se borra de la base.
 * Todo en UNA transacción con lock (dos ingestas simultáneas no se pisan). Errores de formato o permisos
 * inexistentes → no se escribe nada.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql, type Database } from "../../db";
import { KnowledgeFormatError, parseKnowledgeFile, type ParsedDocument } from "./parse";

export type IngestStats = {
  documents: { total: number; created: number; updated: number; unchanged: number; deleted: number };
  chunks: { inserted: number; updated: number; unchanged: number; deleted: number };
};

export type KnowledgeSource = { path: string; content: string };

export function knowledgeDir(): string {
  return resolve(process.cwd(), "knowledge");
}

/** Lee las guías del repo (todo `*.md` salvo README.md). */
export function readKnowledgeSources(dir = knowledgeDir()): KnowledgeSource[] {
  return readdirSync(dir)
    .filter((f) => /^[a-z0-9-]+\.md$/.test(f) && f !== "README.md")
    .sort()
    .map((f) => ({ path: `knowledge/${f}`, content: readFileSync(resolve(dir, f), "utf8") }));
}

export async function ingestKnowledge(db: Database, sources: KnowledgeSource[] = readKnowledgeSources()): Promise<IngestStats> {
  const docs: ParsedDocument[] = [];
  const problems: string[] = [];
  for (const s of sources) {
    try {
      docs.push(parseKnowledgeFile(s.path, s.content));
    } catch (e) {
      if (e instanceof KnowledgeFormatError) problems.push(...e.problems);
      else throw e;
    }
  }
  if (problems.length) throw new KnowledgeFormatError(problems);

  const stats: IngestStats = {
    documents: { total: docs.length, created: 0, updated: 0, unchanged: 0, deleted: 0 },
    chunks: { inserted: 0, updated: 0, unchanged: 0, deleted: 0 },
  };

  await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext('ai.knowledge_ingest'))`.execute(trx);

    // Permisos declarados que no existen: error (un typo escondería la guía a todos).
    const known = new Set((await trx.selectFrom("permissions").select("key").execute()).map((r) => r.key));
    const unknown = new Set<string>();
    for (const d of docs) for (const c of d.chunks) for (const p of c.permissions) if (!known.has(p)) unknown.add(`${d.path}: permiso inexistente "${p}"`);
    if (unknown.size) throw new KnowledgeFormatError([...unknown]);

    const existingDocs = await trx.selectFrom("ai_knowledge_documents").select(["id", "path", "content_hash"]).where("organization_id", "is", null).execute();
    const byPath = new Map(existingDocs.map((d) => [d.path, d]));

    for (const doc of docs) {
      const prev = byPath.get(doc.path);
      if (prev && prev.content_hash === doc.hash) {
        stats.documents.unchanged++;
        stats.chunks.unchanged += doc.chunks.length;
        continue;
      }
      const docId = prev
        ? (
            await trx
              .updateTable("ai_knowledge_documents")
              .set({ domain: doc.domain, title: doc.title, summary: doc.summary, content_hash: doc.hash, chunk_count: doc.chunks.length })
              .where("id", "=", prev.id)
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id
        : (
            await trx
              .insertInto("ai_knowledge_documents")
              .values({ organization_id: null, path: doc.path, domain: doc.domain, title: doc.title, summary: doc.summary, content_hash: doc.hash, chunk_count: doc.chunks.length })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id;
      if (prev) stats.documents.updated++;
      else stats.documents.created++;

      const existing = await trx.selectFrom("ai_knowledge_chunks").select(["id", "anchor", "content_hash", "ordinal"]).where("document_id", "=", docId).execute();
      const byAnchor = new Map(existing.map((c) => [c.anchor, c]));
      for (const c of doc.chunks) {
        const old = byAnchor.get(c.anchor);
        byAnchor.delete(c.anchor);
        if (!old) {
          await trx
            .insertInto("ai_knowledge_chunks")
            .values({ document_id: docId, anchor: c.anchor, ordinal: c.ordinal, heading: c.heading, body: c.body, route: c.route, permissions: c.permissions, content_hash: c.hash })
            .execute();
          stats.chunks.inserted++;
        } else if (old.content_hash !== c.hash) {
          await trx
            .updateTable("ai_knowledge_chunks")
            .set({ ordinal: c.ordinal, heading: c.heading, body: c.body, route: c.route, permissions: c.permissions, content_hash: c.hash })
            .where("id", "=", old.id)
            .execute();
          stats.chunks.updated++;
        } else {
          if (old.ordinal !== c.ordinal) await trx.updateTable("ai_knowledge_chunks").set({ ordinal: c.ordinal }).where("id", "=", old.id).execute();
          stats.chunks.unchanged++;
        }
      }
      const stale = [...byAnchor.values()].map((c) => c.id);
      if (stale.length) {
        await trx.deleteFrom("ai_knowledge_chunks").where("id", "in", stale).execute();
        stats.chunks.deleted += stale.length;
      }
    }

    const current = new Set(docs.map((d) => d.path));
    const removed = existingDocs.filter((d) => !current.has(d.path)).map((d) => d.id);
    if (removed.length) {
      const n = await trx.selectFrom("ai_knowledge_chunks").select((eb) => eb.fn.countAll<string>().as("n")).where("document_id", "in", removed).executeTakeFirst();
      stats.chunks.deleted += Number(n?.n ?? 0);
      await trx.deleteFrom("ai_knowledge_documents").where("id", "in", removed).execute();
      stats.documents.deleted += removed.length;
    }
  });
  return stats;
}
