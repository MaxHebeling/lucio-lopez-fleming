#!/usr/bin/env bash
# Simulacro de restauración: restaura un backup en una base NUEVA y temporal, corre migraciones (deben ser no-op)
# y compara conteos clave contra el manifiesto. Un backup no es confiable hasta pasar este simulacro.
# Uso: scripts/restore-drill.sh backups/llf-XXXX.dump [postgres://.../postgres]
set -euo pipefail
dump="${1:?Uso: restore-drill.sh <archivo.dump> [url-admin]}"
admin="${2:-postgres://localhost:5432/postgres}"
manifest="$dump.json"
target_db="llf_restore_drill_$(date +%s)"
target_url="${admin%/*}/$target_db"
t0=$(date +%s)

psql "$admin" -qc "create database $target_db"
cleanup() { psql "$admin" -qc "drop database if exists $target_db with (force)" || true; }
trap cleanup EXIT

# Extensiones que el dump referencia. En Postgres "plano" viven en public; en Supabase en el esquema `extensions`.
# Se detecta por las referencias del propio dump y se recrean en el mismo esquema antes de restaurar.
# Sin `grep -q`: con pipefail cortaría la tubería (SIGPIPE en pg_restore) y la detección fallaría en silencio.
ext_refs=$(pg_restore -f - "$dump" 2>/dev/null | grep -c "extensions\." || true)
if [ "${ext_refs:-0}" -gt 0 ]; then
  ext_schema=extensions
  psql "$target_url" -qc "create schema if not exists extensions"
  psql "$admin" -qc "alter database $target_db set search_path = public, extensions"
else
  ext_schema=public
fi
psql "$target_url" -qc "create extension if not exists pg_trgm schema $ext_schema; create extension if not exists unaccent schema $ext_schema; create extension if not exists btree_gist schema $ext_schema;"
# El esquema public ya existe en una base nueva: se excluye esa entrada de la lista de restauración.
list=$(mktemp)
pg_restore -l "$dump" | grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' > "$list"
pg_restore --no-owner --no-privileges --exit-on-error --use-list="$list" --dbname="$target_url" "$dump" || { echo "✖ pg_restore falló"; exit 1; }
rm -f "$list"

DATABASE_URL="$target_url" npx tsx scripts/db/migrate.ts >/dev/null
restored_props=$(psql "$target_url" -Atc "select count(*) from properties")
restored_tables=$(psql "$target_url" -Atc "select count(*) from pg_tables where schemaname='public'")
expected_props=$(python3 -c "import json;print(json.load(open('$manifest'))['properties'])")
expected_tables=$(python3 -c "import json;print(json.load(open('$manifest'))['tables'])")
audit_immutable=$(psql "$target_url" -Atc "select count(*) from pg_trigger where tgname='trg_audit_logs_immutable'")
secs=$(( $(date +%s) - t0 ))

echo "tablas: $restored_tables/$expected_tables · propiedades: $restored_props/$expected_props · trigger auditoría: $audit_immutable · RTO simulacro: ${secs}s"
# Los conteos del manifiesto se toman ANTES del dump: durante el dump solo pueden crecer (no hay borrados físicos).
[ "$restored_props" -ge "$expected_props" ] && [ "$restored_tables" = "$expected_tables" ] && [ "$audit_immutable" = "1" ] || { echo "✖ El restore no coincide con el manifiesto"; exit 1; }
echo "✓ Simulacro de restore OK"
