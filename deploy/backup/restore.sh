#!/usr/bin/env bash
# Bring a copy made by backup.sh back (MOL-70). Runs on the owner's machine, because that is where
# the private key lives: the encrypted bytes come from the server, are decrypted here in memory and
# go back over ssh — no unencrypted dump is ever written to a disk.
#
#   deploy/backup/restore.sh --list                  the copies in the bucket, oldest first
#   deploy/backup/restore.sh --drill [copy]          restore into a throwaway Postgres on the server,
#                                                     compare row counts with the live database, drop it
#   deploy/backup/restore.sh --into-prod <copy>      replace the production database — asks first
#
# MOLVIA_SSH (default: molvia) is the ssh host; AGE_KEY (default: ~/.config/molvia/backup.key) is
# the private key. The latest copy is the default only for --drill: the real thing names its copy.

set -euo pipefail

host="${MOLVIA_SSH:-molvia}"
key="${AGE_KEY:-$HOME/.config/molvia/backup.key}"
mode="${1:-}"
copy="${2:-}"
# Only names backup.sh writes: the name ends up inside a command on the server.
if [[ -n "$copy" && ! "$copy" =~ ^molvia-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}Z\.dump\.age$ ]]; then
  echo "not a copy's name: $copy" >&2
  exit 1
fi

remote() { ssh -o BatchMode=yes "$host" "cd ~/molvia && . ./backup.env && $1"; }
compose='docker compose -f docker-compose.prod.yml --env-file .env.prod'
drill='molvia-restore-drill'

copies() { remote 'rclone lsf --files-only "$RCLONE_REMOTE"' | sort; }

fetch() {
  [[ -r "$key" ]] || { echo "no private key at $key (AGE_KEY)" >&2; exit 1; }
  remote "rclone cat \"\$RCLONE_REMOTE/$1\"" | age --decrypt --identity "$key"
}

# Row counts of every table in public and drizzle, one «schema.table count» per line.
counts() {
  local sql="select format('select %L || '' '' || count(*) from %I.%I;', n.nspname || '.' || c.relname, n.nspname, c.relname)
               from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where c.relkind = 'r' and n.nspname in ('public', 'drizzle') order by 1"
  printf '%s' "$sql" | ssh -o BatchMode=yes "$host" "$1 psql -U molvia -d molvia -At -v ON_ERROR_STOP=1" \
    | ssh -o BatchMode=yes "$host" "$1 psql -U molvia -d molvia -At -v ON_ERROR_STOP=1"
}

