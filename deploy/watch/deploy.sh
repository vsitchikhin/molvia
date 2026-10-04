#!/usr/bin/env bash
# Rolls the outside watch out to Cloudflare (MOL-221): bundles the Worker «molvia-watch», uploads it
# with its plain variable and keeping its secret, sets its cron and keeps it off `*.workers.dev` —
# it has no page to show, only a schedule. Three calls of Cloudflare's own API, so no wrangler.
#
# Run by the release after green CI on master, and by hand with `make watcher`:
#   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… deploy/watch/deploy.sh
#
# The token needs «Workers Scripts: Edit» on the account and nothing else. The ping URL is the
# Worker's secret `HC_UP_URL`, set once on Cloudflare and never here (deploy/README.md, «Signals»).
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is not set}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is not set}"

NAME=molvia-watch
# The runtime the Worker was last tested against; moved by hand, as a dependency would be.
COMPATIBILITY_DATE=2026-09-01
CRON='*/5 * * * *'

here="$(cd "$(dirname "$0")" && pwd)"
npm run --silent bundle --prefix "$here"

api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$NAME"

# A call that Cloudflare refused stops the rollout and prints its errors — never the token.
call() {
  local method="$1" path="$2" answer
  shift 2
  answer="$(curl -sS -m 60 -X "$method" "$api$path" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$@")"
  if ! jq -e '.success == true' >/dev/null <<<"$answer"; then
    echo "$method $NAME$path refused: $(jq -c '.errors // .' <<<"$answer" 2>/dev/null || echo "$answer")" >&2
    exit 1
  fi
}

# `DOMAIN` is set again by every rollout: changed by hand on Cloudflare to try the alarm, it comes
# back here. The secret stays as it was.
metadata="$(jq -cn --arg date "$COMPATIBILITY_DATE" '{
  main_module: "worker.js",
  compatibility_date: $date,
  bindings: [{ type: "plain_text", name: "DOMAIN", text: "molvia.net" }],
  keep_bindings: ["secret_text"],
  observability: { enabled: true }
}')"

call PUT '' \
  -F "metadata=$metadata;type=application/json" \
  -F "worker.js=@$here/dist/worker.js;type=application/javascript+module"
call PUT /schedules -H 'Content-Type: application/json' --data "$(jq -cn --arg cron "$CRON" '[{ cron: $cron }]')"
call POST /subdomain -H 'Content-Type: application/json' --data '{"enabled":false}'

echo "$NAME is out, every five minutes"
