# Molvia

An app for emigrants: **what is worth buying, and where**, in an unfamiliar country.

Not an expense tracker — that niche is taken. What is free is the subjective judgement:
everyone counts money, nobody answers whether this cheese is edible. One rule holds the
whole product together — **cheap but bad is never recommended anywhere; good is looked up
at its lowest price.**

First market is Gyumri and Yerevan.

> **Status: no features yet.** The scaffold, the dev stack and the rules are in place;
> release 0.1 has not started. See `CLAUDE.md` for the architecture and the rules, and
> the product plan for the reasoning behind every decision.

## Quick start

Requires Node 22 (see `.nvmrc`), Docker and Python 3 (only for regenerating icons).

```bash
make setup   # symlinks, .env with this copy's ports, dependencies, git hooks
make up      # Postgres in Docker, migrations applied
make dev     # api, pwa and bot together
```

Then the PWA is on the port `make ports` prints — 5300 for the first working copy.

## Commands

`make` on its own lists everything. The Makefile is the entry point; `bin/` only holds
what it does not cover.

|                 |                                                     |
| --------------- | --------------------------------------------------- |
| `make check`    | format, lint, types, tests — the definition of done |
| `make e2e`      | end-to-end tests in a phone-sized browser           |
| `make psql`     | psql inside this copy's database                    |
| `make db-reset` | drop this copy's volume and start clean             |
| `make icons`    | regenerate the app icons from `favicon.svg`         |
| `make ports`    | this copy's index and ports                         |

Checks also run on their own: `pre-commit` refuses dirty formatting or lint, `pre-push`
refuses failing types or tests, and CI repeats all of it on every push and pull request.

## Layout

```
backend       Fastify: routes -> use cases -> db. The only write path
frontend       Vue 3 + Vite, SCSS with design tokens, i18n from day one
bot       grammY, a client of the API
packages/model Domain: money, units, errors. Depends on zod and nothing else
packages/client Typed API client over the shared schemas
services/      Non-TypeScript services. Receipt OCR lands here at 1.0
e2e/           Playwright
```

Layer boundaries are enforced by the linter, not by review: the domain may import nothing
but zod, use cases know nothing about HTTP, routes never reach the database, and the bot
has no database driver at all.

## Several working copies at once

Copies run side by side, each on its own branch, with their own ports and database:

```bash
git worktree add ../molvia2 -b 0.1/some-feature
cd ../molvia2 && make setup
```

`bin/init-env.sh` takes the copy's index from the directory name and spreads the ports.
Each copy needs its own Telegram bot: two processes on one token steal each other's
updates silently.

## Deployment

One VPS, one compose file, Caddy holding the certificate. CI publishes three images to
GHCR on a tag; the deploy is two commands on the machine. See `deploy/README.md`.

## Where the documents are

See [`docs/README.md`](docs/README.md) for the map. In short: rules live in `CLAUDE.md`
here, the product plan and the design live in Confluence, and the tasks live in Jira —
all three reachable through the `jira-confluence` MCP server configured for this copy.

## Icon

The mark in `frontend/public/favicon.svg` is a placeholder until there is real branding.
The PNGs are generated from it with `make icons` and committed, so neither CI nor a build
needs a rasteriser.
