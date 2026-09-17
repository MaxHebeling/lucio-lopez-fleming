#!/usr/bin/env bash
# Backup lógico de la base (formato custom, comprimido) + checksum + manifiesto.
# Uso: DATABASE_URL=... scripts/backup.sh [directorio]   (por defecto ./backups)
# Opcional: BACKUP_ENCRYPT_RECIPIENT=<clave age/gpg> para cifrar en reposo.
set -euo pipefail
: "${DATABASE_URL:?Falta DATABASE_URL}"
dir="${1:-backups}"
mkdir -p "$dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$dir/llf-$stamp.dump"

# Conteos ANTES del dump (el simulacro exige restaurado >= manifiesto: durante el dump los datos solo crecen).
tables=$(psql "$DATABASE_URL" -Atc "select count(*) from pg_tables where schemaname='public'")
migrations=$(psql "$DATABASE_URL" -Atc "select coalesce(max(version),'0') from schema_migrations")
properties=$(psql "$DATABASE_URL" -Atc "select count(*) from properties")
# Solo el esquema public (datos de la app). En Supabase, auth/storage/vault no pertenecen a esta app.
pg_dump "$DATABASE_URL" --format=custom --compress=9 --no-owner --no-privileges --schema=public --file="$file"
sha=$(shasum -a 256 "$file" | cut -d' ' -f1)
cat > "$file.json" <<JSON
{ "file": "$(basename "$file")", "created_at": "$stamp", "sha256": "$sha", "bytes": $(stat -f%z "$file" 2>/dev/null || stat -c%s "$file"),
  "tables": $tables, "last_migration": "$migrations", "properties": $properties }
JSON
if [ -n "${BACKUP_ENCRYPT_RECIPIENT:-}" ] && command -v age >/dev/null; then
  age -r "$BACKUP_ENCRYPT_RECIPIENT" -o "$file.age" "$file" && rm "$file"
  echo "✓ Backup cifrado: $file.age"
else
  echo "✓ Backup: $file ($sha)"
fi
