#!/usr/bin/env bash
# Чеки, прочитанные не целиком (MOL-309), — в базе этой рабочей копии: причины за окно, один чек на разборе с
# фото, отпустить разобранное (MOL-310).
#
#   bin/receipt-misses.sh reasons <from> [<to>]
#   bin/receipt-misses.sh show <начало id> [<каталог>]
#   bin/receipt-misses.sh forget <начало id | день> [yes]
#
# Дни — ГГГГ-ММ-ДД по Еревану. forget по дню отпускает всё прочитанное до него; без yes — пробный прогон.
# На проде исходников нет, там тот же код лежит в образе API:
#   docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend node dist/receipt-misses.js reasons --from <from>
#   … exec backend node dist/receipt-misses.js show <id> --out /tmp/miss, затем docker compose cp backend:/tmp/miss .

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
command="${1:-}"
args=("$command")
case "$command" in
  reasons)
    args+=(--from "${2:-}")
    if [ -n "${3:-}" ]; then args+=(--to "$3"); fi
    ;;
  show)
    args+=("${2:-}")
    if [ -n "${3:-}" ]; then args+=(--out "$3"); fi
    ;;
  forget)
    if [[ "${2:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then args+=(--read-before "$2"); else args+=("${2:-}"); fi
    if [ "${3:-}" = yes ]; then args+=(--yes); fi
    ;;
esac
exec npm run --silent receipt-misses -w @molvia/backend -- "${args[@]}"
