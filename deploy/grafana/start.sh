#!/bin/sh
# Whom the alarms are written to, put into the contact point as text before Grafana starts (MOL-145).
# Grafana 13.0 turns a value it read from the environment into a number when it looks like one, and
# its Telegram contact point takes the chat only as text: `$__env{OWNER_TELEGRAM_ID}` refused to
# start (grafana/alerting #558, fixed after 13.0.2). Written here, in the container, the id never
# enters the image, which is public as the repository is.
set -eu

case "${OWNER_TELEGRAM_ID:-}" in
  '' | - | *[!0-9-]* | ?*-*)
    echo "OWNER_TELEGRAM_ID must be a Telegram id: the alarms have nobody to write to" >&2
    exit 1
    ;;
esac

sed -i "s/\"chatid\": \"[^\"]*\"/\"chatid\": \"${OWNER_TELEGRAM_ID}\"/" \
  /etc/grafana/provisioning/alerting/notify.json

exec /run.sh "$@"
