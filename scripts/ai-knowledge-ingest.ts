/**
 * Ingesta idempotente de la guía del CRM (knowledge/*.md) en la base de DATABASE_URL.
 * Uso: pnpm ai:knowledge:ingest   (correr después de pnpm db:migrate en cada deploy que cambie knowledge/)
 * El job diario ai.knowledge_ingest hace lo mismo; este script lo aplica al instante.
 */
import "./db/env";
import { createDb } from "../src/server/db";
import { ingestKnowledge, readKnowledgeSources } from "../src/server/ai/knowledge/ingest";
import { resolve } from "node:path";

const { db, pool } = createDb();
try {
  const stats = await ingestKnowledge(db, readKnowledgeSources(resolve(import.meta.dirname, "../knowledge")));
  console.info(`Guías: ${stats.documents.total} (nuevas ${stats.documents.created}, actualizadas ${stats.documents.updated}, sin cambios ${stats.documents.unchanged}, borradas ${stats.documents.deleted})`);
  console.info(`Secciones: +${stats.chunks.inserted} · ~${stats.chunks.updated} · =${stats.chunks.unchanged} · -${stats.chunks.deleted}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
