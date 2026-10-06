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
# The cutoff keeps it one PUT: rclone's multipart upload sends a CRC64NVME checksum that R2 answers
# with 501 — what broke the run once the dump outgrew the default 100 KiB.
# Receipt photos and the lines cut out of them stay out of the copy (MOL-125, В-2): their tables come
# back empty from a restore. A photo carries a customer's name and lives only until the receipt is
# recorded; a copy kept fourteen days would keep it longer than the promise on /privacy. The pictures
# of messages to the developer stay out for the same reason (MOL-167): kept only until the owner's
# Telegram has them, at most a week. The link of a Serbian receipt still being asked of the tax office
# stays out too (MOL-232, adversarial А4): it may carry the buyer's tax id, and /privacy keeps it only
# until the tax office answered — up to two days, never the copy's fourteen.
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
    --exclude-table-data=receipt_parts --exclude-table-data=receipt_line_images \
    --exclude-table-data=feedback_picture_files --exclude-table-data=receipt_links' \
  | age --encrypt --recipient "$AGE_RECIPIENT" \
  | rclone rcat --streaming-upload-cutoff 1G "$partial"

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
