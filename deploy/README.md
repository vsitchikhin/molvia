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
