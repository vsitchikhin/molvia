#!/usr/bin/env bash
# Стирает всё о человеке по его Telegram-id (MOL-58) — в базе этой рабочей копии.
#
#   bin/forget-actor.sh <telegram-id>          сухой прогон: сколько строк уйдёт, ничего не меняет
#   bin/forget-actor.sh <telegram-id> --yes    стереть — необратимо
#
# Люди удаляют себя сами, командой /delete в боте. Это запасной путь владельца — на случай,
# когда бот лежит. На проде исходников нет, там тот же код лежит в образе API:
#   docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend node dist/forget.js <id>

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
exec npm run --silent forget -w @molvia/backend -- "$@"
