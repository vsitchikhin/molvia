# Map · Build and deployment

Rules: `.claude/rules/deploy.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## backend · routes

- `backend/src/routes/health.ts` — Route `GET /health`: the database probe and the build's version, which the deploy and the e2e run wait on.

## backend · usecases

- `backend/src/usecases/get-health.ts` — Use case: the health answer — ok or degraded by whether the database answers, with the build's version.

## backend · db

- `backend/src/db/migrate-cli.ts` — CLI entry for `make migrate` and `make up`: the same migrator the API runs at boot.
- `backend/src/db/migrate.ts` — Migrator: finds the migrations folder from source or from the bundle and applies pending migrations; run at API start. A failure leaves the client to the caller's exit, so «migrations failed» is logged first (MOL-153).

## backend · other

- `backend/Dockerfile` — API image: builds the single-file bundle, ships it with the migrations and no `node_modules`; bakes in the build version.

## frontend · other

- `frontend/Dockerfile` — PWA image: the Vite build served by Caddy with the production Caddyfile.

## bot

- `bot/Dockerfile` — Bot image: builds the single-file bundle and ships it alone on Node.

## repository

- `.env.prod.example` — Template of the server's `.env.prod`: domain, Postgres credentials, the production bot's token and username, the bot–API secret.
- `.github/workflows/release.yml` — Release workflow: after green CI on master builds the three images and rolls them out over ssh; a version tag names built images.
- `bin/bundle.mjs` — esbuild bundler for the API and bot images; the API also gets its forget, seed-catalogue and gates tools.
- `deploy/Caddyfile` — Caddy config: TLS for the domain, `/api` stripped and proxied to the API, internal routes closed, SPA fallback, headers, no access log.
- `deploy/README.md` — Operations guide: new machine, deploys and the deploy key, login setup, local prod stack, erasure, seeding, gates, backups and restore.
- `deploy/backup/backup.env.example` — Template of the server's `backup.env`: age recipient, R2 remote, healthchecks.io URL, retention days.
- `deploy/backup/backup.sh` — Nightly backup: `pg_dump` in the container, encrypted to the owner's age key, streamed to R2, pinged to healthchecks.io.
- `deploy/backup/molvia-backup.service` — systemd unit running the nightly backup script as the deploy user.
- `deploy/backup/molvia-backup.timer` — systemd timer: the backup at 04:00 Yerevan time, catching up a night the machine was off.
- `deploy/backup/restore.sh` — Restore from the owner's machine: list copies, drill into a throwaway Postgres, or replace production under a deploy hold.
- `deploy/deploy.sh` — The deploy key's forced command: rolls out one published image tag, checks health, rolls back on failure; honours `deploy.hold`.
- `docker-compose.prod.yml` — Production stack: Postgres, API, bot and Caddy-served PWA on one network, logging to journald.
