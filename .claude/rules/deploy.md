---
paths:
  - 'deploy/**'
  - 'docker-compose*.yml'
  - '.github/workflows/**'
  - 'bin/bundle.mjs'
  - '**/Dockerfile'
  - 'backend/drizzle/**'
  - 'backend/src/db/migrate*.ts'
  - 'backend/src/routes/health.ts'
  - 'bot/src/pulse.ts'
  - '.env.prod.example'
---

# Deployment

One VPS, one compose file, Caddy holding the certificate — see `deploy/README.md`.
The shape worth knowing here:

- **`api` and `bot` ship as a single bundled file each** (`bin/bundle.mjs`, esbuild). The
  runtime image carries no `node_modules` at all: nothing to audit and nothing that can
  drift from the lockfile it was built with. It also sidesteps the fact that the workspace
  packages export TypeScript source, which a runtime image could not read. The API's image
  carries three more files, `dist/forget.js` — the owner's fallback for erasure (MOL-58) —,
  `dist/seed-catalogue.js` (MOL-112) and `dist/gates.js` (MOL-91), since the machine has neither
  the source nor a published database port.
  **Names survive the bundle** (`keepNames`, MOL-142): node-fetch under grammY takes a signal only
  from a constructor called `AbortSignal`, and the bot's first use of the global one had esbuild
  rename abort-controller's class — every call to Telegram failed in production, every unbundled
  test passed. `bot/src/bundle.test.ts` builds the bot and checks the name.
- **Every container logs to journald**, which keeps fourteen days (MOL-58). `LOG_DRIVER=json-file`
  exists only for trying the stack on a laptop, where Docker Desktop has no journald.
