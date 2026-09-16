#!/usr/bin/env bash
# Falla si hay archivos .env versionados o patrones típicos de credenciales en archivos versionados.
set -euo pipefail
cd "$(dirname "$0")/.."

tracked_env=$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
if [ -n "$tracked_env" ]; then
  echo "✖ Archivos .env versionados:"; echo "$tracked_env"; exit 1
fi

patterns='(sk-ant-[A-Za-z0-9_-]{20,}|re_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|EAA[A-Za-z0-9]{40,}|sb_secret_[A-Za-z0-9_-]{10,}|-----BEGIN (RSA |EC )?PRIVATE KEY-----|postgres(ql)?://[^:@/ ]+:[^@/ ]{8,}@[a-z0-9.-]+\.(supabase|neon|render|aws))'
hits=$(git ls-files -z | xargs -0 grep -EnI "$patterns" -- 2>/dev/null | grep -v '^scripts/check-secrets.sh' || true)
if [ -n "$hits" ]; then
  echo "✖ Posibles credenciales en archivos versionados:"; echo "$hits" | cut -c1-200; exit 1
fi
echo "✓ Sin secretos detectados"
