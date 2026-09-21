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

## Nobody can sign in yet, and that is the current state rather than a fault

**Do not deploy this expecting people to use it.** The invite code of MOL-8 is gone together
with `POST /actors` (MOL-52): the epic opened the door to everyone with a Telegram account, and
taking the code off while leaving a handle that writes a row per call would have been worse
than either. What creates an identity in development is `POST /dev/actors`, and that address
**does not exist in the production image** — the bundler folds its guard to a constant and
drops the module, which a test asserts against the built file.

The real door is the Telegram login of MOL-54. Until it ships, a production deployment serves
the app to a person who will see «could not be identified» and a «try again» that cannot help.
`SIGNUP_CODE` is no longer read by anything: it is out of `backend/src/env.ts`, out of
`bin/init-env.sh` and out of `docker-compose.prod.yml`. A leftover value in `.env.prod` is
harmless and should be deleted.

## Trying the production stack locally

```bash
DOMAIN=localhost POSTGRES_DB=molvia POSTGRES_USER=molvia POSTGRES_PASSWORD=localtest \
HTTP_PORT=8080 HTTPS_PORT=8443 \
docker compose -f docker-compose.prod.yml up -d --build

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
