#!/usr/bin/env bash
# Восстанавливает .scratch и .lavish — симлинки в общий каталог вне репозитория.
#
# Общий каталог живёт рядом с клонами: <родитель>/_shared/molvia/{scratch,lavish}.
# Он один на все клоны и воркtree: продуктовый план, планы задач и lavish-артефакты
# не размножаются по копиям и переживают удаление любой из них.
#
# Запускать после каждого клона / git worktree add. Идемпотентно.
# Переопределить каталог: MOLVIA_SHARED=/path/to/shared bin/link-shared.sh

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
parent="$(dirname "$repo_root")"
shared="${MOLVIA_SHARED:-$parent/_shared/molvia}"

# относительная ссылка, если общий каталог рядом с клоном — тогда она переживёт
# перенос всего дерева projects/ в другое место
if [ "$shared" = "$parent/_shared/molvia" ]; then
  target_prefix="../_shared/molvia"
else
  target_prefix="$shared"
fi

mkdir -p "$shared/scratch/docs" "$shared/scratch/tasks/plans" "$shared/lavish"

link() {
  local name="$1" target="$target_prefix/$1" path="$repo_root/.$1"

  if [ -L "$path" ]; then
    if [ "$(readlink "$path")" = "$target" ]; then
      echo "  ok      .$name"
      return
    fi
    rm "$path"
    ln -s "$target" "$path"
    echo "  repoint .$name -> $target"
    return
  fi

  if [ -e "$path" ]; then
    if [ -d "$path" ] && [ -z "$(ls -A "$path")" ]; then
      rmdir "$path"
    else
      echo "  ОШИБКА  .$name существует и не пуст — перенеси содержимое в $shared/$name и удали каталог" >&2
      return 1
    fi
  fi

  ln -s "$target" "$path"
  echo "  link    .$name -> $target"
}

echo "общий каталог: $shared"
link scratch
link lavish
