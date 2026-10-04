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
- `.github/workflows/release.yml` — Release workflow: after green CI on master builds the six images — the receipt reader's and the metrics' two (MOL-145) too — and rolls them out over ssh; a version tag names built images; the outside watch goes to Cloudflare in a job of its own (MOL-221).
- `.github/workflows/watch.yml` — The certificate's term from outside (MOL-142, MOL-221): hourly, more than fourteen days left to the healthchecks.io check «molvia-cert», fewer a `/fail`; red only when it could not report. The site is the Worker's, `deploy/watch/`.
- `bin/bundle.mjs` — esbuild bundler for the API and bot images; the API also gets its forget, seed-catalogue, gates and failures tools.
- `deploy/Caddyfile` — Caddy config: TLS for the domain, `/api` stripped and proxied to the API, internal routes closed, SPA fallback, headers, no access log.
- `deploy/README.md` — Operations guide: new machine, deploys and the deploy key, login setup, local prod stack, erasure, seeding, gates, signals, the metrics and their alarms (MOL-145), backups and restore, the Postgres image and its move off alpine.
- `deploy/backup/backup.env.example` — Template of the server's `backup.env`: age recipient, R2 remote, healthchecks.io URL, retention days.
- `deploy/backup/backup.sh` — Nightly backup: `pg_dump` in the container without the data of receipt photos and cut-out lines (MOL-125), encrypted to the owner's age key, streamed to R2, pinged to healthchecks.io.
- `deploy/backup/molvia-backup.service` — systemd unit running the nightly backup script as the deploy user.
- `deploy/backup/molvia-backup.timer` — systemd timer: the backup at 04:00 Yerevan time, catching up a night the machine was off.
- `deploy/backup/restore.sh` — Restore from the owner's machine: list copies, drill into a throwaway Postgres, or replace production under a deploy hold.
- `deploy/deploy.sh` — The deploy key's forced command: rolls out one published image tag, judged by the application alone — the metrics pulled before anything changes and started after it is healthy, a failure of theirs a warning (MOL-145) — checks health, rolls back on failure without the receipt reader or the metrics, which a tag before them lacks; honours `deploy.hold`.
- `deploy/reindex-text.sql` — Rebuilds every index whose key is text or an expression by the rules of the libc the database now runs under — the block of `0038` for a move a migration cannot make (MOL-105).
- `deploy/window-duplicates.sql` — After a rolled-back deploy (MOL-105): what the old API wrote twice into indexes of another libc — search picks merged, a login code dropped, every other pair of a unique text key named; index scans off.
- `docker-compose.prod.yml` — Production stack: Postgres, API, bot, the receipt reader (three cores, a gigabyte) and Caddy-served PWA, logging to journald; and the metrics (MOL-145) — VictoriaMetrics, node_exporter, cAdvisor, postgres_exporter on a network with no way out, Grafana on the loopback.
