#!/usr/bin/env bash
# The nightly copy of the production database (MOL-70). Dumped inside the postgres container,
# encrypted on the spot to the owner's age key and streamed to the bucket: nothing unencrypted
# ever touches a disk, and the key that opens a copy never comes to this machine.
#
# Run by molvia-backup.timer; by hand: sudo systemctl start molvia-backup.service
# Every run ends in a ping to healthchecks.io with its exit code, and a missing ping is the
# alarm — a timer that never fired is the failure nothing else would report.

set -euo pipefail

molvia="${MOLVIA_DIR:-$HOME/molvia}"
# shellcheck source=/dev/null
. "$molvia/backup.env"
: "${AGE_RECIPIENT:?set in backup.env}" "${RCLONE_REMOTE:?set in backup.env}"
: "${HC_URL:?set in backup.env}" "${DELETE_AFTER_DAYS:?set in backup.env}"

report() { curl -fsS -m 10 --retry 3 -o /dev/null "$HC_URL/$1" || true; }
partial=""
finish() {
  local code=$?
  # A run that failed leaves nothing behind: an upload cut short is not a copy.
  if ((code != 0)) && [[ -n "$partial" ]]; then rclone deletefile "$partial" 2>/dev/null || true; fi
  report "$code"
}
trap finish EXIT
report start

cd "$molvia"
name="molvia-$(date -u +%Y-%m-%dT%H%MZ).dump.age"
partial="$RCLONE_REMOTE/partial/$name"

# rclone rcat finishes the upload when its input ends, whether or not pg_dump succeeded — so the
# copy goes up under partial/ and becomes a copy only once the whole pipe has exited cleanly.
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  | age --encrypt --recipient "$AGE_RECIPIENT" \
  | rclone rcat "$partial"

size="$(rclone lsjson "$partial" | sed -n 's/.*"Size":\([0-9]*\).*/\1/p')"
header="$(rclone cat --count 21 "$partial")"
if [[ "${size:-0}" -le 0 || "$header" != "age-encryption.org/v1" ]]; then
  echo "refused: $name is ${size:-0} bytes and does not start as an age file" >&2
  exit 1
fi
rclone moveto "$partial" "$RCLONE_REMOTE/$name"
partial=""

# The bucket's lifecycle rule is what enforces the term; this only keeps a broken rule from
# holding erased people longer than the privacy page says.
rclone delete --min-age "${DELETE_AFTER_DAYS}d" "$RCLONE_REMOTE"

echo "copied $name, $size bytes"
