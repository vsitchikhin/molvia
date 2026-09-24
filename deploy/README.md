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
HTTP_PORT=8080 HTTPS_PORT=8443 \
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

curl -k https://localhost:8443/api/health
```

Caddy issues an internal certificate for `localhost`, hence `-k`. Tear it down with the
same command ending in `down -v`.

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
