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

## Deploys (MOL-90)

A merge into master is a deploy. When CI passes on master, `release.yml` builds the three images
of exactly that commit as `sha-<7 hex>` and rolls them out:

1. **The machine's own files are checked first.** `deploy.sh status` answers with the tag running
   and the sha256 of `docker-compose.prod.yml` and of `deploy.sh` itself; if either differs from
   the commit, the job stops red and nothing moves. The key cannot replace them — copy them over
   (`scp docker-compose.prod.yml deploy/deploy.sh molvia:molvia/`) and re-run the failed job.
2. **`deploy.sh <tag>`** pulls the images — a tag the registry does not have leaves everything as
   it was — writes `IMAGE_TAG` into `.env.prod`, runs `up -d` and waits up to 90 s until every
   service runs a container of **that tag's image**, `/api/health` through Caddy answers `ok` and
   the bot has not restarted. Anything else — `up -d` itself failing included — writes the
   previous tag back, runs `up -d` again and fails the job. It is told by the image, not by the
   version `/health` names: images built before MOL-90 all call themselves `0.0.0`.
3. The job then asks `https://molvia.net/api/health` from outside, and for an automatic rollout
   checks that the version names its commit.

The script writes to `~/molvia/deploy.log`, and a `tail` carries it to the job: a job cancelled or
a runner off the network takes the `tail` with it, and the rollout — or its rollback — still runs
to the end. The log of the last rollout stays there.

**Every rollout is a few seconds of refusals.** `up -d` recreates all three containers, Caddy
included. The PWA's queue holds a write through a 5xx and a dropped connection, so nothing is
lost; a screen loading at that moment shows its error state and tries again.

**One at a time, never older over newer.** The deploy job waits for the one in progress rather
than cancelling it; on the machine the script also holds a lock. Builds run side by side, so a
build may finish after a newer commit went out: it stands aside only if the machine already runs
its commit or a later one — not because master moved on, since the commit that moved it may never
pass CI. **GitHub keeps one job waiting, not a queue:** a third one to arrive replaces the one
waiting. So press a rollback when nothing is queued, and check that it ran.

**Holding rollouts.** While `~/molvia/deploy.hold` exists every rollout is refused and the job goes
red. `restore.sh --into-prod` sets it for as long as it replaces the database — an API started in
the middle would migrate the empty database and the copy would no longer go in — and takes it off
however it ends. Set it by hand (`ssh molvia 'touch ~/molvia/deploy.hold'`) for any maintenance
that must not meet a merge, and remove it afterwards; a merge made meanwhile rolls out with the
next one, or re-run its Release job.

**The version.** `/api/health` names the build by `git describe`: `v0.1.1-3-g1a2b3c4` is three
commits after `v0.1.1`, at `1a2b3c4` — the long form always, `v0.1.2-0-g…` even on a tagged
commit, so the commit is always in it.

**A tag is a mark, not a deploy** (owner's decision В-4). Every 10–15 tasks, by hand:

```bash
git tag v0.1.2 && git push origin v0.1.2   # names the images of that commit v0.1.2, deploys nothing
```

The tag builds nothing: it puts its name on the `sha-…` images already built from its commit —
byte for byte what ran on production — and a commit that was never built from master is refused.
Only `vN.N.N` sets it off. `v0.2.0` marks the start of the 0.2 cohort.

**Rolling back by hand:** Actions → Release → «Run workflow» on master, with a tag — `v0.1.2`,
`sha-1a2b3c4`, or any image built before MOL-90 (`v0.1.1`). It only deploys; nothing is built.

**A failed deploy puts the previous image back, not the schema.** The API migrates when it
starts, all pending migrations in one transaction: a migration that fails leaves the schema as it
was. One that succeeded while something else failed stays — and the previous image runs on the
new schema. An added column costs it nothing; a dropped or renamed one breaks it, so such a
migration goes out in two merges: the code stops reading the thing first, the schema loses it
after.

### Once: the deploy key

The key lives in the GitHub environment `production`, which admits the `master` branch only:
«Run workflow» from any other branch gets no secret. It does not keep out a pull request — a
`workflow_run` always runs on master, whatever set it off. That is the `if` of the build job:
only a successful CI of a push to master of this repository builds, and only a build deploys.

1. A key pair for Actions, no passphrase: `ssh-keygen -t ed25519 -N '' -C github-actions-deploy@molvia -f deploy_key`.
2. On the machine, the script and the key, restricted to it:

   ```bash
   scp deploy/deploy.sh molvia:molvia/deploy.sh
   ssh molvia 'chmod 755 ~/molvia/deploy.sh'
   # append to ~/.ssh/authorized_keys on the machine, one line:
   restrict,command="/home/deploy/molvia/deploy.sh" ssh-ed25519 AAAA… github-actions-deploy@molvia
   ```

   `restrict` takes away the terminal, forwarding and the agent; whatever the client asks for
   arrives in `$SSH_ORIGINAL_COMMAND`, and the script refuses anything but `status`, `sha-<7 hex>`
   and `v<N>.<N>.<N>`.

3. The environment and its two secrets — the host key taken from the machine itself, not scanned:

   ```bash
   gh api -X PUT repos/vsitchikhin/molvia/environments/production \
     -F 'deployment_branch_policy[protected_branches]=false' \
     -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/vsitchikhin/molvia/environments/production/deployment-branch-policies \
     -f name=master -f type=branch
   gh secret set DEPLOY_SSH_KEY --env production < deploy_key
   printf '[molvia.net]:2222 %s\n' "$(ssh molvia 'cut -d" " -f1,2 /etc/ssh/ssh_host_ed25519_key.pub')" \
     | gh secret set DEPLOY_KNOWN_HOSTS --env production
   ```

   Then delete `deploy_key`: GitHub holds the only copy it needs, and a new pair is cheaper than
   guarding an old one.

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
     secret_access_key="$SK" endpoint="$EP" no_check_bucket=true no_head=true
   unset AK SK EP
   ```

   The token is «Object Read & Write» on `molvia-backups` only. `no_head` is not optional: after
   an upload rclone asks for the object by `?versionId=`, which R2 answers `501 Not Implemented` —
   the copy is there, and the run still fails. Nor is an `acl`: R2 has none to set.

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

`--into-prod` holds rollouts while it runs (`deploy.hold`, «Deploys» above), so a merge meanwhile
does not start an API on the empty database; it takes the hold off however it ends.

**After `--into-prod`, erasures made after the copy have to be repeated**: a copy is a snapshot, and
someone who wrote `/delete` after it is back. The window is at most a day — accepted for 0.1 and named
on the privacy page (owner's decision, 26.09.2026); a record of erasures that survives the database
is 0.2's question, with the lawyer («Персональные данные», section 5).

**What is not copied, on purpose:** `.env.prod`. Nothing in it is lost with the machine — the
database password and `BOT_API_SECRET` are generated anew, BotFather shows the bot's token
(`/mybots` → API Token), the GHCR token is issued anew. Images are in GHCR, code in git.

## The Postgres image has to carry ICU

«Что брать» orders names with `collate "und-x-icu"` (MOL-31): the database is created with
`en_US.utf8`, where «Ёжик» sorts before «Ежевика» and a name typed in lower case falls below
every capitalised one, and one answer must not come back in two alphabets. `postgres:17-alpine`
carries the ICU collations, and the compose file pins that image — but an image built without
ICU would make those queries **fail**, not degrade: `ORDER BY` on a collation the server does
not know is an error. So the image is part of the contract, and swapping it is a migration-sized
decision rather than a version bump.
