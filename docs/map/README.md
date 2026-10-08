# Code map

Where things live, so a task starts from here and not from a search of the repository. Open the
file of the task's area — named as its rules file in `.claude/rules/` — and go straight to the files
it names; the first one you read brings the area's rules with it. This file holds what belongs to no
area: the skeleton below.

The map says where; the rules say how not to. An entry is one line: what the file is and what it is
for, never how it works.

**Keeping it true.** A file added, moved or removed changes the map in the same commit.
`bin/check-code-map.mjs` runs in `make lint` (so in the pre-commit hook and CI) and refuses a file
the map does not cover, an entry whose path does not exist, and a file with two homes. A file is
covered by its own entry; a test beside its source (`x.test.ts` next to `x.ts` or `x.vue`) or
mirroring it (`packages/model/tests/a/b.test.ts` for `packages/model/src/a/b.ts`) by the source's
entry; a data file (`sql`, `json`, fonts, icons) by an entry for a directory above it.

## Areas

| Map                  | What is in it                                                                  |
| -------------------- | ------------------------------------------------------------------------------ |
| `search.md`          | catalogue search, the search key, synonyms, remembered picks, the seed         |
| `advice.md`          | «Что брать», verdicts and «Оценки», the event log, the gates                   |
| `trips.md`           | «Покупки», the record typed by hand, the queue on the device, places, settings |
| `barcodes.md`        | the barcode scanner, a code typed by hand, the item by its code (MOL-99)       |
| `receipts.md`        | the receipt photo, its reader, the queue that reads it, the lines it gives     |
| `money-rates.md`     | official rates and their feeds, exchanges, incomes, the wallet                 |
| `money-spendings.md` | spendings, categories, the month, the «Деньги» screen and its queue            |
| `money-accounts.md`  | accounts, balances, «Списано со счёта», the check                              |
| `auth.md`            | sessions, the login request, the cookie, the login screen, «Выйти», devices    |
| `privacy.md`         | erasure, the privacy page, logs                                                |
| `feedback.md`        | «Написать разработчику»: the message, its sheet and its two ways in            |
| `bot.md`             | the bot: its half of the login, `/delete`                                      |
| `observability.md`   | failures of the API and the bot, the owner's channel in Telegram (MOL-143)     |
| `frontend.md`        | the app shell and kit: `App.vue`, the screen frame, the sheet, states, styles  |
| `e2e.md`             | end-to-end infrastructure; each spec lives in its area's map                   |
| `deploy.md`          | images, the production stack, backups, the release workflow                    |
| `workspace.md`       | the repository root, `bin/`, hooks, CI, module configs, the code-map check     |

Layers inside an area's map come in one order: `packages/model` → `packages/client` → backend routes
→ use cases → db → tests → frontend views → components → composables → stores → `bot` → `e2e`.

## Skeleton

What every area stands on: the API's composition point, the parse seam, db plumbing, the domain's
support types, the shared integration tests, the migrations.

### packages/model

- `packages/model/src/contracts/wire.ts` — Wire contracts shared by API, PWA and bot: the health answer, the error answer and the registry codes that may cross.
- `packages/model/src/index.ts` — The domain's public surface: re-exports every support, value, entity and contract module.
- `packages/model/src/support/decimal.ts` — Fixed-point decimals: typed text to scaled bigint and back, conversion by a scaled rate, rounded division.
- `packages/model/src/support/errors.ts` — The error registries: domain `ERROR` codes and parse `ISSUE` codes, which double as i18n keys, and `DomainError`.
- `packages/model/src/support/locale.ts` — The app's languages and `pickLocale`: Russian unless the first platform tag is English; for PWA and bot.
- `packages/model/src/support/patch.ts` — Patch helpers: whether a patch changes anything, and the «empty patch» refusal.
- `packages/model/src/support/resource.ts` — What a resource address may look like: `isResourceId` and `resourceIdOf`, the uuid folded to lower case.
- `packages/model/src/values/money.ts` — Money value: currencies, minor-unit exponent per currency, parsing, arithmetic, wire codecs and formatting with the sign.
- `packages/model/src/values/units.ts` — Units and quantities: kg, l, piece and their smaller units, quantity codec, unit price computed, compared and formatted.

### packages/model · tests

- `packages/model/tests/adversarial.test.ts` — Test: every scenario an adversarial pass found in the model — parsing, money, units, patches, verdicts, wire — pinned by name.

### packages/client

- `packages/client/src/index.ts` — The typed API client: one method per route of the API, every answer parsed with the model's codecs; re-exports the bot client.
- `packages/client/src/transport.ts` — Client transport: fetch with a timeout and `ApiError` with `answered` and, for a reply off the contract, its `status`; only the API's own error body may say `error.no_actor`, never a bare 401.

### backend · routes

