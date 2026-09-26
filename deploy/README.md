# Deployment

One VPS, one `docker compose` file, Caddy holding the certificate. Everything runs on the
same machine and the same network; only Caddy is reachable from outside.

## Once, on a new machine

1. Install Docker and the compose plugin.
2. Point the domain's A record at the machine. Caddy issues the certificate itself on the
   first request, so nothing has to be installed or renewed by hand.
3. Copy two files across: `docker-compose.prod.yml` and a filled-in `.env.prod`
   (see `.env.prod.example`). The source tree is not needed — images come from the
   registry.
4. Log the machine in to the registry once:
   `echo <token> | docker login ghcr.io -u <user> --password-stdin`
   The token needs `read:packages` and nothing else.
5. Give the journal its term — **logs live fourteen days** (MOL-58). Every container logs to
   journald (`docker-compose.prod.yml`, `x-logging`), and the term is the host's:

   ```bash
   sudo mkdir -p /etc/systemd/journald.conf.d
   printf '[Journal]\nMaxRetentionSec=14day\nMaxFileSec=1day\n' \
     | sudo tee /etc/systemd/journald.conf.d/molvia.conf
   sudo systemctl restart systemd-journald
   ```

   `MaxFileSec` is not decoration: journald drops whole files, and a file that is never rotated
   by time holds its oldest line for as long as it takes to fill by size. The API writes no
   address and no query string, and Caddy keeps no access log, but Caddy's errors can carry an
   address — this is what bounds them.

## Every release

