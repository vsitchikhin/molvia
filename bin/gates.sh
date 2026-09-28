#!/usr/bin/env bash
# Читает ворота 0.2 и 0.3 (MOL-91) — в базе этой рабочей копии. Только чтение.
#
#   bin/gates.sh <from> [<to>]
#
# <from>, <to> — день ГГГГ-ММ-ДД по Еревану (день <to> входит целиком) или момент ISO 8601 со
# смещением. Без <to> — до сейчас. На проде исходников нет, там тот же код лежит в образе API:
#   docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend node dist/gates.js --from <from>

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
args=(--from "${1:-}")
if [ -n "${2:-}" ]; then args+=(--to "$2"); fi
exec npm run --silent gates -w @molvia/backend -- "${args[@]}"
