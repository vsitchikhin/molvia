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

- `backend/src/db/journal.test.ts` — Unit test: the journal of migrations is numbered in order and every stamp is later than the one before it.
- `backend/tests/migration-stamps.integration.test.ts` — Integration test: a migration drizzle skipped because its stamp is older than one applied is named, and stops the chain.

## backend · other

- `backend/Dockerfile` — API image: builds the single-file bundle, ships it with the migrations and no `node_modules`; bakes in the build version.

## frontend · other

- `frontend/Dockerfile` — PWA image: the Vite build served by Caddy with the production Caddyfile.

## bot

- `bot/Dockerfile` — Bot image: builds the single-file bundle and ships it alone on Node.

## repository

- `.env.prod.example` — Template of the server's `.env.prod`: domain, Postgres credentials, the production bot's token and username, the bot–API secret, the bot's pulse URL.
- `.github/workflows/release.yml` — Release workflow: after green CI on master builds the four images — the receipt reader's too — and rolls them out over ssh; a version tag names built images.
- `.github/workflows/watch.yml` — The outside watch (MOL-142): every five minutes `/api/health` and the page to the healthchecks.io check «molvia-up» — a `/fail` when three of four tries half a minute apart fail — and the certificate's term to «molvia-cert»; red only when it could not report.
- `bin/bundle.mjs` — esbuild bundler for the API and bot images; the API also gets its forget, seed-catalogue and gates tools.
- `deploy/Caddyfile` — Caddy config: TLS for the domain, `/api` stripped and proxied to the API, internal routes closed, SPA fallback, headers, no access log.
- `deploy/README.md` — Operations guide: new machine, deploys and the deploy key, login setup, local prod stack, erasure, seeding, gates, signals, backups and restore, the Postgres image and its move off alpine.
- `deploy/backup/backup.env.example` — Template of the server's `backup.env`: age recipient, R2 remote, healthchecks.io URL, retention days.
- `deploy/backup/backup.sh` — Nightly backup: `pg_dump` in the container, encrypted to the owner's age key, streamed to R2, pinged to healthchecks.io.
- `deploy/backup/molvia-backup.service` — systemd unit running the nightly backup script as the deploy user.
- `deploy/backup/molvia-backup.timer` — systemd timer: the backup at 04:00 Yerevan time, catching up a night the machine was off.
- `deploy/backup/restore.sh` — Restore from the owner's machine: list copies, drill into a throwaway Postgres, or replace production under a deploy hold.
- `deploy/deploy.sh` — The deploy key's forced command: rolls out one published image tag, checks health, rolls back on failure — without the receipt reader, which a tag before it lacks; honours `deploy.hold`.
- `deploy/reindex-text.sql` — Rebuilds every index whose key is text or an expression by the rules of the libc the database now runs under — the block of `0038` for a move a migration cannot make (MOL-105).
- `deploy/window-duplicates.sql` — After a rolled-back deploy (MOL-105): what the old API wrote twice into indexes of another libc — search picks merged, a login code dropped, every other pair of a unique text key named; index scans off.
- `docker-compose.prod.yml` — Production stack: Postgres, API, bot, the receipt reader (three cores, a gigabyte) and Caddy-served PWA on one network, logging to journald.
