# Map · Build and deployment

Rules: `.claude/rules/deploy.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## backend · routes

- `backend/src/routes/health.ts` — Route `GET /health`: the database probe and the build's version, which the deploy, the e2e run and the outside watch wait on; `503` with the same body when the database does not answer (MOL-142).

## backend · usecases

- `backend/src/usecases/get-health.ts` — Use case: the health answer — ok or degraded by whether the database answers, with the build's version.

## backend · db

- `backend/src/db/migrate-cli.ts` — CLI entry for `make migrate` and `make up`: the same migrator the API runs at boot, and a failure printed as the API logs it (MOL-153).
- `backend/src/db/journal.ts` — drizzle's journal of migrations read as entries, and `stampsOutOfOrder`: a stamp not later than the one before is skipped by drizzle in silence (MOL-105). Tests: `backend/src/db/journal.test.ts`.
- `backend/src/db/migrate.ts` — Migrator: finds the migrations folder from source or from the bundle and applies pending migrations; run at API start. A failure leaves the client to the caller's exit, so «migrations failed» is logged first (MOL-153); then `assertEveryMigrationApplied` stops the boot on a migration drizzle skipped by its stamp (MOL-105). Tests: `backend/tests/migration-stamps.integration.test.ts`.

## backend · tests

- `backend/tests/compose-volumes.integration.test.ts` — Integration test: `frontend-volumes` and `victoria-volumes` give every volume their service mounts, and only those, to the uid and gid the Dockerfiles of Caddy and VictoriaMetrics run as, by numbers, as root on their service's image with no network and `CHOWN`, `DAC_READ_SEARCH` alone, each waited for.
- `backend/tests/compose.ts` — Test helper: `docker-compose.prod.yml` as text and each service's block of lines, for the tests that hold its shape.
- `backend/src/db/journal.test.ts` — Unit test: the journal of migrations is numbered in order and every stamp is later than the one before it.
- `backend/tests/migration-stamps.integration.test.ts` — Integration test: a migration drizzle skipped because its stamp is older than one applied is named, and stops the chain.

## backend · other

- `backend/Dockerfile` — API image: builds the single-file bundle, ships it with the migrations and no `node_modules`; bakes in the build version.

## frontend · other

- `frontend/Dockerfile` — PWA image: the Vite build served by Caddy with the production Caddyfile.

## bot

- `bot/Dockerfile` — Bot image: builds the single-file bundle and ships it alone on Node.

## deploy · watch

- `deploy/watch/src/site.ts` — The outside watch's rule (MOL-221): what is wrong with `/api/health` and the page, a line each, and three failures of four tries as a `/fail` saying what the last saw.
- `deploy/watch/src/watch.ts` — One round of the watch: the settings from the Worker's environment (a `HC_UP_URL` missing, not in the form `/fail` can follow or an endpoint — an error), up to four tries half a minute apart, what the tries saw logged before the ping to «molvia-up» or its `/fail`, tried again and failing by its kind, never its URL; a ping healthchecks.io took for no check (`OK (not found)`) fails at once. Tests: `deploy/watch/tests/watch.test.ts`, `deploy/watch/tests/site.test.ts`.
- `deploy/watch/src/worker.ts` — The Worker «molvia-watch»: Cloudflare's cron calls `scheduled` every five minutes; the platform's `fetch`, timer and console.
- `deploy/watch/tests/bundle.test.ts` — Test of the Worker as it ships: one module that imports nothing and exports the scheduled handler.
- `deploy/watch/tests/site.test.ts` — Unit test of the rule: what makes an answer wrong, Cloudflare's own codes, three of four.
- `deploy/watch/tests/watch.test.ts` — Test of a round: tries, pauses and timeouts on a fake clock, the ping and `/fail`, what healthchecks.io says, the form of the ping URL, the Worker without its secret.
- `deploy/watch/deploy.sh` — Rolls the Worker out through Cloudflare's API: the bundle with `DOMAIN` and the secret kept, the cron, off `*.workers.dev`; run by the release and by `make watcher`.

## repository

- `.env.prod.example` — Template of the server's `.env.prod`: domain, Postgres credentials, the production bot's token and username, the bot–API secret, the bot's pulse URL, Grafana's password and the alarms' bot (MOL-145).
- `.github/workflows/release.yml` — Release workflow: after green CI on master builds the six images — the receipt reader's and the metrics' two (MOL-145) too — and rolls them out over ssh; a version tag — a release's and a hotfix's named one too (MOL-381) — names built images; the outside watch goes to Cloudflare in a job of its own (MOL-221); trivy scans the images beside the rollout, never judging it, through `scan.yml` (MOL-369).
- `.github/workflows/release-night.yml` — The day's release (MOL-381): at 03:00 Yerevan and by «Run workflow», the owner's «выпускай»; decides by `bin/release.mjs` — the branch differs from master by its files, and at night no release went out by hand within 24 hours — finds or opens the pull request of the release branch into master, waits up to an hour for both gates of CI on its head and merges that commit, the night's subject marked `(night)`; by the app `molvia-release`, since a merge by GitHub's own token starts no CI; its outcome to healthchecks.io `molvia-release`.
- `.github/workflows/after-release.yml` — After CI on master (MOL-381): for a merge of `release/*` or `hotfix/*` — read off the merge commit by `bin/release.mjs after` — waits until `/api/health` names the commit, tags it, and cuts the next release branch and deletes those older than the one before it, or merges master into the next release branch after a hotfix; whoever merged; a run again finishes what a failure left; a failure to healthchecks.io `molvia-release`.
- `bin/release.mjs` — The releases' rules (MOL-381): the names in rotation — their only copy — the next release and its tag, the night's verdict, what a merge into master leaves to do and which branch may ask master; the commands the two workflows and `ci.yml` run, and the ping of `molvia-release`.
- `bin/release.d.mts` — Types of the release rules for their test: the script is plain JS.
- `bin/release.test.ts` — Test: the rotation and its wrap, the tags of 0.2, the branch of a merge commit, the night held only by a release by hand, a release and a hotfix after a merge and out of turn, a run again, master's sources.
- `.github/workflows/scan.yml` — trivy over the six images (MOL-369, В-3 «а»): called by the release with its tag, daily over the commit production's `/api/health` names, and by hand with a tag; red for all but a Go binary's (`bin/scan-images.mjs`); from the release, checked out at the commit it built.
- `.github/workflows/watch.yml` — The certificate's term from outside (MOL-142, MOL-221): hourly, more than fourteen days left to the healthchecks.io check «molvia-cert», fewer a `/fail`; red only when it could not report; its ping URL a secret of the environment `production`, with no deployment recorded (MOL-368). The site is the Worker's, `deploy/watch/`.
- `bin/bundle.mjs` — esbuild bundler for the API and bot images; the API also gets its forget, seed-catalogue, gates, failures, merge, notify, repack-receipts and rename-receipt-items tools.
- `deploy/Caddyfile` — Caddy config: TLS for the domain, `/api` stripped and proxied to the API, internal routes closed, SPA fallback, headers — `frame-ancestors 'none'` and HSTS but on localhost (MOL-363) — no access log.
- `backend/tests/caddyfile.integration.test.ts` — Test of the Caddyfile as text (MOL-363): the audit's three headers kept, the one CSP of Caddy is `frame-ancestors 'none'`, HSTS a year with no preload or subdomains and never for localhost.
- `deploy/README.md` — Operations guide: new machine, deploys and the deploy key, login setup, local prod stack, erasure, seeding, gates, signals, the metrics and their alarms (MOL-145), backups and restore, the Postgres image and its move off alpine.
- `deploy/backup/backup.env.example` — Template of the server's `backup.env`: age recipient, R2 remote, healthchecks.io URL, retention days.
- `deploy/backup/backup.sh` — Nightly backup: `pg_dump` in the container without the data of receipt photos and cut-out lines (MOL-125), encrypted to the owner's age key, streamed to R2, pinged to healthchecks.io.
- `deploy/backup/molvia-backup.service` — systemd unit running the nightly backup script as the deploy user.
- `deploy/backup/molvia-backup.timer` — systemd timer: the backup at 04:00 Yerevan time, catching up a night the machine was off.
- `deploy/backup/restore.sh` — Restore from the owner's machine: list copies, drill into a throwaway Postgres — every table against the live one but those `backup.sh` excludes, which must come back empty (MOL-368) — or replace production under a deploy hold.
- `backend/tests/restore-drill.integration.test.ts` — Test: `restore.sh --drill` run as it is beside a `backup.sh`, `ssh` and `age` stand-ins in `PATH` — a match, an excluded table not empty or not there, a count differing, no list read (MOL-368).
- `deploy/deploy.sh` — The deploy key's forced command: rolls out one published image tag, judged by the application alone — the metrics pulled before anything changes and started after it is healthy, a failure of theirs a warning (MOL-145) — checks health, rolls back on failure without the receipt reader or the metrics, which a tag before them lacks; honours `deploy.hold`.
- `deploy/reindex-text.sql` — Rebuilds every index whose key is text or an expression by the rules of the libc the database now runs under — the block of `0038` for a move a migration cannot make (MOL-105).
- `deploy/window-duplicates.sql` — After a rolled-back deploy (MOL-105): what the old API wrote twice into indexes of another libc — search picks merged, a login code dropped, every other pair of a unique text key named; index scans off.
- `docker-compose.prod.yml` — Production stack: Postgres, API, bot, the receipt reader (three cores, a gigabyte) and Caddy-served PWA, logging to journald; and the metrics (MOL-145) — VictoriaMetrics, node_exporter, cAdvisor, postgres_exporter on a network with no way out, Grafana on the loopback.
