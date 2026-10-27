#!/usr/bin/env bash
# Чеки, прочитанные не целиком (MOL-309), — в базе этой рабочей копии: причины за окно, один чек на разборе с
# фото, отпустить разобранное (MOL-310).
#
#   bin/receipt-misses.sh reasons <from> [<to>]
#   bin/receipt-misses.sh show <начало id> [<каталог>]
#   bin/receipt-misses.sh forget <начало id> <день> [yes]   — одно из двух, другое пустое
#
# Дни — ГГГГ-ММ-ДД по Еревану. forget по дню отпускает всё прочитанное до него; без yes — пробный прогон.
# show без каталога пишет в .scratch/receipts/misses/<id>/ — вне git: фото и покупки человека в публичный
# репозиторий не попадут.
# На проде исходников нет, там тот же код лежит в образе API (P — docker compose -f docker-compose.prod.yml
# --env-file .env.prod):
#   P exec backend node dist/receipt-misses.js reasons --from <from>
#   P exec backend node dist/receipt-misses.js show <id> --out /tmp/miss, затем P cp backend:/tmp/miss .
#   P exec backend node dist/receipt-misses.js forget --read-before <день> --yes

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
    args+=("${2:-}" --out "${3:-$repo_root/.scratch/receipts/misses/${2:-none}}")
    ;;
  forget)
    # both given are refused by the command itself, never one of them dropped here (self-review №10)
    if [ -n "${2:-}" ]; then args+=("$2"); fi
    if [ -n "${3:-}" ]; then args+=(--read-before "$3"); fi
    if [ "${4:-}" = yes ]; then args+=(--yes); fi
    ;;
esac
exec npm run --silent receipt-misses -w @molvia/backend -- "${args[@]}"
