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

# Access's keys from the team's domain, `<team>.cloudflareaccess.com` (MOL-399): a team written another way
# — its name alone, the domain twice, a scheme — is a URL with no keys behind it, and every pass of the owner
# is refused with nothing but Grafana's own «Failed to verify JWT» (adversarial А6). Said here, in its words;
# Grafana starts all the same, since the alarms are not the door's.
if [ -n "${GF_AUTH_JWT_JWK_SET_URL:-}" ]; then
  team="${GF_AUTH_JWT_JWK_SET_URL#https://}"
  team="${team%.cloudflareaccess.com/cdn-cgi/access/certs}"
  case "$team" in
    '' | *[!a-z0-9-]*)
      echo "GRAFANA_ACCESS_DOMAIN is not <team>.cloudflareaccess.com: nobody gets in from outside" >&2
      ;;
  esac
fi

sed -i "s/\"chatid\": \"[^\"]*\"/\"chatid\": \"${OWNER_TELEGRAM_ID}\"/" \
  /etc/grafana/provisioning/alerting/notify.json

# The address an alarm names (MOL-399): `grafana.<DOMAIN>`. Grafana reads no environment inside a
# template — `$__env{…}` came out as itself (probe of 16.11.2026) — so it is written here as the chat is.
# Its place is a comment of the template, so an address this check refuses leaves the line without one
# and the alarms going, rather than stop them over a word of a message.
case "${GF_SERVER_ROOT_URL:-}" in
  https://*[!A-Za-z0-9.:/-]*) plain=no ;;
  https://?*) plain=yes ;;
  *) plain=no ;;
esac
if [ "$plain" = yes ]; then
  sed -i "s#{{/\* GF_SERVER_ROOT_URL, written by start.sh \*/}}#${GF_SERVER_ROOT_URL}#" \
    /etc/grafana/provisioning/alerting/notify.json
else
  echo "GF_SERVER_ROOT_URL is not a plain https address: the alarms name no dashboard" >&2
fi

# The password of `.env.prod` is the password, at every start (adversarial А6): Grafana reads
# GF_SECURITY_ADMIN_PASSWORD only when it creates its database, so a password changed after a leak
# changed nothing and the old one still opened it. Through stdin, never the arguments, which every
# user of the machine reads in `ps` (review №14), and whatever it begins with (round 2, Б2: `-…` was
# a flag). A password the reset refuses stops Grafana rather than leave the old one open: the pulse
# of the alarms goes quiet, and healthchecks.io says so.
if [ -n "${GF_SECURITY_ADMIN_PASSWORD:-}" ] &&
  ! printf '%s' "${GF_SECURITY_ADMIN_PASSWORD}" |
  grafana cli --homepath /usr/share/grafana --config /etc/grafana/grafana.ini \
    admin reset-admin-password --password-from-stdin >/dev/null 2>&1; then
  echo "GRAFANA_ADMIN_PASSWORD was refused as the admin's password — too short? Grafana stops" >&2
  exit 1
fi

exec /run.sh "$@"