```bash
git tag v0.1.0 && git push --tags        # CI builds and publishes three images
# then on the server:
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Migrations run when the API starts, so there is no separate step to remember and no
window where the schema lags the code deployed against it.

## Login configuration (MOL-54, MOL-55)

The API supports Telegram login and the bot confirms it. The PWA login screen (MOL-56) still
needs to be connected before people can use the complete flow.
`POST /dev/login` remains a development seam and is absent from the production bundle.

Set `TELEGRAM_BOT_USERNAME` without `@` and generate `BOT_API_SECRET` using the command in
`.env.prod.example`. This secret belongs to the internal API channel and is **not** the
Telegram bot token. The backend and bot receive the same internal secret; only the bot
receives `TELEGRAM_BOT_TOKEN`. Production refuses to start without the username and internal
secret, and the bot itself exits without either its token or the internal secret.
`APP_BASE_URL` is what the bot's greeting points people at: compose derives it from `DOMAIN`,
and a working copy that leaves it out gets its own PWA port. A variable that is present but
malformed is a different matter: the bot names it and exits 1, so the mistake is not quietly
restarted past. Caddy returns 404 for `/api/internal` and `/api/internal/*`; the bot calls
`http://backend:3300/internal/...` directly over the compose network and authenticates there.

In a development copy with an older `.env`, run `bin/init-env.sh <index> --force` once. It
preserves the Telegram token, username and internal secret, generating the latter only if
missing. Set that copy's own bot username afterward. Without these settings, development
still supports `/dev/login`, while starting a real login returns `503 error.login_disabled`.
No real Telegram request is made by the login API itself.

## Trying the production stack locally

```bash
DOMAIN=localhost POSTGRES_DB=molvia POSTGRES_USER=molvia POSTGRES_PASSWORD=localtest \
HTTP_PORT=8080 HTTPS_PORT=8443 LOG_DRIVER=json-file \
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

curl -k https://localhost:8443/api/health
```

Caddy issues an internal certificate for `localhost`, hence `-k`. `LOG_DRIVER=json-file`
because Docker Desktop has no journald and refuses to start a container that asks for it. Tear
it down with the same command ending in `down -v`.

## Erasing a person by hand (MOL-58)

People erase themselves: `/delete` in the bot, one confirmation, done in one transaction. This
is the fallback for when the bot is down — not a channel people are told about.

1. Find the Telegram id. In Telegram Desktop: Settings → Advanced → Experimental settings →
   «Show Peer IDs»; the profile then shows the number. A username is not an id and is not kept.
2. Look before erasing — without `--yes` nothing changes, it prints what would go:

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod \
     exec backend node dist/forget.js <telegram-id>
   ```

3. The same command with `--yes` at the end erases. It cannot be undone — and the person stays in
   the nightly copies for up to fourteen days, until the bucket deletes them (Backups, below).

In a working copy the same thing is `make forget TG=<id>` and `make forget TG=<id> YES=1`.
What goes: purchases and trips, ratings including withdrawn ones, search picks, the event log,
sessions, login requests and the owner. What stays: catalogue items the person added, with no
author, and every place.

## Backups (MOL-70)

Every night at 04:00 in Yerevan `molvia-backup.timer` runs `backup/backup.sh`: `pg_dump` inside the
postgres container, encrypted on the spot with `age` to the owner's public key, streamed to a
Cloudflare R2 bucket in the EU jurisdiction. No unencrypted dump touches a disk, and the private
key never comes to this machine — a compromised server cannot read old copies.

- **Fourteen days.** The bucket's lifecycle rule deletes a copy at 13 days and R2 removes it within
  a day of that, so the privacy page's «fourteen days» holds; `backup.sh` deletes by the same number
  as a fallback. Longer is not a setting to raise quietly: an erased person lives in the copies
  exactly that long, and the page says so.
- **A missing copy is an alarm.** Each run pings healthchecks.io with its exit code; no ping for 25
  hours, or a failed one, reaches the owner in Telegram. The service sees when the server pinged and
  from where — no data.
- **A copy is written under `partial/` and moved into place only when the whole pipe succeeded**, and
  only if it is non-empty and starts as an age file: `rclone rcat` completes an upload whether or not
  `pg_dump` did.

### Once, on a new machine

1. `sudo apt install age rclone`.
2. The R2 remote — the owner types the token, it never lands in shell history:

   ```bash
   read -rs -p 'Access key id: ' AK; echo; read -rs -p 'Secret access key: ' SK; echo
   read -r -p 'Endpoint (https://<account>.eu.r2.cloudflarestorage.com): ' EP
   rclone config create r2 s3 provider=Cloudflare access_key_id="$AK" \
     secret_access_key="$SK" endpoint="$EP" acl=private no_check_bucket=true
   unset AK SK EP
   ```

   The token is «Object Read & Write» on `molvia-backups` only.

3. `backup.env` next to `.env.prod`, mode 600, from `backup/backup.env.example`.
4. The scripts and units:

   ```bash
   mkdir -p ~/molvia/backup  # then copy deploy/backup/{backup.sh,restore.sh} there
   sudo cp molvia-backup.service molvia-backup.timer /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now molvia-backup.timer
   sudo systemctl start molvia-backup.service && journalctl -u molvia-backup -n 5
   ```

### Restoring — from the owner's machine

`restore.sh` runs where the private key is (`~/.config/molvia/backup.key`, and a copy in the
password manager — lose both and every copy is noise). The encrypted bytes come from the server,
are decrypted in memory and go back over ssh:

```bash
deploy/backup/restore.sh --list
deploy/backup/restore.sh --drill                  # latest copy into a throwaway Postgres, row counts vs live
deploy/backup/restore.sh --into-prod <copy>       # asks for the copy's name, stops api and bot, replaces
```

**After `--into-prod`, erasures made after the copy have to be repeated**: a copy is a snapshot, and
someone who wrote `/delete` after it is back. The window is at most a day — accepted for 0.1 and named
on the privacy page (owner's decision, 26.09.2026); a record of erasures that survives the database
is 0.2's question, with the lawyer («Персональные данные», section 5).

**What is not copied, on purpose:** `.env.prod`. Nothing in it is lost with the machine — the
database password and `BOT_API_SECRET` are generated anew, BotFather shows the bot's token
(`/mybots` → API Token), the GHCR token is issued anew. Images are in GHCR, code in git.

## What is deliberately not automated

There is no workflow that SSHs into the machine and deploys. Until a machine exists there
are no secrets to configure, and a deploy job that cannot run is worse than none: it looks
like a safety net and is not one. The two commands above are the whole deploy.

## The Postgres image has to carry ICU

«Что брать» orders names with `collate "und-x-icu"` (MOL-31): the database is created with
`en_US.utf8`, where «Ёжик» sorts before «Ежевика» and a name typed in lower case falls below
every capitalised one, and one answer must not come back in two alphabets. `postgres:17-alpine`
carries the ICU collations, and the compose file pins that image — but an image built without
ICU would make those queries **fail**, not degrade: `ORDER BY` on a collation the server does
not know is an error. So the image is part of the contract, and swapping it is a migration-sized
decision rather than a version bump.
