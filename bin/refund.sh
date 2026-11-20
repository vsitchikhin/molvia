#!/usr/bin/env bash
# Вернуть деньги за платёж картой (MOL-277, Р-9) — в базе этой рабочей копии и банке её стенда. Без --yes —
# пробный прогон: платёж, что от него осталось и что вернётся; банк не спрашивается.
#
#   bin/refund.sh <номер заказа> [<драмы>] [--yes]
#
# Без суммы — всё, что осталось; полный возврат в 72 часа — отмена (CancelPayment), иначе RefundPayment. На проде
# исходников нет, там тот же код лежит в образе API:
#   docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend node dist/refund.js --order <номер> [--amount <драмы>] [--yes]

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
args=(--order "${1:-}")
if [ -n "${2:-}" ]; then args+=(--amount "$2"); fi
if [ "${3:-}" = "--yes" ]; then args+=(--yes); fi
exec npm run --silent refund -w @molvia/backend -- "${args[@]}"
