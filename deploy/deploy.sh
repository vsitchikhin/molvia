#!/usr/bin/env bash
# Rolls out one published image tag (MOL-90). The deploy key's forced command in
# ~/.ssh/authorized_keys: whatever the client asks for arrives in $SSH_ORIGINAL_COMMAND, and
# this script is the only thing that runs — so a stolen key can re-deploy an image already in
# the registry and nothing else. By hand: ~/molvia/deploy.sh sha-1a2b3c4
#
#   status          what runs here now and the hashes of the files a deploy relies on
#   sha-<7 hex>     an image built from a master commit
#   v<N>.<N>.<N>    an image named by a release tag
#
# While ~/molvia/deploy.hold exists every rollout is refused: restore.sh --into-prod sets it, and
# so can anyone maintaining the machine by hand. The API migrates when it starts, and a rollback
# puts the previous image back, not the schema.

set -euo pipefail

self="$(readlink -f "${BASH_SOURCE[0]}")"
molvia="${MOLVIA_DIR:-$HOME/molvia}"
health_seconds="${DEPLOY_HEALTH_SECONDS:-90}"
request="${SSH_ORIGINAL_COMMAND:-${1:-}}"

cd "$molvia"
compose=(docker compose -f docker-compose.prod.yml --env-file .env.prod)

# A line of .env.prod that sets $1, in any shape compose accepts: `export` in front, spaces
# around `=`, an indent.
assigns() { printf '^[[:space:]]*(export[[:space:]]+)?%s[[:space:]]*=[[:space:]]*' "$1"; }

# A value as compose reads it: the quotes around it and a trailing ` # comment` are not part of it.
setting() {
  local value
  value="$(sed -nE "s/$(assigns "$1")//p" .env.prod | tail -n 1)"
  case "$value" in
    \"*) value="${value#\"}" && value="${value%%\"*}" ;;
    \'*) value="${value#\'}" && value="${value%%\'*}" ;;
    *) value="${value%%[[:space:]]#*}" && value="${value%"${value##*[![:space:]]}"}" ;;
  esac
  printf '%s\n' "$value"
}

if [[ "$request" == status ]]; then
  echo "image_tag=$(setting IMAGE_TAG)"
  echo "compose=$(sha256sum docker-compose.prod.yml | cut -d' ' -f1)"
  echo "deploy=$(sha256sum "$self" | cut -d' ' -f1)"
  exit 0
fi

if [[ ! "$request" =~ ^(sha-[0-9a-f]{7}|v[0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "refused: expected status, sha-<7 hex> or v<N>.<N>.<N>" >&2
  exit 2
fi
tag="$request"

# One deploy at a time on this machine too, whatever Actions believes about concurrency. Nothing
# has changed yet, so a client that goes away while this waits costs nothing.
exec 9>"$molvia/.deploy.lock"
if ! flock -n 9; then
  echo "waiting for a rollout in progress"
  flock -w 600 9 || { echo "refused: a rollout still holds the lock after 600 s" >&2; exit 4; }
fi
if [[ -e "$molvia/deploy.hold" ]]; then
  echo "refused: $molvia/deploy.hold exists — a restore or maintenance is in progress; re-run once it is gone" >&2
  exit 3
fi

# Everything from here goes to deploy.log, and a separate tail carries this rollout's part of it to
# the client. A client that goes away — a job cancelled, a runner off the network — takes the tail
# with it and nothing else: the rollout, or its rollback, runs to the end. The log keeps every
# rollout that went ahead, the latest last, and its oldest half goes past a megabyte.
log="$molvia/deploy.log"
touch "$log"
if (($(stat -c %s "$log") > 1000000)); then
  tail -c 500000 "$log" >"$log.next" && mv "$log.next" "$log"
fi
tail -c +"$(($(stat -c %s "$log") + 1))" --pid=$$ -f "$log" 2>/dev/null 9>&- &
exec >>"$log" 2>&1
echo "── $(date -u +%FT%TZ) $tag"

domain="$(setting DOMAIN)"
port="$(setting HTTPS_PORT)"
port="${port:-443}"

# What answers ok through Caddy, the way a phone reaches it, but without leaving the machine.
health() {
  local body
  body="$(curl -fsS -m 5 --resolve "$domain:$port:127.0.0.1" "https://$domain:$port/api/health")" || return 1
  [[ "$body" == *'"status":"ok"'* ]] || return 1
  sed -n 's/.*"version":"\([^"]*\)".*/\1/p' <<<"$body"
}

# Every service runs a container created from this tag. Checked by the image rather than by the
# version /health names, because images built before MOL-90 all call themselves 0.0.0 — and
# those are exactly the ones a rollback by hand goes to.
running_tag() {
  local tag="$1" service image seen=0
  while read -r service image; do
    case "$service" in backend | bot | frontend) [[ "$image" == *":$tag" ]] && seen=$((seen + 1)) ;; esac
  done < <("${compose[@]}" ps --format '{{.Service}} {{.Image}}')
  ((seen == 3))
}

# The bot restarts on failure, so «running» alone can be a crash loop caught between two starts.
# Its restarts are counted from where they stood before `up -d`: a new container starts at 0, and
# one `up -d` left in place — the same tag rolled out again — keeps the count it already had.
bot_state() {
  local id
  id="$("${compose[@]}" ps -q bot)" || return 1
  [[ -n "$id" ]] || return 1
  echo "$id $(docker inspect --format '{{.State.Running}} {{.RestartCount}}' "$id")"
}
bot_steady() {
  local id running count
  read -r id running count <<<"$(bot_state)" || return 1
  [[ "$running" == true ]] || return 1
  if [[ "$id" == "${bot_before%% *}" ]]; then
    [[ "$count" == "${bot_before##* }" ]]
  else
    [[ "$count" == 0 ]]
  fi
}

wait_healthy() {
  local tag="$1" deadline=$((SECONDS + health_seconds)) version=""
  while ((SECONDS < deadline)); do
    if running_tag "$tag" && version="$(health)" && bot_steady; then
      sleep 5
      if bot_steady; then
        echo "healthy: $tag answers as ${version:-?}"
        return 0
      fi
    fi
    sleep 2
  done
  echo "not healthy after ${health_seconds}s: $tag" >&2
  return 1
}

set_tag() {
  local next
  next="$(mktemp .env.prod.XXXXXX)"
  { grep -vE "$(assigns IMAGE_TAG)" .env.prod || true; echo "IMAGE_TAG=$1"; } >"$next"
  chmod 600 "$next"
  mv "$next" .env.prod
}

previous="$(setting IMAGE_TAG)"
echo "deploying $tag over ${previous:-nothing}"

# Pulled before anything changes: a tag the registry does not have leaves the machine as it was.
IMAGE_TAG="$tag" "${compose[@]}" pull -q backend bot frontend

bot_before="$(bot_state || true)"
set_tag "$tag"
if "${compose[@]}" up -d && wait_healthy "$tag"; then
  # Unused images older than a week: a deploy a day leaves three behind each time.
  docker image prune -af --filter until=168h >/dev/null || true
  echo "deployed $tag"
  exit 0
fi

if [[ -z "$previous" ]]; then
  echo "failed, and there is no previous tag to go back to" >&2
  exit 1
fi
echo "rolling back to $previous — a migration $tag applied stays applied" >&2
bot_before="$(bot_state || true)"
set_tag "$previous"
"${compose[@]}" up -d || true
wait_healthy "$previous" || echo "$previous is not healthy either — the machine needs hands" >&2
exit 1
