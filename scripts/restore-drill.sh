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

# Extensiones que el dump referencia (en Supabase viven en otro esquema; se crean acá antes de restaurar)
psql "$target_url" -qc "create extension if not exists pg_trgm; create extension if not exists unaccent; create extension if not exists btree_gist;"
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
[ "$restored_props" = "$expected_props" ] && [ "$restored_tables" = "$expected_tables" ] && [ "$audit_immutable" = "1" ] || { echo "✖ El restore no coincide con el manifiesto"; exit 1; }
echo "✓ Simulacro de restore OK"