case "$mode" in
  --list)
    copies
    ;;

  --drill)
    [[ -n "$copy" ]] || copy="$(copies | tail -n 1)"
    [[ -n "$copy" ]] || { echo "the bucket holds no copy" >&2; exit 1; }
    echo "drill: $copy"
    trap 'ssh -o BatchMode=yes "$host" "docker rm -f $drill" >/dev/null 2>&1 || true' EXIT
    ssh -o BatchMode=yes "$host" "docker run -d --rm --name $drill --network none \
      -e POSTGRES_USER=molvia -e POSTGRES_DB=molvia -e POSTGRES_PASSWORD=drill postgres:17-alpine >/dev/null \
      && until docker logs $drill 2>&1 | grep -q 'init process complete'; do sleep 1; done \
      && until docker exec $drill pg_isready -U molvia -d molvia -q; do sleep 1; done"
    fetch "$copy" | ssh -o BatchMode=yes "$host" \
      "docker exec -i $drill pg_restore -U molvia -d molvia --no-owner --exit-on-error"
    live="$(counts "cd ~/molvia && $compose exec -T postgres")"
    restored="$(counts "docker exec -i $drill")"
    # An empty list would «match» too: a drill that compared nothing has proved nothing.
    if [[ -z "$live" || -z "$restored" ]]; then
      echo "drill: no row counts came back — nothing was compared" >&2
      exit 1
    fi
    echo "table · live · restored"
    join -a1 -a2 -e '—' -o '0,1.2,2.2' <(sort <<<"$live") <(sort <<<"$restored") \
      | awk '{ mark = ($2 == $3) ? "" : "   ≠"; print $1 " · " $2 " · " $3 mark; bad += ($2 != $3) }
             END { exit bad > 0 }' \
      && echo "drill: every table matches" \
      || { echo "drill: counts differ — rows written since the copy, or a copy that does not restore" >&2; exit 1; }
    ;;

  --into-prod)
    [[ -n "$copy" ]] || { echo "name the copy: $0 --list" >&2; exit 1; }
    echo "This replaces the production database with $copy."
    echo "Everything written after that copy is lost, and people erased after it come back."
    read -r -p "Type the copy's name to go on: " answer
    [[ "$answer" == "$copy" ]] || { echo "not confirmed, nothing changed"; exit 1; }
    # Before anything stops: a key that is not there would otherwise be found after the drop.
    [[ -r "$key" ]] || { echo "no private key at $key (AGE_KEY), nothing changed" >&2; exit 1; }
    # A merge rolls out on its own (MOL-90), and its `up -d` would start an API that migrates the
    # empty database before the copy is in. deploy.hold makes every rollout refuse; the lock waits
    # out one already running. It comes off only once the copy is in: a pour that failed leaves a
    # database with no rows, or rows with no keys, and an API started on that answers ok. A hold
    # that was there before — maintenance by hand — is not this script's to take off; one a failed
    # restore left says `restore`, and a restore that succeeds takes it off.
    held_before="$(remote 'if [ ! -e deploy.hold ]; then echo none; elif grep -qx restore deploy.hold; then echo restore; else echo manual; fi')"
    stage=held
    finish() {
      case "$stage" in
        held)
          # Nothing was touched: the hold goes only if this run put it there.
          [[ "$held_before" != none ]] || remote "rm -f deploy.hold" || true
          ;;
        dropped)
          echo "the restore failed after the database was dropped — its state is unknown, api and bot are stopped." >&2
          echo "Rollouts stay held (~/molvia/deploy.hold). Restore again; $(lifted 'the one that succeeds takes the hold off.')" >&2
          ;;
        poured)
          echo "the copy is in, but api and bot did not start." >&2
          echo "Rollouts stay held. Start them: ssh $host 'cd ~/molvia && $compose up -d backend bot'; $(lifted "then take the hold off: ssh $host 'rm ~/molvia/deploy.hold'.")" >&2
          ;;
        restored)
          if [[ "$held_before" == manual ]]; then
            echo "deploy.hold was there before the restore and stays: take it off when the maintenance is over."
          elif remote "rm -f deploy.hold"; then
            echo "rollouts are back on; a merge made meanwhile rolls out with the next one, or re-run its Release job"
          fi
          ;;
      esac
    }
    # What becomes of the hold: a hold set by hand is never this script's, whatever happened.
    lifted() {
      if [[ "$held_before" == manual ]]; then
        echo "the hold was set by hand before the restore and stays — take it off when the maintenance is over."
      else
        echo "$1"
      fi
    }
    trap finish EXIT
    remote "{ [ -e deploy.hold ] || echo restore >deploy.hold; } && flock -w 900 .deploy.lock true"
    remote "$compose stop backend bot"
    stage=dropped
    remote "$compose exec -T postgres sh -c 'dropdb -U \"\$POSTGRES_USER\" --force \"\$POSTGRES_DB\" && createdb -U \"\$POSTGRES_USER\" \"\$POSTGRES_DB\"'"
    fetch "$copy" | remote "$compose exec -T postgres sh -c 'pg_restore -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --no-owner --exit-on-error'"
    stage=poured
    remote "$compose up -d backend bot"
    stage=restored
    echo "restored $copy. Erasures made after it have to be repeated — see deploy/README.md, Backups."
    ;;

  *)
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
