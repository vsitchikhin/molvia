#!/usr/bin/env bash
# Последние сбои API и бота (MOL-143) — в базе этой рабочей копии. Только чтение.
#
#   bin/failures.sh [<limit>]
#
# <limit> — сколько отпечатков, 1…200, по умолчанию 20. На проде исходников нет, там тот же код
# лежит в образе API:
#   docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend node dist/failures.js --limit 50

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
args=()
if [ -n "${1:-}" ]; then args+=(--limit "$1"); fi
exec npm run --silent failures -w @molvia/backend -- ${args[@]+"${args[@]}"}
