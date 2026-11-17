#!/usr/bin/env bash
# The «фф» of production (MOL-382), run in ~/molvia beside docker-compose.prod.yml and .env.prod:
#
#   ./ff.sh venues on    the line FF_VENUES=on in .env.prod — in place of any line of it, added where there
#                        is none: production's file was made before MOL-382 and has no such line, and a
#                        `sed` that replaced one changed nothing there, saying nothing (adversarial А6)
#   ./ff.sh              only checks
#
# Either way every фф compose reads from .env.prod — asked of compose, never parsed (`deploy.md`) — is
# checked against the names the compose file passes to the API. A name it does not pass — FF_PAYMNETS=on,
# ff_payments=on — never reaches the API, which starts with that фф off and says nothing (adversarial А5);
# so it stops here, named, and nothing is written. The restart is the README's.
set -euo pipefail

compose_file=docker-compose.prod.yml
env_file=.env.prod
[[ -f $compose_file && -f $env_file ]] ||
  { echo "ff.sh: run it beside $compose_file and $env_file" >&2; exit 2; }

# What compose reads from an env file — the shell's own variables over it, as at `up`.
environment() { docker compose -f "$compose_file" --env-file "$1" config --environment; }

# FF_VENUES and FF_PAYMENTS, as the compose file passes them: «FF_VENUES: ${FF_VENUES:-off}».
known=$(grep -oE '^[[:space:]]+FF_[A-Z0-9_]+:' "$compose_file" | tr -d ' \t:' || true)
[[ -n $known ]] || { echo "ff.sh: $compose_file passes no фф" >&2; exit 2; }

# Every фф compose reads from `file` — by any spelling, `-` for `_`, any case — each wrong one named.
check() {
  local wrong=0 heard line name value
  heard=$(environment "$1")
  while IFS= read -r line; do
    name=${line%%=*}
    value=${line#*=}
    if ! grep -qxF -- "$name" <<<"$known"; then
      echo "ff.sh: «$name» is no фф $compose_file passes — the API would never see it." \
        "Known: $(tr '\n' ' ' <<<"$known")" >&2
      wrong=1
    elif [[ $value != on && $value != off ]]; then
      echo "ff.sh: $name=$value — on or off, nothing else" >&2
      wrong=1
    fi
  done < <(grep -iE '^ff[^=]*=' <<<"$heard" || true)
  return $wrong
}

if (($# == 0)); then
  check "$env_file"
  grep -E '^FF_' <(environment "$env_file") || echo "ff.sh: no фф in $env_file — every one is off"
  exit 0
fi

(($# == 2)) || { echo "usage: ./ff.sh [<name> on|off]" >&2; exit 2; }
[[ $1 =~ ^[a-z][a-z0-9_]*$ ]] || { echo "ff.sh: «$1» — a name is Latin snake_case: venues" >&2; exit 2; }
[[ $2 == on || $2 == off ]] || { echo "ff.sh: «$2» — on or off" >&2; exit 2; }
name=FF_$(tr '[:lower:]' '[:upper:]' <<<"$1")
grep -qxF -- "$name" <<<"$known" ||
  { echo "ff.sh: no фф «$1» in $compose_file. Known: $(tr '\n' ' ' <<<"$known")" >&2; exit 1; }

next=$(mktemp "$env_file.XXXXXX")
trap 'rm -f "$next"' EXIT
# its first line replaced and any other dropped, or one added at the end
awk -v name="$name" -v line="$name=$2" '
  $0 ~ "^[[:space:]]*(export[[:space:]]+)?" name "[[:space:]]*=" { if (!done) print line; done = 1; next }
  { print }
  END { if (!done) print line }
' "$env_file" >"$next"
check "$next"
became=$(environment "$next" | sed -n "s/^$name=//p" | tail -n 1)
[[ $became == "$2" ]] ||
  { echo "ff.sh: compose would read $name=$became — a variable of this shell wins over the file" >&2; exit 1; }
# written over, not moved: the file keeps its owner and its mode
cat "$next" >"$env_file"
echo "ff.sh: $name=$2 in $env_file; now: docker compose -f $compose_file --env-file $env_file up -d backend"
