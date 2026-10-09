#!/usr/bin/env bash
# Пишет людям ботом об утечке (MOL-237) — в базе этой рабочей копии; разносит бот этой копии.
#
#   bin/notify.sh <файл> [<страны>] [--owner] [--yes]   без --yes — сухой прогон: текст и сколько получат
#   bin/notify.sh "" --status                             как идёт последняя рассылка
#   bin/notify.sh "" --cancel                             остановить: больше ничего не уйдёт
#
# <страны> — коды через запятую (AM,GE); без них — все. --owner — пробная, одному владельцу
# (OWNER_TELEGRAM_ID). --yes — поставить в очередь. На проде исходников нет, там тот же код лежит в
# образе API, а текст едет по ssh на стандартный ввод:
#   ssh molvia 'cd ~/molvia && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T backend node dist/notify.js [--yes]' < notice.txt

set -euo pipefail

# The countries are the second word unless it is a flag: `bin/notify.sh <файл>` alone is a dry run
# for everybody, and `bin/notify.sh <файл> --yes` does not take `--yes` for countries (adversarial А3).
file="${1:-}"
[ $# -gt 0 ] && shift
countries=""
if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
  countries="$1"
  shift
fi
args=("$@")
if [ -n "$countries" ]; then args+=("--country=$countries"); fi

# The file is opened here, before the move to the root, so a path is the caller's.
if [ -n "$file" ]; then
  if [ ! -f "$file" ] || [ ! -r "$file" ]; then
    echo "cannot read the message file: $file"
    exit 2
  fi
  exec <"$file"
else
  exec </dev/null
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
exec npm run --silent notify -w @molvia/backend -- ${args[@]+"${args[@]}"}
