# Molvia

An app for emigrants: **what is worth buying, and where**, in an unfamiliar country.

Not an expense tracker — that niche is taken. What is free is the subjective judgement:
everyone counts money, nobody answers whether this cheese is edible. One rule holds the
whole product together — **cheap but bad is never recommended anywhere; good is looked up
at its lowest price.**

First market is Gyumri and Yerevan, the Russian-speaking diaspora. It runs at
[molvia.net](https://molvia.net) as an installable web app with a Telegram bot.

> **Status: 0.2 is on production** since `v0.2.0` (11 November 2026), open to strangers;
> 0.3 is being built. Every release is cut by a hypothesis with a number at which work stops —
> the gates are in `CLAUDE.md`, the reasoning in the product plan.

## What is there

- **«Что брать»** — the verdicts: what to take, what only if cheap, what never; one's own ratings
  free, other people's in aggregate from three people.
- **Purchases and trips** — a catalogue lookup with transliteration and typo tolerance, barcodes,
  unit prices; written offline through a queue on the phone.
- **Receipts** — a photo of a receipt read into lines (Claude Haiku for everyone's first ten and
  for those granted it, Tesseract for the rest), a Serbian receipt by its QR from the tax office.
- **Money** — spendings, incomes, exchanges with the person's own rate, accounts, budget, charts.
- **The bot** — the way in, rating reminders, notices.

## Quick start

Requires Node 22, at least 22.22.2 (`.nvmrc`; npm will not install stylelint 18 on an older
one), Docker, and Python 3 only for regenerating icons.

```bash
make setup   # symlinks, .env with this copy's ports, dependencies, git hooks
make up      # Postgres in Docker, migrations applied
make dev     # api, pwa and bot together
```

Then the PWA is on the port `make ports` prints — 5300 for the main working copy. Signing in
needs the development bot's token in `.env`; `make model` fetches the model of search by meaning,
`make reader` starts the receipt reader, `make seed YES=1` fills the catalogue.

## Commands

`make` on its own lists everything. The Makefile is the entry point; `bin/` only holds
what it does not cover.

|                     |                                                                |
| ------------------- | -------------------------------------------------------------- |
| `make check`        | format, lint, types, tests — what CI checks but end-to-end     |
| `make e2e`          | end-to-end tests in a phone-sized browser                      |
| `make psql`         | psql inside this copy's database                               |
| `make db-reset`     | drop this copy's volume and start clean                        |
| `make seed`         | the common names into the catalogue; a dry run without `YES=1` |
| `make gates FROM=…` | read gates 0.2 and 0.3                                         |
| `make certs`        | a locally trusted certificate, for the camera on a real phone  |
| `make prod-build`   | build the production images without deploying them             |
| `make icons`        | regenerate the app icons from `favicon.svg`                    |
| `make ports`        | this copy's index and ports                                    |

Checks run where they count — in CI, on every push and pull request: formatting, lint, types,
every test and end-to-end in four shards. Locally `pre-commit` only checks the formatting of the
files committed. Runs typed by hand take turns under one lock for the machine.

## Layout

```
backend/         Fastify: routes -> use cases -> db. The only write path
frontend/        Vue 3 + Vite PWA, SCSS with design tokens, i18n from day one
bot/             grammY, a client of the API
packages/model   Domain: types, Zod schemas, pure rules. Depends on zod and nothing else
packages/client  Typed API client over the shared schemas
services/        Non-TypeScript services: receipt-reader, Tesseract behind HTTP
e2e/             Playwright, phone profiles only
deploy/          Production: compose, Caddy, backups, metrics, the outside watch
docs/            The map of documents and of the code (docs/map/)
```

Layer boundaries are enforced by the linter, not by review: the domain may import nothing
but zod, use cases know nothing about HTTP, routes never reach the database, and the bot
has no database driver at all.

## Branches and releases

A task is one branch, `MOL-<n>-<short-description>`, cut from the current `release/<name>`,
and its pull request goes back into that branch. `master` takes only `release/*`, `hotfix/*`
and Dependabot's pull requests, and **a merge into `master` is a deploy**: a day's tasks go out
as one release — on the owner's word or by itself at 03:00 Yerevan time — tagged
`v0.2.<n>-<name>`, and the next `release/<name>` is cut right after. Never a force push.
The rules are in `CLAUDE.md`, «Releases».

## Several working copies at once

Copies run side by side, each on its own branch, with their own ports and database:

```bash
git worktree add ../molvia2 -b MOL-123-some-task origin/release/<name>
cd ../molvia2 && make setup
```

`bin/init-env.sh` takes the copy's index from the directory name and spreads the ports. The
development bot's token lives in one copy at a time — the one testing the login: two processes
on one token split Telegram's updates between them at random.

## Deployment

One VPS, one compose file, Caddy holding the certificate. A release builds six images to GHCR
(backend, bot, frontend, receipt-reader, and the metrics' Grafana and VictoriaMetrics) and rolls
them out; a failed rollout puts the previous images back. The database is copied every night,
encrypted, off the machine. See `deploy/README.md`.

## Where the documents are

See [`docs/README.md`](docs/README.md) for the map. In short: rules live in `CLAUDE.md` and
`.claude/rules/`, the product plan and the design live in Confluence, and the tasks live in
Jira — all reachable through the `jira-confluence` MCP server configured for this copy.
