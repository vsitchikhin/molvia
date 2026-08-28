# Molvia · Молвия

**Read this first:** `.scratch/docs/product-plan.md` — the full product plan with the
reasoning behind every decision. Everything below is only anchor points to get the
context in a minute, plus the rules for working on the code.

## What this is

An app for emigrants: **what is worth buying, and where**, in an unfamiliar country.
Not an expense tracker — that niche is taken (Toshl, Spendee, Groceries Tracker).
What is free is the subjective judgement: everyone counts money, nobody answers
whether this cheese is edible.

The rule that holds the whole product together:
**cheap but bad is never recommended anywhere; good is looked up at its lowest price.**

The author lives in Gyumri, earns in rubles, spends in drams. First market —
Gyumri and Yerevan, the Russian-speaking diaspora.

## Decisions that are easy to break unknowingly

- **The two data streams must not be mixed.** A verdict is rare — one per
  «item + place» pair, and it is the core. An expense is frequent, an accounting layer.
  A rating is not required at the moment of purchase; the reminder arrives the next day.
- **The schema key is «item + place»**, so that restaurant dishes fit without a migration.
- **Entering an item is a lookup in a catalogue**, not an empty text field.
  The barcode is only an accelerator: loose goods have none, and that is exactly where
  the price spread is widest.
- **Releases are cut by hypothesis, not by feature.** Each has a question and a number
  at which work stops. The order is deliberately counter-intuitive: barcodes in 0.2,
  aggregates in 0.3. Do not "improve" that order without checking against the plan.
- **There are never ads or paid placements in results** — trust in the verdict is the
  one asset that cannot be written off.

## Gates with kill thresholds

|     | Question                                   | Stop                                                                |
| --- | ------------------------------------------ | ------------------------------------------------------------------- |
| 0.1 | Will I use this myself?                    | I stop entering data 2 weeks in a row                               |
| 0.2 | Do strangers fill the base?                | <20% reach 5 ratings within 2 weeks                                 |
| 0.3 | Do they come back for other people's data? | <15% week-4 return, **measured separately** for products and venues |
| 1.0 | —                                          | scaling what is proven                                              |

The counters for these thresholds must exist **before the first 0.2 feature**, otherwise
the gates are decorative and the project loses the ability to fail on time.

## Money

Access is a monthly resource: ~10 ratings = a month, or $1. Contribution does not expire
and is spent before money; there are no auto-charges. Tips via Telegram Stars from 0.3.
It is accepted that there is no revenue for the first two years.

---

# Engineering

## Stack

TypeScript everywhere — **the only reason the language was chosen**: shared types for the
item, verdict and session models across PWA, API and bot. Performance was not a criterion:
the load is I/O-bound, with three orders of magnitude of headroom.

| Layer             | Choice                                                  | Why this one                                                                               |
| ----------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| PWA               | Vue 3 + Vite + Pinia + vue-router + vite-plugin-pwa     | less ceremony and a smaller bundle than React; the target is a phone at the shelf          |
| Styling           | SCSS, tokens in `styles/_tokens.scss`                   | no plain CSS anywhere; tokens stay custom properties, so the dark scheme is a runtime swap |
| Scanner           | `zxing-wasm`, live viewfinder via `getUserMedia`        | we need EAN, not QR                                                                        |
| API               | Fastify + Zod                                           | Zod schemas shared with the frontend and the bot                                           |
| DB                | PostgreSQL + Drizzle                                    | schema in TS, generated migrations, honest drop into raw SQL                               |
| Bot               | grammY                                                  | distribution, auth, rating reminders                                                       |
| Receipt OCR (1.0) | separate Python service                                 | the TS ecosystem has nothing here                                                          |
| Tests             | Vitest (domain, use case, component) + Playwright (e2e) | three vitest projects, so the domain keeps running without a DOM                           |
| Lint              | ESLint 9 type-aware + Stylelint + Prettier              | strictest tier; SFCs go through the same type checker as `.ts`                             |

**Tailwind was dropped.** Not one utility class was in use — everything is styled with
scoped SCSS through tokens — and its CSS-first `@import` cannot pass through Sass.

**Postgres does the heavy lifting:** `pg_trgm` for typos, `unaccent` for transliteration,
GIN index; aggregates (average ratings, minimum price, store index) are plain SQL.
Hence Drizzle: Prisma hides exactly what everything here rests on.

**Telegram Mini App was dropped:** `getUserMedia` is broken on both platforms and the
native scanner only reads QR. Native is a 1.0 question.

