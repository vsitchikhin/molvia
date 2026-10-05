#!/usr/bin/env bash
# Склейка близнецов руками владельца (MOL-106, В-2) — в базе этой рабочей копии.
#
#   bin/merge.sh merge <from-id> <into-id> [--yes]   склеить кандидата из утреннего отчёта
#   bin/merge.sh unmerge <номер> [--yes]             отменить склейку по её номеру в отчёте
#
# Без --yes — сухой прогон: та же склейка, откаченная в конце. На проде исходников нет, там тот же
# код лежит в образе API:
#   docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend node dist/merge.js unmerge 17 --yes

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
exec npm run --silent merge -w @molvia/backend -- "$@"