- **The database is copied every night, encrypted, off the machine** (MOL-70): `pg_dump` inside the
  container, `age` to the owner's public key, a Cloudflare R2 bucket in the EU — one pipe, so no
  unencrypted dump touches a disk, and the private key lives only with the owner, so a compromised
  server cannot read old copies. **Fourteen days**, enforced by the bucket's own lifecycle rule and
  written on the privacy page: an erased person lives in the copies exactly that long, so the term is
  a promise, not a setting. A restore brings back whoever was erased after the copy — a window of
  at most a day, accepted for 0.1 and named on the page (owner's decision, 26.09.2026); a record of
  erasures that outlives the database is 0.2's, with the lawyer. A missing copy is an alarm
  (healthchecks.io), not a log line. `deploy/README.md`, «Backups».
- **Migrations run when the API starts.** There is one instance, and a schema that lags
  the code deployed against it is the worse of the two failures. `make migrate`, the test
  setup and the boot path all go through the same code, so a migration cannot behave one
  way locally and another in production.
- **A merged migration is never rewritten.** drizzle decides what to run by the journal's
  `created_at` alone and never compares a file with what was applied: a rewritten migration is
  skipped silently if its stamp is older, and fails on its first `CREATE` if newer — then the
  API does not start.

  **The line is the merge of the pull request, not the first database to run it** (owner's
  decision, 23.09.2026). The rule is about the production database and about branches other
  people build on; a working copy's database is pushed around all through development anyway.
  So while the task is still open, a task's migrations may be folded into one — and then **every
  database that already ran the old file is brought into line by hand, in the same sitting**,
  because those are the ones drizzle will silently skip. MOL-39 checked every copy's journal
  before and after doing it; MOL-25 did the same and applied the added index to this copy's
  three databases with the very statement the file now carries. After the merge the file is
  frozen and a change to the schema is a new migration, always.

- **Postgres publishes no port.** It is reachable only over the compose network.
- **The PWA calls `/api/...`** and Caddy strips the prefix — the same shape the Vite dev
  proxy has, so nothing about the origin differs between development and production.
- **A merge is a deploy (MOL-90, owner's decisions В-7 and В-11).** `release.yml` runs when CI
  passes on master, builds the three images of exactly that commit as `sha-<7 hex>` and rolls
  them out over ssh — about seven minutes from the merge. The key can do one thing: its forced
  command, `deploy/deploy.sh`, takes a published tag and nothing else, so a stolen key re-deploys
  what is already in the registry. **A rollout is told by the image its containers run, never by
  the version `/health` names** — every image before MOL-90 calls itself `0.0.0`, and those are
  the rollback targets. Any failure, `up -d` included, puts the previous tag back; the script
  writes to a log rather than to ssh, so a client going away cannot cut a rollback short. One
  rollout at a time, and never older over newer: a build stands aside only if the machine already
  runs its commit or a descendant — not because master moved on, since the commit that moved it
  may never pass CI. A compose file or a deploy script on the machine that differs from the
  commit stops the job before anything moves — the key cannot replace them, and a copy is made by
  hand. `~/molvia/deploy.hold` refuses every rollout, and `restore.sh --into-prod` sets it: an API
  started mid-restore migrates the empty database. It comes off only once the copy is in — a pour
  cut short leaves tables without keys that an API still calls healthy — and a hold set by hand
  is never the restore's to take off. A tag `v0.1.N` is set by hand every 10–15
  tasks as a mark and a point to roll back to; it builds nothing and deploys nothing, but names
  the `sha-…` images of its commit, and only once production's `/health` names that commit — a
  tag is the build that runs, never one that rolled back (owner's decision В-4). **`.env.prod` is
  read by asking compose** (`config --environment`), never by parsing it: two rounds of review found
  a form the copied grammar missed each time. `v0.2.0`
  starts the 0.2 cohort. **`/api/health` names the build** — `git describe --long`,
  `v0.1.1-3-g1a2b3c4`.
- **Production is watched from outside, never from the machine (MOL-142; MOL-149, В-4).** A watch on
  the same machine does not notice the machine is down. `.github/workflows/watch.yml` asks every
  five minutes for `/api/health` and the page and pings the healthchecks.io check `molvia-up` — or
  its `/fail`, saying what; the certificate's term goes to a check of its own, `molvia-cert`; the
  bot pings `molvia-bot`. The alarm is healthchecks.io's own Telegram integration, never our bot,
  which lies down with the machine. **`/health` is `503` whenever it is not `ok`**, with the same
  body: a 200 saying «degraded» is a database down that a watch reading the status never sees. The
  rollout reads the body and is unchanged by it.
  - **A `/fail` is three failures in four tries half a minute apart**: it raises the alarm with no
    grace, and every merge leaves the API silent for seconds — a rollout fails one or two. All four
    had to fail at first, and a site failing three requests in four passed as well (adversarial
    Б1). Failing every second request still passes: the share of 5xx is MOL-145's, a named price.
  - **One check, one state that can last.** healthchecks.io speaks only when a check flips, and a
    certificate «expiring in 13 days» is down for days: on `molvia-up` it kept a fall of the API
    silent the whole time (Б2). An unreadable certificate is the site's matter and pings nothing.
  - **A run is red only when it could not report**, or GitHub's e-mail would come on top of
    Telegram.
  - **A check that never got a ping never raises an alarm** — it stays «new» (В1). So
    `BOT_PULSE_URL` is required in `.env.prod` (`${…?}` in compose) and only empty on purpose, and
    a check set up is seen turning green.
  - **The bot is not in `/health`**: after a rollout the API knows nothing of it for a minute, and
    the rollout would roll back. What its pulse proves is in `bot.md`.
  - The periods sit a little above the pings' rhythm, so «late» does not light the panel all day;
    period plus grace is the time to an alarm. Every ping URL is kept like a secret — whoever has
    one can say «alive» — and printed nowhere. The prices, accepted by the owner: a fall is noticed
    within twenty minutes, not five, since GitHub's cron runs late; GitHub down is a false alarm.
    `deploy/README.md`, «Signals».
- **A failed deploy puts the previous image back, not the schema.** Pending migrations run in
  one transaction, so a migration that fails leaves the schema as it was and the old image
  finds what it knew. One that succeeded while something else failed stays applied, and the
  previous image then runs on the new schema: an added column costs it nothing, a dropped or
  renamed one breaks it. **So a migration that drops or renames goes out in two merges** — the
  code stops reading the thing first, the schema loses it after.