**Exchange rates:** official ones from the open CBA API; real exchange rates from users.
Scraping rate.am was rejected.

## Commands

**The Makefile is the canonical entry point** — prefer a `make` target over a raw script.
`bin/` only holds sub-operations the Makefile does not cover. `make` with no target
prints the list.

```bash
make setup       # fresh copy: symlinks, .env, dependencies
make up          # start Postgres and apply migrations
make down        # stop the stack, keeping the data
make psql        # psql inside this copy's database
make db-reset    # drop this copy's volume and start clean (DESTRUCTIVE)
make dev         # run api, pwa and bot
make e2e         # end-to-end tests in a phone-sized browser
make check       # format -> lint -> typecheck -> test, in order
make ports       # this copy's index and ports
```

Ports, database name and compose project all come from `.env`, so `make` behaves
differently in every working copy by design.

Targets that need the scaffold report that it is missing instead of failing obscurely —
the repository has no `package.json` yet.

## Architecture

npm workspaces monorepo. A pure core with thin adapters — no DI container and no ports
layer: the core is tested directly.

```
apps/                     TypeScript workspaces
  api/          Fastify
    src/routes/     HTTP: parse -> call the use case -> respond. Zero business logic
    src/usecases/   scenarios: orchestrate domain and repositories
    src/db/         Drizzle schema, migrations, repositories — the only place with SQL
  pwa/          Vue 3 + Vite: views, composables, styles/tokens.css, i18n
  bot/          grammY, a client of the API
packages/
  model/        domain: types, Zod schemas, pure rules (money, units, errors,
                and the verdict once it exists). Dependencies: zod only
  client/       typed API client built on the model schemas
services/                 anything that is not a TypeScript workspace
  receipt-ocr/  Python, 1.0, not started
```

`services/` is separate from `apps/` on purpose: a different runtime is a different
boundary, and it should be visible in the tree rather than only in the docs.

Packages export their TypeScript source (`"exports": "./src/index.ts"`), so there is no
build step between a change in the domain and the app that uses it.

**Boundary rules — enforced by the linter, not by eye:**

- `packages/model` imports nothing but `zod`. Not fastify, not drizzle, not vue,
  not `node:*`. If a rule needs I/O, it is not a domain rule.
- `usecases` know nothing about HTTP: no `request`, no `reply`, no status codes inside.
- `routes` contain no business logic and never reach the database except via repositories.
- SQL lives only in `src/db`. Not a single line of SQL in routes or use cases.

**The API is the only write path.** The bot and the PWA are its clients and have no direct
database access. In a product about data integrity, two write paths will silently diverge.

## Money and quantity rules

- **Never `float`.** An amount is an integer in minor units: `amount_minor bigint` +
  `currency char(3)`, minor unit = 1/100 for every currency. Drams are fractional in
  practice (a receipt for 5403.12 ֏) — "drams are whole" is a false simplification.
- **The rate is stored with the transaction** and never recomputed retroactively.
  Otherwise last month's total changes with today's rate.
- **Compare by unit price only** (per kg / l / piece). Unit price is computed, never
  entered. 520 ֏ for 0.9 l is more expensive than 570 ֏ for a litre, and the user must
  not have to work that out in their head.
- Rounding happens on output only — never in storage or in intermediate results.

## Data rules

- **Verdict and expense are separate tables with separate write paths.** Do not merge
  them into one input screen: they have different frequencies and different motivations.
- **Exactly one field is required — the item.** Everything else may be left empty.
- **Entering an item is a catalogue lookup** with transliteration and typo tolerance,
  not free text. Free text produces `МОЛОКО МАРИАН 1Л`, which cannot be tied to the canon.
- **Result ordering must never contain a field like `sponsored`, `boost`, `promoted`.**
  If such a field appears in the schema or in an `ORDER BY`, that is a product violation,
  not an optimization.
- **Privacy:** expenses are always private. Prices and ratings are public only in
  aggregate, and an aggregate is not shown until it holds several independent
  contributions — otherwise someone's basket can be derived from the "average price".
- Country and city are part of the key from the start, not "we'll add it later".

## Frontend and styling rules

- **The target device is a phone in one hand, at the shelf, in bad light.**
  Everything is designed from there; desktop is derived.
- **Tokens live in one file** (`styles/_tokens.scss`). Components use variables only:
  not a single hardcoded hex, not a single magic spacing off the scale. Stylelint enforces
  both — a literal colour or an off-scale padding fails `make lint`.
