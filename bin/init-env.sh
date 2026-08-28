#!/usr/bin/env bash
# Создаёт .env для этой копии проекта. Все значения литеральные: никакой
# арифметики и никаких ${...} внутри — dotenv в Node подстановку не делает,
# и файл, который выглядит вычисляемым, тихо работает не так, как написано.
#
#   bin/init-env.sh          # индекс из имени каталога: molvia → 0, molvia2 → 2
#   bin/init-env.sh 7        # индекс явно
#   bin/init-env.sh 7 --force  # перезаписать существующий .env
#
# Порты разводятся смещением индекс*10, база и compose-проект — суффиксом.
# Полоса портов у молвии своя (3300 / 5300 / 5500), а не дефолтная: на машине
# уже живут постгрес и Vite рабочего проекта на 5432 и 5173.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir_name="$(basename "$repo_root")"

index="${1:-}"
if [ -z "$index" ] || [ "$index" = "--force" ]; then
  # molvia → 0, molvia2 → 2, molvia3 → 3
  index="$(printf '%s' "$dir_name" | sed -n 's/.*[^0-9]\([0-9]\{1,\}\)$/\1/p')"
  index="${index:-0}"
fi
[ "$index" -ge 0 ] 2>/dev/null || { echo "индекс должен быть неотрицательным числом: $index" >&2; exit 1; }

force=0
for arg in "$@"; do [ "$arg" = "--force" ] && force=1; done

env_path="$repo_root/.env"
if [ -e "$env_path" ] && [ "$force" -eq 0 ]; then
  echo "ОШИБКА  .env уже существует. Перезаписать: bin/init-env.sh $index --force" >&2
  exit 1
fi

offset=$(( index * 10 ))
api_port=$(( 3300 + offset ))
pwa_port=$(( 5300 + offset ))
pg_port=$((  5500 + offset ))

busy=""
for p in "$api_port" "$pwa_port" "$pg_port"; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then busy="$busy $p"; fi
done

cat > "$env_path" <<ENV
# Сгенерирован bin/init-env.sh для копии «${dir_name}», CLONE_INDEX=${index}.
# Только литералы — подстановку \${...} dotenv не выполняет.
CLONE_INDEX=${index}
COMPOSE_PROJECT=molvia_${index}

API_PORT=${api_port}
PWA_PORT=${pwa_port}
POSTGRES_PORT=${pg_port}

POSTGRES_DB=molvia_${index}
POSTGRES_USER=molvia
POSTGRES_PASSWORD=molvia
DATABASE_URL=postgres://molvia:molvia@127.0.0.1:${pg_port}/molvia_${index}
# Integration tests get their own database on the same server, so a test run can
# never truncate the data you have been entering by hand.
TEST_DATABASE_URL=postgres://molvia:molvia@127.0.0.1:${pg_port}/molvia_${index}_test

# У КАЖДОЙ КОПИИ СВОЙ БОТ. Два процесса на одном токене воруют друг у друга
# апдейты через long polling — молча и невоспроизводимо. Завести отдельного
# в BotFather, если эта копия будет работать параллельно с другой.
TELEGRAM_BOT_TOKEN=

# Открытый API ЦБ Армении, ключа не требует
CBA_RATES_URL=https://cb.am/latest.json.php
ENV

echo ".env создан: CLONE_INDEX=$index, api=$api_port pwa=$pwa_port postgres=$pg_port, база molvia_$index"
[ -n "$busy" ] && echo "ВНИМАНИЕ порты заняты:$busy — другая копия уже поднята или индекс совпал" >&2
echo "Осталось вписать TELEGRAM_BOT_TOKEN."
