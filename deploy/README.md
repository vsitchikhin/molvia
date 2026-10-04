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
to the end. The log keeps every rollout that went ahead, each under a line with its time and tag,
the latest last; one waiting for the lock or refused by a hold writes nothing there.

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
**only once the copy is in**. A restore that failed after the drop leaves a database with no rows,
or rows with no keys, on which an API still answers ok: the hold stays, and the next restore that
succeeds takes it off. One that poured the copy and only failed to start api and bot says so, with
the `up -d` that finishes it. Set it by hand (`ssh molvia 'touch ~/molvia/deploy.hold'`) for any
maintenance that must not meet a merge, and remove it afterwards — a restore in the middle of that
leaves it where it is. A merge made meanwhile rolls out with the next one, or re-run its Release
job.

**The version.** `/api/health` names the build by `git describe`: `v0.1.1-3-g1a2b3c4` is three
commits after `v0.1.1`, at `1a2b3c4` — the long form always, `v0.1.2-0-g…` even on a tagged
commit, so the commit is always in it.

**A tag is a mark, not a deploy** (owner's decision В-4). Every 10–15 tasks, by hand:

```bash
git tag v0.1.2 && git push origin v0.1.2   # names the images of that commit v0.1.2, deploys nothing
```

The tag builds nothing: it names the build production runs — the `sha-…` images of its commit, byte
for byte. So it waits, up to twenty minutes, until `https://molvia.net/api/health` names that commit:
set right after a merge, that is CI, the build and the rollout. A commit production does not run — a
rollout that rolled back, was held or stood aside for a newer one — is refused, and so is one whose
three images are not all there; names go on all three or on none. Set it on the commit that runs.
Only `vN.N.N` sets it off. `v0.2.0` marks the start of the 0.2 cohort.

**Rolling back by hand:** Actions → Release → «Run workflow» on master, with a tag — `v0.1.2`,
`sha-1a2b3c4`, or any image built before MOL-90 (`v0.1.1`). It only deploys; nothing is built.
**It holds until the next merge**, which rolls out over it — a merge is a deploy. If the fix is not
ready, set `deploy.hold` after the rollback.

**A failed deploy puts the previous image back, not the schema.** The API migrates when it
starts, all pending migrations in one transaction: a migration that fails leaves the schema as it
was. One that succeeded while something else failed stays — and the previous image runs on the
new schema. An added column costs it nothing; a dropped or renamed one breaks it, so such a
migration goes out in two merges: the code stops reading the thing first, the schema loses it
after.

### Once: the deploy key

The key lives in the GitHub environment `production`, which admits the `master` branch only:
«Run workflow» from any other branch gets no secret — and the deploy job does not even start there,
because one that did would wait in the queue first and push out a master rollout waiting in it. It does not keep out a pull request — a
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

## The receipt reader (MOL-125)

`receipt-reader` is Tesseract behind a small HTTP server, an image of its own built by the release
beside the other three and pulled by `deploy.sh` with them. It has no database, no port outside the
compose network, nothing to configure: the API finds it at `http://receipt-reader:8080`
(`RECEIPT_READER_URL` in `docker-compose.prod.yml`). Three cores and a gigabyte; a receipt takes
them for half a minute.

- **While it is down, receipts wait in the queue** — the API logs «receipt reader unavailable» once
  and «receipt reader back» when it answers again. Nothing is lost; nothing is in `/health`.
- **A rollback leaves it as it runs**: `deploy.sh` starts the backend, the bot and the frontend of
  the previous tag, never the reader — a tag from before MOL-125 has no reader image.
- **Checking it by hand**: `docker compose -f docker-compose.prod.yml exec receipt-reader python3
selftest.py` reads a receipt the test draws, the same check CI runs on every push.

## Login configuration (MOL-54, MOL-55)

The API supports Telegram login and the bot confirms it. The PWA login screen (MOL-56) still
needs to be connected before people can use the complete flow.
`POST /dev/login` remains a development seam and is absent from the production bundle.

`OPEN_FOOD_FACTS_CONTACT` is the address Open Food Facts may reach us at, sent in the User-Agent of
every question the API asks it about a code the catalogue missed (MOL-162). Empty or absent, the
name hint is off; nothing else depends on it.

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

The metrics (MOL-145) need `GRAFANA_ADMIN_PASSWORD`, `ALERTS_BOT_TOKEN` and `OWNER_TELEGRAM_ID` as
well; Grafana is then at `http://127.0.0.1:3000`. On Docker Desktop node_exporter refuses `/` mounted
`rslave` — an override with `/:/host:ro` tries it there — and the disk's panels stay empty: the
virtual machine has no `/` of the kind a server has.

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
author, and every place — and one more to the count of people who erased themselves among those
who appeared in the same week (`erasures`, MOL-91), with no id, which the gates print.

## Seeding the catalogue (MOL-112)

`backend/src/catalogue-seed.ts` is some six hundred common names — «Молоко», «Говядина», «Хлеб» —
put into the catalogue by hand, in one transaction, never by a deploy. It only adds: a name already
there stays as it is, and a second run adds nothing. Every time the list grows, after its merge:

1. A copy first, though nothing is removed: `sudo systemctl start molvia-backup.service`, then
   `journalctl -u molvia-backup -n 5` says it went.
2. Look — without `--yes` nothing changes, it prints how many would be added, how many are there
   already, the names whose unit differs from the list's (they are kept as they are), and the
   lines left out because their search key is taken (`same key`, «Мед ← Мёд»). Read those pairs:
   one that is another thing — «Milo ← Мыло» — is proposed by hand through «Предложить товар»,
   which compares names, not keys:

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod \
     exec backend node dist/seed-catalogue.js
   ```

3. The same command with `--yes` at the end writes. Run the dry run once more: it says `added 0`.

In a working copy the same thing is `make seed` and `make seed YES=1`.

## Reading the gates (MOL-91)

The two numbers each release is stopped by — the plan's gates — read by hand, only ever reading,
with nothing in the output but counts and dates:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec backend node dist/gates.js --from 2026-10-05
```

`--from` is where the cohort starts: for 0.2 the day of the tag `v0.2.0`, or its exact moment,
`git log -1 --format=%cI v0.2.0` on the laptop. `--to` is optional and a day there is taken in
whole; without it, until now. A day is Yerevan's; a moment needs its offset.

- **Every share stands beside its `n`.** The cohort is as many as we find, so «2 of 10» is two
  people, not a verdict — which is why the stop line is printed and no «stop» or «pass» is.
- **Waiting is not failing.** Someone inside their two weeks, or before the end of their fourth,
  is a line of their own and in neither fraction until their window closes.
- **0.3 counts only those whose access reached their fourth week** — the numerator is behind the
  paid door. «No access in week 4» is said only of a fourth week that is over; before it, with
  access or without, a person is waiting — access may still be granted.
- **The erased are one line under both halves**: how many of those who appeared in the weeks the
  window touches erased themselves. Only how many — not whether they had reached five.

In a working copy the same thing is `make gates FROM=2026-10-05 [TO=2026-10-31]`.

## Signals (MOL-142, MOL-221)

Four checks at healthchecks.io tell the owner in Telegram that something in production is down.
They go through healthchecks.io's own Telegram integration, never through our bot: a machine that
is down takes the bot with it. healthchecks.io, Cloudflare and GitHub see the server's address and nothing of
anyone's data.

| Check            | Who pings                                                                   | Period · grace  | Silence or `/fail` means                                                                               |
| ---------------- | --------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `molvia-up`      | the Worker `molvia-watch` on Cloudflare (`watch/`), every five minutes      | 10 min · 10 min | the API with its database or the page — or the Worker, or Cloudflare itself                            |
| `molvia-cert`    | `.github/workflows/watch.yml`, from GitHub, hourly                          | 1 day · 1 hour  | the certificate has fourteen days left or fewer — or a day of runs that could not read it              |
| `molvia-bot`     | the bot, after a claim of reminders, while it hears Telegram, every 5–6 min | 6 min · 9 min   | the bot is down, does not hear Telegram or cannot reach the API — and then nobody can sign in (MOL-54) |
| `molvia-backups` | `backup/backup.sh`, nightly                                                 | 1 day · 1 hour  | no copy of the database tonight (Backups, below)                                                       |

The periods are a little longer than the pings' rhythm — the bot beats every five to six minutes — so
the panel is not yellow with «late» all the time; period and grace add up to the time a silent watch
takes to become an alarm, twenty minutes for the site and fifteen for the bot. A site that is down
says so itself, with no grace: a `/fail` within five minutes and the minute and a half of its tries.

**Why the site is not GitHub's** (MOL-221). GitHub's cron ran `*/5` on this repository every two to
six hours — six runs in the first day, the longest gap six hours fourteen minutes — so `molvia-up`
went down after every ping and a real fall would have waited for hours. Cloudflare's cron runs on
time, and Cloudflare is already ours: the domain's DNS and the copies' bucket. A Worker cannot read a
certificate, though — `fetch` only checks it, and a bad one is a `000` like the network — so the
term stays on GitHub, hourly: its check waits a day and an hour.

- **What the watch checks.** `GET /api/health` is `200` with `"status":"ok"` — `/health` answers
  `503` whenever it is not ok, the database down included, with the same body. `GET /` is `200`.
  curl checks the certificate's chain and name on every request, so a bad certificate is a `000`.
  The certificate's term, more than fourteen days, is a check of its own: Caddy renews it itself
  but silently fails to when DNS breaks, and «expires in 13 days» is a state that holds for days —
  on the site's check it kept a fall of the API silent, since healthchecks.io speaks only when a
  check flips. A certificate that could not be read is the site's matter and sends nothing to
  `molvia-cert`.
- **A rollout does not wake anyone.** `/fail` raises the alarm at once, with no grace, and every
  merge leaves the API silent for seconds. So once a check fails, four are made half a minute
  apart, and three failing is a `/fail` saying what they saw: `health 503`, `pwa 000`. A rollout
  fails one or two.
- **What the bot's pulse proves**: the bot reached the API, a `getUpdates` of Telegram succeeded in
  the last two minutes — the sign-in's way in — and the process has lived a minute, so a crash loop
  never says «alive». After a rollout the first ping comes one to two minutes in, so rollouts a few
  minutes apart do not add up into an alarm. A failed `getUpdates` — and the `getMe` a starting bot
  asks first — is retried at a pause growing by a tenth of a second a try, so after Telegram comes
  back the bot hears it within seconds, whether it was running or starting then; grammY's own
  retries doubled the pause, and half an hour of Telegram down left the sign-in dead for another
  quarter to half an hour.
- **A round fails only when it could not report** — the secret missing, or a ping that did not go
  after four tries; the Worker's log then says which, by its kind, and the check raises the alarm
  once its grace runs out. A site that is down is a `/fail` and a round that went well. `watch.yml`
  is the same: red only when it could not report, or GitHub's e-mail would come on top of Telegram.
- **The prices, accepted** (MOL-149, MOL-221): an outage of Cloudflare's Workers is a false
  `molvia-up`, and Cloudflare sees what GitHub saw — the server's address and its answers. **A
  partial failure is not seen**: a site failing every second request passes three checks in four —
  that is the share of 5xx MOL-145 watches, not availability. GitHub switches the schedule of
  `watch.yml` off in a public repository after sixty days without a commit — Actions → Watch →
  «Enable workflow» brings it back.
- **The bot's pulse is not in `/health`** on purpose: after every rollout the API would know nothing
  of the bot for its first minute, and the rollout would roll back.

### Where it is set

- The checks are the owner's healthchecks.io account, the one the backups report to, each with the
  Telegram integration.
- `molvia-up`'s ping URL is the Worker's secret `HC_UP_URL`, set on Cloudflare once — Workers & Pages
  → `molvia-watch` → Settings → Variables and Secrets, or `PUT …/workers/scripts/molvia-watch/secrets`
  — and kept by every rollout. Without it every round throws, `HC_UP_URL is not an https URL`, and
  the check goes down by its grace. Its plain variable `DOMAIN` is set again by every rollout.
- **The Worker is rolled out by the release** after green CI on master (`watcher` in `release.yml`),
  with the environment `production`'s secret `CLOUDFLARE_API_TOKEN` — an account token, «Workers
  Scripts: Edit» and nothing else — and its variable `CLOUDFLARE_ACCOUNT_ID`. By hand, with the same
  two in the shell: `make watcher`. A commit master has moved past stands aside, and the next green
  one rolls out. An account that never opened Workers & Pages in the dashboard has no `workers.dev`
  subdomain, and Cloudflare refuses the cron until it has one — opening the page once makes it.
- `molvia-cert`'s ping URL is the repository secret `HC_CERT_URL` (`gh secret set …`). Without it,
  every run is red.
- `molvia-bot`'s ping URL is `BOT_PULSE_URL` in `~/molvia/.env.prod`, handed to the bot by
  `docker-compose.prod.yml`. **The line is required**: without it compose refuses to start, since
  a check that never got a ping stays «new» and never raises an alarm — a forgotten line would go
  unnoticed for good. Empty, on purpose, switches the pulse off; working copies and the end-to-end
  run never send it.
- **The URLs are kept like secrets**: whoever has one can say «alive» for us. They are printed
  nowhere — not in a log, not here.
- **After setting a check up, see it turn green.** A new check is grey until its first ping and
  raises nothing while grey: `molvia-up` after the Worker's first round, `molvia-cert` after the
  first run, `molvia-bot` one to two minutes after the bot starts.

### Trying the alarm

On the Worker itself, so the alarm tried is the one that runs: Workers & Pages → `molvia-watch` →
Settings → Variables and Secrets → `DOMAIN` = `molvia.invalid`, deploy. Within five minutes its round
makes four tries, a minute and a half, then a `/fail` and a message in Telegram. `DOMAIN` back to
`molvia.net` — or `make watcher`, which sets it — and the next round puts `molvia-up` back up.

The certificate's way: `gh workflow run watch.yml -f domain=molvia.invalid` sends `molvia-cert`
nothing — an unreadable certificate is the site's matter — so a `/fail` of it is tried only by a
certificate that really ends.

### When an alarm comes

**`molvia-up`.** The `/fail` names what failed, and so does the Worker's log: Workers & Pages →
`molvia-watch` → Logs, each try that failed and the round's verdict.

- `health 503` — the API runs and the database does not answer: `ssh molvia`, then
  `docker compose -f docker-compose.prod.yml --env-file .env.prod ps postgres` and its `logs`.
- `health 502`, `health 000`, `pwa 000` — the API, Caddy or the machine: `ssh molvia` first; if that
  hangs too, it is the machine, and Contabo's panel. A rollout gone wrong is in
  `tail ~/molvia/deploy.log`.
- No ping for twenty minutes and no `/fail` — the Worker: its log names a round that failed by its
  kind (the secret, a ping that did not go), and no round at all is Cloudflare's matter:
  https://www.cloudflarestatus.com.

**`molvia-cert`.** The `/fail` says when it expires. Caddy's renewal failed:
`docker compose … logs frontend | grep -i acme`, and check the domain's A record in Cloudflare. No
ping for a day — the runs could not read the certificate: their warnings say so.

**`molvia-bot`.** `ssh molvia`, then `docker compose -f docker-compose.prod.yml --env-file .env.prod
ps bot` — is it running, how often did it restart — and `logs --tail 50 bot`:

- `[molvia] telegram getUpdates: <code | network>` or `[molvia] telegram getMe: <code | network>` —
  the bot does not hear Telegram: the machine's way to `api.telegram.org`, or Telegram itself. The
  second is a bot that started while Telegram was away and has not yet learnt who it is. The
  runner's own log is off: it printed the request whole, the bot's token in it;
- `[molvia] telegram: <code | network>, stopping`, and the container restarting — the token in
  `.env.prod` is wrong (`401`: revoked, cut short, or a stray character after it; `404`: a space or
  a quote before it), another process on the same token (`409`), or fifteen hours of Telegram away.
  A `401` or a `404` — compare the line with the token BotFather gives;
- `[molvia] remind claim: <code>` — the API refuses the claim;
- `[molvia] pulse: <kind>` — the ping did not go out: `network`, `timeout` or healthchecks.io's status.

### Failures of the API and the bot (MOL-143)

The checks above say that something is **down**. A failure says that something **broke** while the
rest is up: an answer of 500, a job of the API's timers, a handler of the bot. Each goes to the
table `failures` in the API's database by its fingerprint — the kind, the code, the top frame and
the route's template, never anything of a person — and the owner hears of it through **our** bot,
since the machine is up when a failure happens:

- `🔴 Новый сбой` — a fingerprint the first time in this build: its kind, place, top frame, build
  and the first six characters of the fingerprint;
- `🟠 Уже 10 / 100 / 1000 раз в этой сборке` — a known one that keeps happening. Nothing in between,
  and nothing once a day: silence means nothing new and nothing growing.

Whom the bot writes is `OWNER_TELEGRAM_ID` in `~/molvia/.env.prod`, handed to the API by
`docker-compose.prod.yml`. **The line is required**, as `BOT_PULSE_URL` is; empty, on purpose, keeps
the failures in their table and tells nobody — every working copy and end-to-end. A notice the bot
did not take within a day is dropped; the count stays in the table. Failures are kept 30 days after
they last happened.

**What broke** — the table, newest first:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend node dist/failures.js
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend node dist/failures.js --limit 50
```

In a working copy the same thing is `make failures [LIMIT=20]`. Find the message's fingerprint by
its first six characters. The frames are the bundle's — the function's name in them is the source's
— and under each frame of the API of the running build stands its line in the source, read through
the map in the image (`→ src/usecases/rate-item.ts:27:1`). The API runs without
`--enable-source-maps` on purpose: the map costs it some 75 MB of memory for good (MOL-143, В-6).
The bot's frames and another build's are left as they are.

## Metrics (MOL-145)

The checks above say that something is down, a failure that something broke. The metrics say how
the machine is doing while nothing is either: whether the API is slower than yesterday, how much
memory is left — there is no swap, so the end of it is the OOM-killer on the API or Postgres — when
the disk fills, and what share of the answers is 5xx, which the watch does not see.

VictoriaMetrics keeps thirty days of figures, scraped every fifteen seconds from the API's own port
(9464, never through Caddy), node_exporter (the machine), cAdvisor (the containers) and
postgres_exporter (the database). All four are on a network with no way out. Grafana draws them and
sends the alarms; it is the only one with a port, on the machine's loopback. Nothing leaves the machine
but the alarms, through Telegram, and the alarms' pulse, to healthchecks.io.

### Looking

```bash
ssh -L 3000:127.0.0.1:3000 molvia     # then http://localhost:3000, admin and GRAFANA_ADMIN_PASSWORD
```

Dashboards → Molvia → «Молвия», four rows:

- **API** — requests a minute; the share of 5xx and p50/p95 of a person's requests — no scanner's
  404, no `/health`, no bot's poll, and for p95 no photo of a receipt, whose time is the phone's
  network; answers by class — `aborted` is a client that left before the answer, the phone after 15 s,
  the bot after 5; how late the event loop ran over the last minute; the process's memory; and the
  routes of the last hour by their template — `unmatched` is every request no route answered, a 404,
  with no path kept;
- **Машина** — memory, CPU, load, the disk and how many days are left at the pace of the last week;
- **Контейнеры** — memory against each one's limit, CPU, restarts and OOM over a day;
- **Postgres** — connections against `max_connections`, the size, the queries running now, the oldest
  open transaction, deadlocks and rollbacks. Never a query's text.

The dashboard is read-only: a panel changed here cannot be saved. Change
`deploy/grafana/dashboards/molvia.json` and merge — the image carries it.

### The alarms

Grafana writes to `OWNER_TELEGRAM_ID` through **the alarms' own bot**, `ALERTS_BOT_TOKEN` — never the
product's bot, whose token is the login's and stays out of a container that goes to the internet.
Write the alarms' bot `/start` once: a bot cannot write first. Every threshold is in
`deploy/grafana/provisioning/alerting/rules.json`:

| Alarm                 | When                                                        | What to look at                                                             |
| --------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Память машины         | more than 85 % for 5 minutes                                | «Контейнеры» — who grew; `docker stats --no-stream`                         |
| Диск машины           | more than 80 %                                              | `df -h /`, `docker system df`, `journalctl --disk-usage`                    |
| Доля 5xx              | more than 5 % of at least 20 answers to people in 5 minutes | `make failures` on the machine — what broke has its fingerprint             |
| Время ответа API      | p95 to people above 1 s for 15 minutes, at least 20 answers | the routes' table; the event loop; Postgres — the oldest transaction        |
| Перезапуск контейнера | a container started over by itself — never a rollout        | `docker compose … logs --tail 100 <service>`                                |
| Контейнеры не видны   | cAdvisor shows no container of the API for 5 minutes        | `docker compose … logs cadvisor \| grep factory` — its socket to containerd |
| Метрики молчат        | a target did not answer for 5 minutes                       | `docker compose … ps` — which of the five is down                           |

Every rule also fires when it cannot be counted — VictoriaMetrics down — and says «нет данных».
`✅ Прошло` comes when it is over. A firing alarm is repeated every six hours.

**The alarms' pulse**: Grafana is the one that sends, so it is watched from outside too. «Тревоги
живы» fires while Grafana counts its rules, VictoriaMetrics answers and reads Grafana's own figures,
and no alarm failed on its way to Telegram within the hour with none delivered beside it; it pings the
healthchecks.io check `molvia-alerts` every five or six minutes — never Telegram. Set the check at
**period 5 min, grace 10 min**, with the Telegram integration, as the others of «Signals», and see it
turn green after the first rollout: a check that never got a ping never raises an alarm. Its alarm
means Grafana or VictoriaMetrics is down, or **the alarms do not reach Telegram** — the token revoked,
the bot blocked or never given `/start`: `docker compose … logs --tail 50 grafana | grep -i notify`,
then the contact point's Test. A token revoked while nothing fires is seen only once something does.

**Removing an alarm** is `deleteRules` with its uid in the same merge: provisioning never deletes a rule
by itself, and the old one would keep alarming from Grafana's volume.

### Trying the alarm

- **The way to Telegram**: Alerting → Contact points → `telegram` → Test. A message comes from the
  alarms' bot.
- **A rule end to end**, on the machine:
  `docker compose -f docker-compose.prod.yml --env-file .env.prod stop node-exporter`; in about six
  minutes «Метрики молчат: node», with memory and disk «нет данных» beside it; then `start
node-exporter`, and `✅ Прошло` follows.

### Where it is set

- `GRAFANA_ADMIN_PASSWORD`, `ALERTS_BOT_TOKEN`, `ALERTS_PULSE_URL` and `OWNER_TELEGRAM_ID` (digits
  only) in `~/molvia/.env.prod`; compose refuses to start without any of them. **The password is the
  line's at every start** — change it there and restart Grafana
  (`docker compose … up -d --force-recreate grafana`); Grafana itself keeps only the first. One it
  refuses — shorter than four characters — stops Grafana rather than leave the old one open; take it
  from `openssl rand -base64 24`.
- The images `molvia-grafana` and `molvia-victoria` are built by the release with the others. **The
  metrics never judge a rollout**: pulled before anything changes, a refusal of the registry a
  warning; started only once the API answers healthy, a failure of theirs a warning in
  `~/molvia/deploy.log` — `docker compose … ps` then. A rollback leaves them as they run — a tag from
  before MOL-145 has no image of theirs.
- **The first rollout with the metrics recreates Postgres** as well — its networks changed — so the
  database is away for the seconds the API is.
- **Grafana 13.0 and the chat id**: `deploy/grafana/start.sh` writes `OWNER_TELEGRAM_ID` into the
  contact point as text before Grafana starts, since Grafana turned it into a number and refused it
  (grafana/alerting #558). A Grafana that takes a numeric chat — after 13.0.2 — no longer needs it.

## Backups (MOL-70)

Every night at 04:00 in Yerevan `molvia-backup.timer` runs `backup/backup.sh`: `pg_dump` inside the
postgres container, encrypted on the spot with `age` to the owner's public key, streamed to a
Cloudflare R2 bucket in the EU jurisdiction. No unencrypted dump touches a disk, and the private
key never comes to this machine — a compromised server cannot read old copies.

- **Fourteen days.** The bucket's lifecycle rule deletes a copy at 13 days and R2 removes it within
  a day of that, so the privacy page's «fourteen days» holds; `backup.sh` deletes by the same number
  as a fallback. Longer is not a setting to raise quietly: an erased person lives in the copies
  exactly that long, and the page says so.
- **No receipt photo is in a copy** (MOL-125, В-2): `receipt_parts` and `receipt_line_images` are
  dumped without their data. A photo carries a customer's name and lives until its receipt is
  recorded; a copy would keep it fourteen days. After a restore those tables are empty — a receipt
  still queued fails as unreadable, one read keeps its lines.
- **No picture of a message to the developer is in a copy** (MOL-167, В-1): `feedback_picture_files`
  is dumped without its data. A picture lives only until the owner's Telegram has it, a week at most.
  Its line — `feedback_pictures` — is copied, so after a restore a message still says what it had,
  and a notice still waiting goes without the picture: the bot finds none to fetch, and the line is
  not marked sent.
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

## The Postgres image is part of the contract

The database runs `pgvector/pgvector:0.8.7-pg17-bookworm` — the exact tag, in `docker-compose.yml`,
`docker-compose.prod.yml`, both services of CI and the drill of `restore.sh`. Three things depend on
what the image carries, and none of them degrades quietly:

- **ICU.** «Что брать» orders names with `collate "und-x-icu"` (MOL-31): the database is created
  with `en_US.utf8`, where «Ёжик» sorts before «Ежевика» and a name typed in lower case falls below
  every capitalised one, and one answer must not come back in two alphabets. An image without ICU
  makes those queries **fail**: `ORDER BY` on a collation the server does not know is an error.
- **`vector`** (MOL-105): the embeddings of the catalogue. An image without it fails migration
  `0038_pgvector` at boot, and the API does not start.
- **The libc**, which orders and folds text. Every index whose key is text — the primary keys of
  codes, the trigram index of `search_key`, the unique `lower()` of a place's name — is built by the
  rules of the libc it was built under, and answers by the rules of the one it runs under. Swapped
  under it, an index answers wrongly and says nothing.

So a new tag is a decision, never a version bump. A tag that moves glibc or ICU comes with a
migration that rebuilds the text indexes and refreshes the ICU collations' versions, as `0038` does.

### The move off `postgres:17-alpine` (MOL-105)

Until MOL-105 the image was `postgres:17-alpine`: musl and no `vector`. The data directory of the
same Postgres 17 needs no dump. What needs care is the order, because two states are wrong and say
nothing (adversarial review of MOL-105, А and В, measured):

- **the new image under an API that has not run `0038`** — the indexes musl built answer by glibc's
  rules: the unique key of a place lets a duplicate in, and a merge join over it fails;
- **`0038` failing** — a pair of place names glibc folds into one and musl did not (`Ⱟ` and `ⱟ`) —
  after which the deploy's rollback brings the previous API up on the new image: the first state,
  and every later deploy fails on the same `REINDEX`.

So nothing writes from the last copy to the end, and a failure goes back to alpine by hand. The app
is down meanwhile — minutes, accepted while production is the owner's alone.

1. **Stop writes, take a copy** — two commands, so a copy that fails is seen as one:
   `ssh molvia 'cd ~/molvia && docker compose -f docker-compose.prod.yml --env-file .env.prod stop backend bot'`,
   then `ssh -t molvia 'sudo systemctl start molvia-backup.service'` — it returns once the copy is
   made (`Type=oneshot`).
2. **The drill on that copy**, from the branch: `deploy/backup/restore.sh --drill` restores it into
   the image the script now names and builds every index under glibc — the very uniqueness `0038`'s
   `REINDEX` asks for. A pair glibc folds into one fails the restore here; it is settled by hand —
   the two places made one — and the steps start over. The row counts must match. Nothing was
   written since the copy, so the drill saw everything the migration will.
3. **The merge.** The release job stops red: `docker-compose.prod.yml` differs from the machine's
   («Deploys» above).
4. **Copy the files and re-run the job at once**:
   `scp docker-compose.prod.yml deploy/deploy.sh molvia:molvia/`, then «Re-run failed jobs». No
   `up -d` by hand in between: it would recreate `postgres` on the new image under the old API. The
   job's `up -d` recreates `postgres` on the same volume (the entrypoint takes the files over for its
   own `postgres` user) and starts the new API, which migrates: `0038_pgvector` creates `vector`,
   rebuilds every index whose key is text or an expression, and gives the ICU collations the
   version of the new ICU (`und-x-icu` warned on every query until it did).
5. **Check**: `/api/health`, «Что брать» in the app, and the journal of `postgres` for
   `collation … version mismatch` — there must be none.
6. **If the job rolled back** («rolling back to …» in its log), the rollback has brought the old API
   and bot up again on the new image: stop them as in step 1 first. Then **ask the database whether
   `0038` ran, never the rollback** (round 2 of the adversarial review, Г) — the job rolls back on
   anything its 90 seconds of health did not see, and much of that comes after the migration
   committed:
   `echo "select count(*) from pg_extension where extname = 'vector'" | ssh molvia 'cd ~/molvia && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres psql -U molvia -d molvia -At'`.
   `vector` is created in the transaction that rebuilds the indexes, so it answers for both.
   - **`0` — `0038` failed**, and its transaction left every index as musl built it — but the old
     API the rollback brought up may have written meanwhile, by glibc's rules into musl's indexes:
     the phone's queue sends the moment the API answers (round 3, Ж — one place is enough). So alpine
     comes back with the window's duplicates settled and the indexes rebuilt before anything else
     starts. Copy the previous compose file (`git show <the master before the merge>:docker-compose.prod.yml`,
     `scp` it to `~/molvia/`) and `up -d postgres` alone. Then, with
     `psql='cd ~/molvia && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres psql -U molvia -d molvia -v ON_ERROR_STOP=1'`:
     - `ssh molvia "$psql" < deploy/window-duplicates.sql` — what the window wrote twice (round 5,
       З): search picks merged as their upsert merges a repeat, a login code written twice deleted,
       and every other pair of a unique text key named (`twice in …`), index scans off — the index
       itself is the broken one. A pair of places is settled by hand: the trips and verdicts of one
       row moved to the other, a verdict of one person on one item in both kept once, the row
       deleted; the file run again until it names nothing;
     - `ssh molvia "$psql" < deploy/reindex-text.sql` — every text index rebuilt under musl, one
       transaction; a refusal names a pair the first file did not settle.

     Then `up -d`. The API's journal names the statement `0038` failed on
     (`describeMigrationFailure`); that duplicate is settled by hand too, then from step 1 again.

   - **`1` — `0038` ran**: the indexes are glibc's, and **alpine must not come back** — under musl
     they would answer wrongly, and `0038`, recorded as applied, would never rebuild them again. Stay
     on the new image: `up -d` as the machine stands runs the previous API on it, which needs nothing
     of `vector` and agrees with the indexes. The reason of the rollback is in `deploy.log` and the
     API's journal — health, the bot, a migration skipped by its stamp — and the next deploy is an
     ordinary one.

On a volume moved off alpine the database's own collation stays without a version: Postgres refuses
a change from none to one. A database created under glibc — CI, a new copy, the drill, a restore —
records its version, and Postgres warns on it when glibc moves.

A working copy needs none of this: `make up` recreates the container on its volume and migrates at
once; `make db-reset` is not needed.
