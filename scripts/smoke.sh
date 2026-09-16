#!/usr/bin/env bash
# Smoke test post-deploy. Uso: scripts/smoke.sh https://dominio [HEALTH_TOKEN]
# Verifica: health, ready (base), home, buscador, una ficha real, redirect del sitio anterior, CRM login, robots, sitemap,
# headers de seguridad y que el CRM no sea indexable. Sale con código ≠ 0 ante la primera falla.
set -uo pipefail
BASE="${1:?Uso: smoke.sh <url-base> [health-token]}"
TOKEN="${2:-${HEALTH_TOKEN:-}}"
fail=0
check() { # nombre, comando que debe devolver 0
  if eval "$2" >/dev/null 2>&1; then echo "✓ $1"; else echo "✖ $1"; fail=1; fi
}
code() { curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$@"; }

check "health 200" '[ "$(code "$BASE/api/health")" = 200 ]'
check "ready 200 (base de datos)" '[ "$(code "$BASE/api/ready")" = 200 ]'
if [ -n "$TOKEN" ]; then
  check "ready detallado sin jobs muertos" 'curl -s --max-time 20 -H "authorization: Bearer $TOKEN" "$BASE/api/ready" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(1 if d.get(\"jobs24h\",{}).get(\"dead\",0) else 0)"'
fi
check "home 200" '[ "$(code "$BASE/")" = 200 ]'
check "buscador 200" '[ "$(code "$BASE/propiedades")" = 200 ]'
slug=$(curl -s --max-time 20 "$BASE/sitemap.xml" | grep -oE "/propiedades/[a-z0-9-]+-[0-9]+" | head -1)
check "sitemap con fichas" '[ -n "$slug" ]'
[ -n "$slug" ] && check "ficha real 200" '[ "$(code "$BASE$slug")" = 200 ]'
code_num=$(echo "$slug" | grep -oE "[0-9]+$")
[ -n "$code_num" ] && check "redirect /luciolopez-$code_num → 301/308" '[[ "$(code "$BASE/luciolopez-$code_num")" =~ ^30[178]$ ]]'
check "CRM login 200" '[ "$(code "$BASE/crm/login")" = 200 ]'
check "CRM protegido (redirige a login)" '[[ "$(code "$BASE/crm")" =~ ^30[37]$ ]]'
check "CRM noindex" 'curl -sI --max-time 20 "$BASE/crm/login" | grep -qi "x-robots-tag: noindex"'
check "CSP presente" 'curl -sI --max-time 20 "$BASE/" | grep -qi "content-security-policy"'
check "robots.txt" '[ "$(code "$BASE/robots.txt")" = 200 ]'
check "cron protegido (401 sin secreto)" '[ "$(code "$BASE/api/cron/jobs")" = 401 ]'
exit $fail
