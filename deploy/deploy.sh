#!/usr/bin/env bash
# Rolls out one published image tag (MOL-90). The deploy key's forced command in
# ~/.ssh/authorized_keys: whatever the client asks for arrives in $SSH_ORIGINAL_COMMAND, and
# this script is the only thing that runs — so a stolen key can re-deploy an image already in
# the registry and nothing else. By hand: ~/molvia/deploy.sh sha-1a2b3c4
#
#   status          what runs here now and the hashes of the files a deploy relies on
#   sha-<7 hex>     an image built from a master commit
#   v<N>.<N>.<N>    an image built from a release tag
#
# The API migrates when it starts, and a rollback puts the previous image back, not the schema.

set -euo pipefail

molvia="${MOLVIA_DIR:-$HOME/molvia}"
health_seconds="${DEPLOY_HEALTH_SECONDS:-90}"
request="${SSH_ORIGINAL_COMMAND:-${1:-}}"

cd "$molvia"
compose=(docker compose -f docker-compose.prod.yml --env-file .env.prod)

setting() { sed -n "s/^$1=//p" .env.prod | tail -n 1; }

if [[ "$request" == status ]]; then
  echo "image_tag=$(setting IMAGE_TAG)"
  echo "compose=$(sha256sum docker-compose.prod.yml | cut -d' ' -f1)"
  echo "deploy=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)"
  exit 0
fi

if [[ "$request" =~ ^sha-([0-9a-f]{7})$ ]]; then
  # Master builds describe themselves in the long form, so the commit is always in the version.
  expected="v.+-g${BASH_REMATCH[1]}[0-9a-f]*"
elif [[ "$request" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  expected="${request//./\\.}"
else
  echo "refused: expected status, sha-<7 hex> or v<N>.<N>.<N>" >&2
  exit 2
fi
tag="$request"

# One deploy at a time on this machine too, whatever Actions believes about concurrency.
exec 9>"$molvia/.deploy.lock"
flock -w 600 9

domain="$(setting DOMAIN)"
port="$(setting HTTPS_PORT)"
port="${port:-443}"

# Through Caddy, the way a phone reaches it, but without leaving the machine.
version_answering() {
  local body
  body="$(curl -fsS -m 5 --resolve "$domain:$port:127.0.0.1" "https://$domain:$port/api/health")"
  [[ "$body" == *'"status":"ok"'* ]] || return 1
  sed -n 's/.*"version":"\([^"]*\)".*/\1/p' <<<"$body"
}

bot_running() { "${compose[@]}" ps --status running --services | grep -qx bot; }

# Healthy means the API answers ok as the build that was asked for — an old container still
# answering is not a deploy — and the bot stays up past its first seconds.
wait_healthy() {
  local pattern="$1" deadline=$((SECONDS + health_seconds)) version
  while ((SECONDS < deadline)); do
    version="$(version_answering 2>/dev/null || true)"
    if [[ -n "$version" && "$version" =~ ^${pattern}$ ]] && bot_running; then
      sleep 5
      if bot_running; then
        echo "healthy: $version"
        return 0
      fi
    fi
    sleep 2
  done
  echo "not healthy after ${health_seconds}s: api answers '${version:-nothing}'" >&2
  return 1
}

set_tag() {
  local next
  next="$(mktemp .env.prod.XXXXXX)"
  { grep -v '^IMAGE_TAG=' .env.prod || true; echo "IMAGE_TAG=$1"; } >"$next"
  chmod 600 "$next"
  mv "$next" .env.prod
}

previous="$(setting IMAGE_TAG)"
echo "deploying $tag over ${previous:-nothing}"

# Pulled before anything changes: a tag the registry does not have leaves the machine as it was.
IMAGE_TAG="$tag" "${compose[@]}" pull -q backend bot frontend

set_tag "$tag"
"${compose[@]}" up -d

if wait_healthy "$expected"; then
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
set_tag "$previous"
"${compose[@]}" up -d
wait_healthy '.+' || true
exit 1
