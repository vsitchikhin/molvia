#!/bin/sh
# Whom the alarms are written to, put into the contact point as text before Grafana starts (MOL-145).
# Grafana 13.0 turns a value it read from the environment into a number when it looks like one, and
# its Telegram contact point takes the chat only as text: `$__env{OWNER_TELEGRAM_ID}` refused to
# start (grafana/alerting #558, fixed after 13.0.2). Written here, in the container, the id never
# enters the image, which is public as the repository is.
set -eu

# Digits and nothing else — the API's own rule (`ownerTelegramIdSchema`): a line one of them took and
# the other refused would stop Grafana, and every alarm with it, while the API ran on.
case "${OWNER_TELEGRAM_ID:-}" in
  '' | *[!0-9]*)
    echo "OWNER_TELEGRAM_ID must be a Telegram id: the alarms have nobody to write to" >&2
    exit 1
    ;;
esac

sed -i "s/\"chatid\": \"[^\"]*\"/\"chatid\": \"${OWNER_TELEGRAM_ID}\"/" \
  /etc/grafana/provisioning/alerting/notify.json

# The password of `.env.prod` is the password, at every start (adversarial А6): Grafana reads
# GF_SECURITY_ADMIN_PASSWORD only when it creates its database, so a password changed after a leak
# changed nothing and the old one still opened it. A reset that fails is said and does not stop the
# alarms.
if [ -n "${GF_SECURITY_ADMIN_PASSWORD:-}" ] &&
  ! grafana cli --homepath /usr/share/grafana --config /etc/grafana/grafana.ini \
    admin reset-admin-password "${GF_SECURITY_ADMIN_PASSWORD}" >/dev/null 2>&1; then
  echo "the admin's password was not set from GRAFANA_ADMIN_PASSWORD" >&2
fi

exec /run.sh "$@"