- **Everything is SCSS.** There is no plain CSS in the project.
- Touch target >= 44px. The primary action is reachable with a thumb.
- **Every screen has four states:** loading, empty, error, offline. The empty state is not
  "no data" but an offer to act.
- **Every SFC is one file in one fixed order:** `<template>`, then `<script lang="ts">`
  exporting a `defineComponent`, then `<style scoped lang="scss">`. The linter keeps the
  order, both languages and the `scoped` attribute; none of it is left to memory.
  Stateful logic goes into composables, not into components.
- **Not a single string of text in the markup — everything through i18n keys, from day one.**
  The plan assumes expanding to other languages without rebranding; hardcoded strings are
  the cheapest mistake today and the most expensive one a year from now.
- **No business logic on the frontend.** The verdict, the unit price and the conversion are
  computed by the server. Client-side validation is for UX only; the backend is the source
  of truth.
- Split components so they are not overloaded, but without five wrappers around one tag.
  One well-scoped component beats five trivial ones.

## Code rules

- **Minimal diff** — change only what the task requires. No drive-by refactoring, no
  renaming "along the way".
- **DRY / KISS** — do not duplicate, reuse what exists. But do not abstract ahead of time:
  three clear lines beat a premature helper.
- **Comments** — no noise. A short "why" for non-obvious business logic, never a retelling
  of the code.
- **Domain errors** come from a shared message registry, not from strings written in place.
  HTTP status codes are assigned by the central error handler; never write
  `try/catch -> 400` in a route.
- **IDOR** — every identifier taken from a request is verified against the authenticated
  subject.
- **No secrets in code or commits** — only `.env`, which is in `.gitignore`.
- **A new dependency is discussed.** Each one is bundle size at the shelf and supply chain.
- **If a rule gets in the way, change the rule explicitly** — discuss it, do not silently
  work around it.

## Testing

| Layer       | Where                   | What it covers                            | Dependencies                             |
| ----------- | ----------------------- | ----------------------------------------- | ---------------------------------------- |
| Unit        | `packages/**/*.test.ts` | pure rules from `packages/model`          | nothing but the domain                   |
| Use case    | `apps/api/**/*.test.ts` | `usecases`                                | fake repositories, no DB                 |
| Component   | `apps/pwa/**/*.test.ts` | rendering and the four screen states      | happy-dom, `@vue/test-utils`, API mocked |
| Integration | `apps/api/**/*.test.ts` | schema, search, aggregates, HTTP contract | a real Postgres                          |
| End-to-end  | `e2e/**/*.spec.ts`      | the whole stack through a browser         | Playwright starts api and pwa itself     |

**End-to-end runs in a phone profile only.** The product is designed for a phone at a
shelf, so a desktop-only pass would prove nothing about the screen that matters.

- **Catalogue search is tested only against a real Postgres.** `pg_trgm` and `unaccent`
  cannot be faked, and they are exactly what breaks.
- **When a test fails, look for the bug in the code first** — do not adjust the test to
  match the behaviour. A test proves the app works, not the other way round.
- **Maximize corner cases.** Mandatory checklist:
  - NULL / legacy — the field is empty but the entity still falls under the rule
  - alternative write path — the same outcome reached by a different route
  - boundary — exactly N, N-1, N+1
  - "must not fire" — a state where the action is required not to trigger
  - Molvia-specific: transliteration and a typo in search, weight vs pieces, a non-local
    currency, an item without a barcode, a second price for the same «item + place» pair

## Workflow

### Before a task

1. **A plan before code for anything large** — a feature from the release cut, or a schema
   migration. The file goes to `.scratch/tasks/plans/<release>-<slug>.md`, before the first
   line of code. Small fixes go straight to code.
2. **We gather requirements ourselves** — there are no specs. The source is
   `.scratch/docs/product-plan.md`; if it has no answer, the requirement is stated
   explicitly in the plan and talked through.
3. **Check against the release cut.** Before building a feature, work out which release it
   belongs to and which hypothesis it tests. A feature without a hypothesis is not built.

### After a task

**Definition of Done:** `make check` — `format` -> `lint` -> `typecheck` -> `test`,
all green. Run them once after the entire plan, not after each step: `format` mutates files
and would otherwise hide real lint errors.

If a decision changed along the way — **update `.scratch/docs/product-plan.md` immediately.**
A plan that diverges from the code is worthless, and here the plan matters more than the code.

### Commits