- `backend/src/routes/empty-body.ts` — Route helper `refuseAnyBody`: a request that must carry no body is refused before it is buffered.

### backend · db

- `backend/drizzle/` — The migrations: numbered SQL files and drizzle's journal, applied in order when the API starts.
- `backend/src/db/columns.ts` — Column pairs to domain values and back: money, quantity and the rate snapshot, assembled in one place.
- `backend/src/db/digest.ts` — `sha256Hex`: the one digest a secret is stored as in the database.
- `backend/src/db/index.ts` — The database connection: lazy postgres client and drizzle instance, `Db` and `Conn` types, the reachability probe.
- `backend/src/db/rows.ts` — Row helpers: `theRow` for a write that must return one, `idOrNull` for a malformed id, `rowLimit`.
- `backend/src/db/schema.ts` — The Drizzle schema of every table with its checks and indexes — what the migrations are generated from. Tests: `backend/tests/schema.integration.test.ts`.
- `backend/src/db/unit-of-work.ts` — Unit of work: the repositories a trip or money use case reaches, bound to one connection, and `transactOn` for one transaction.
- `backend/src/db/yerevan-week.ts` — SQL fragments: the Monday in Yerevan of the week an instant falls in, shared by erasure and the gates, and the day in Yerevan, the key of `login_days`.

### backend · other

- `backend/src/env.ts` — The API's environment: loads the copy's `.env`, validates ports — the metrics' too (MOL-145) — database, rate refresh, build version and login configuration.
- `backend/src/index.ts` — The API process's entry: migrations at boot, the search keys recomputed after them (MOL-109), the shops' memory settled once it listens (MOL-240), the scheduled official-rate refresh, then listening — and, where `METRICS_PORT` is set, the metrics' own port (MOL-145).
- `backend/src/parse.ts` — The parse seam for body, query and path, shared by routes and use cases; `InvalidBody` and the resource-id parse.
- `backend/src/server.ts` — `buildServer`, the API's composition point: the request log of method and path, the central error handler, `no-store` on auth paths, the build on every answer, all routes and timers wired.

### backend · tests

- `backend/tests/bundle-seam.integration.test.ts` — Integration test: the production bundle carries no development login seam.
- `backend/tests/corners.integration.test.ts` — Integration test: repository corners — a second price for one pair, a third currency in a trip, barcodes, dangling refs, bad rows.
- `backend/tests/database-image.integration.test.ts` — Integration test: the database image carries what the contract needs — pgvector with HNSW, ICU sorting, no collation of another ICU version.
- `backend/tests/db.ts` — Test support: the test database's URL and short-lived connections to it, raw and through drizzle.
- `backend/tests/error-handler.integration.test.ts` — Integration test: a body that did not parse is a 400 naming the field, and a unique clash is a conflict, not a 500.
- `backend/tests/version-header.integration.test.ts` — Integration test: every answer names its build in `X-Molvia-Version` — refusals, missing routes and framework errors too.
- `backend/tests/fixtures.ts` — Test support: minimal rows a foreign key demands (actor, item, place, trip, session, login request), sign-in and clearing.
- `backend/tests/hardening.integration.test.ts` — Integration test: fixes from an adversarial pass — write order in a transaction, limits, malformed ids, reviews, conflicts, empty patch.
- `backend/tests/listings.integration.test.ts` — Integration test: repository reads — empty lists, order and limit, purchases awaiting a rating, where it is cheaper, ratings.
- `backend/tests/migration-0010.integration.test.ts` — Integration test: migration 0010 merges places that the new identity makes one, so the API still starts.
- `backend/tests/migration-0012.integration.test.ts` — Integration test: migration 0012 empties owners without a Telegram identity and keeps what must survive.
- `backend/tests/migration-0061.integration.test.ts` — Integration test: migration 0061 removes what a removed trip or purchase left of its receipt, then makes the receipt go with its trip and the line with its purchase (MOL-240).
- `backend/tests/migrations.integration.test.ts` — Integration test: the migration chain applies on a database that already holds rows from earlier steps.
- `backend/tests/ownership.integration.test.ts` — Integration test: every repository read and write is scoped to its owner; someone else's row answers as a missing one.
- `backend/tests/repositories.integration.test.ts` — Integration test: the core repositories — actors, catalogue, places, trips with purchases, verdicts — write and read back.
- `backend/tests/schema.integration.test.ts` — Integration test: the constraints the schema itself refuses — uniqueness, paired columns, references, gate log, picks, sessions.
- `backend/tests/setup-db.ts` — Vitest global setup: creates and migrates the copy's test database — the workers' template — drops the last run's copies and builds the API bundle once.
- `backend/tests/setup-worker.ts` — Vitest setup file: gives each integration worker its own copy of the test database, made from it as a template.
