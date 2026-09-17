-- 0400 — Sitio público: índices para listados y portadas.
-- Listados por recientes (orden por defecto del sitio y del sitemap) sobre lo publicado.
create index if not exists properties_published_recent on properties (published_at desc, code desc)
  where is_published and deleted_at is null;
-- Portada y conteo de fotos visibles por propiedad (excluye fallidas y borradas).
create index if not exists property_media_public on property_media (property_id, is_cover desc, sort_order, created_at)
  where deleted_at is null and kind = 'image' and status <> 'failed';