- **The agent commits on its own**; no need to ask permission for each one. The split into
  commits is planned in advance and proposed together with the plan; do not pile everything
  into one final commit. "Ready" = the piece is self-contained (migration + schema; the
  screen separately; the tests separately).
- **Push when everything for the task is done**, not after every commit.
- **The only author is the repository owner.** A `Co-Authored-By:` line in any form is
  forbidden — do not add it automatically or as a tool default.
- **Format — Conventional Commits with the app as scope:** `feat(pwa): ...`,
  `fix(api): ...`, `chore(db): ...`. Imperative subject line, body for the "why".
- **Branches:** `<release>/<short-description>`, e.g. `0.1/verdict-input`.

### Ask before, not after

Migrations that lose data, swapping a stack element, CI changes, refactoring outside the task.

## State

The scaffold exists and `make check` is green on it; there are no features yet. The domain
already holds the two rules everything else will lean on — money in minor units and unit
price — with tests written from real receipts. The first steps are at the end of
`.scratch/docs/product-plan.md`.

`docker-compose.yml` runs Postgres only. The api / pwa / bot services join it once the
scaffold exists; in development they are meant to run natively anyway — HMR and a debugger
attached to a host process beat a rebuild inside a container. Extensions (`pg_trgm`,
`unaccent`) are deliberately not created by an init script: the schema belongs to
migrations, and a second source of truth for it would drift.

## Several clones in parallel

The project is meant to have several working copies side by side: `pets/molvia`,
`pets/molvia2`, … Each one runs its own task on its own branch.

**Create a copy as a worktree, not a clone:** `git worktree add ../molvia2 -b 0.1/name` —
a shared object store, nothing is re-fetched, and one branch physically cannot be checked
out in two copies. A full clone is only needed when an independent `.git` is required
(an experiment with history, for instance).

**After every new copy — one command:**

```bash
make setup   # bin/link-shared.sh, then bin/init-env.sh, then npm install
```

`bin/link-shared.sh` points `.scratch` and `.lavish` at the shared directory and is
idempotent. `bin/init-env.sh` takes the index from the directory name (`molvia` -> 0, `molvia2` -> 2) or
from an argument, computes the ports and warns if they are already taken. It does not
overwrite an existing `.env` without `--force`.

**What is shared and what is per-copy:**

|                                | Where                             | Why                                                     |
| ------------------------------ | --------------------------------- | ------------------------------------------------------- |
| Plan, task plans, lavish       | shared, `../_shared/molvia/`      | one truth for all copies; survives deleting any of them |
| Branch, `node_modules`, `.env` | per-copy                          | otherwise the copies are not independent                |
| Ports, database, bot           | per-copy, spread by `CLONE_INDEX` | see below                                               |

**Isolation between copies rests on `CLONE_INDEX` from `.env`.** Ports are base plus
`CLONE_INDEX*10`; the database and compose project names get a suffix. The main copy is `0`.

|          | Copy 0     | Copy 2     |
| -------- | ---------- | ---------- |
| API      | 3300       | 3320       |
| PWA      | 5300       | 5320       |
| Postgres | 5500       | 5520       |
| Database | `molvia_0` | `molvia_2` |

Molvia has its own port band rather than the defaults: the machine already has the work
project's Postgres and Vite listening on 5432 and 5173, so with the defaults Molvia would
fight with work, not just copy with copy.

**`.env` holds literals only, no `${...}`.** Compose does perform that substitution but
`dotenv` in Node does not; a file that looks computed would silently behave differently
from how it reads. That is why `.env` is generated by `bin/init-env.sh` and not edited
by hand.

- **Each copy gets its own database.** A shared database plus parallel migrations kill each
  other, and silently: the second copy sees a foreign schema and assumes the migration is
  already applied.
- **Each copy gets its own bot.** Two processes on one token steal each other's updates via
  long polling — silently and unreproducibly. Register a separate bot in BotFather.

**Task plans in the shared directory are named after the task, not the copy** —
`.scratch/tasks/plans/<release>-<slug>.md`. A copy is temporary, a task is not.

`.scratch` and `.lavish` are symlinks to `../_shared/molvia/{scratch,lavish}`, outside the
repository and in `.gitignore`. The links are relative, so the whole `projects/` tree can be
moved at once. The `_shared` directory is deliberately not in git — in a fresh clone
`bin/link-shared.sh` restores it.

## Related

The Google Sheets the project grew out of live in the Drive folder «Жизнь» and are reachable
through the `google-sheets` MCP server (see the memory in the `~/` branch). Accounting in
drams on a ruble salary already works there.
