#!/usr/bin/env bash
# Чеки, прочитанные не целиком (MOL-309), — в базе этой рабочей копии: причины за окно, один чек на разборе с
# фото, отпустить разобранное (MOL-310).
#
#   bin/receipt-misses.sh reasons <from> [<to>]
#   bin/receipt-misses.sh show <начало id> [<каталог>]
#   bin/receipt-misses.sh forget <начало id> <день> [yes]   — одно из двух, другое пустое
#
# Дни — ГГГГ-ММ-ДД по Еревану. forget по дню отпускает всё прочитанное до него; без yes — пробный прогон.
# show без каталога пишет в .scratch/receipts/misses/receipt-miss-<id>/ — вне git: фото и покупки человека в
# публичный репозиторий не попадут; forget с yes удаляет и эти копии.
# На проде исходников нет, там тот же код лежит в образе API (P — docker compose -f docker-compose.prod.yml
# --env-file .env.prod):
#   P exec backend node dist/receipt-misses.js reasons --from <from>
#   P exec backend node dist/receipt-misses.js show <id>  → /tmp/receipt-miss-<id> контейнера; P cp его к себе
#   P exec backend node dist/receipt-misses.js forget --read-before <день> --yes  — удаляет и копии в /tmp

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
    # copies under .scratch, out of git; forget lets them go from there too (adversarial Б2)
    args+=("${2:-}")
    if [ -n "${3:-}" ]; then args+=(--out "$3"); else args+=(--root "$repo_root/.scratch/receipts/misses"); fi
    ;;
  forget)
    # both given are refused by the command itself, never one of them dropped here (self-review №10)
    if [ -n "${2:-}" ]; then args+=("$2"); fi
    if [ -n "${3:-}" ]; then args+=(--read-before "$3"); fi
    args+=(--root "$repo_root/.scratch/receipts/misses")
    if [ "${4:-}" = yes ]; then args+=(--yes); fi
    ;;
esac
exec npm run --silent receipt-misses -w @molvia/backend -- "${args[@]}"
