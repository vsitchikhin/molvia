# Molvia · Молвия

**Read these first, before anything else.** They are short and they carry the context this
file assumes:

|                      |                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `docs/onboarding.md` | What the product is, what already exists, where the work comes from, and which decisions must not be reopened |
| `docs/tracker.md`    | Jira and Confluence: what the MCP server can and cannot do, field ids, the traps                              |
| `docs/README.md`     | The map: what lives where and why                                                                             |

The full product plan, with the reasoning behind every decision, is in Confluence — page
`327681`, read it through the `jira-confluence` MCP server.

**This file is the core: what concerns the whole project, and a line for each rule of an area that
is easy to break.**
The reasons behind an area's rules — what was measured, what was tried and refuted, the price
of each decision — live in `.claude/rules/<area>.md`, which Claude Code loads when the work
touches that area's files. Before changing an area, read its file whole; a line here is the
rule, not its argument.

Everything below is the rules for working on the code.

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

The log's writer, the cohort and both gate queries are pinned in `.claude/rules/advice.md`:

- **The one writer is «Что брать»** (MOL-31): `advice_viewed`, `subject: product`, only in the
  shared mode, at most once per owner and payload per day of the person's own life, under an
  advisory lock per actor; a failure to record is not swallowed. The catalogue search writes
  nothing, and `session_started` stays withdrawn.
- **Both halves of the gate count from `actors.created_at`**, never from a first event, in hours
  rather than calendar days (Р-20). The visit is counted by intent, not by catch (Р-21).
- **The 0.3 cohort is those whose access reached their fourth week** (`actors.shared_until`,
  Р-24) — approximate on purpose, erring towards «stop».
- **The log does not outlive the person** (MOL-58): erasure is the one written exception to
  append-only.
- **The 0.2 gate is `VerdictRepository.reachedRatings`** (MOL-49): the one reader of `verdicts`
  without `deleted_at IS NULL`; its `from` is the release of 0.2, passed by the caller; a window
  still open is left out; a verdict counts from when the server received it.
- **Both gates are read by `dist/gates.js`** (MOL-91), `make gates FROM=…` in a copy: `n` beside
  every share, the stop line printed and no verdict; gate 0.3 closes its window as 0.2 does; the
  erased leave one number, by week of arrival, in `erasures`.
- **The login's funnel is `login_days`** (MOL-68): counted in each step's own transaction, by the
  day the login began, with no id at all; a device's repeat says `again=1`, so «began» is people
  rather than taps; a second way in is filed above `LOGIN_SECOND_WAY_PERCENT` (25 %) lost, read as
  the third block of `make gates`.

## Money

Access is a monthly resource: ~10 ratings = a month, or $1. Contribution does not expire
and is spent before money; there are no auto-charges. Tips via Telegram Stars from 0.3.

**The access itself exists from 0.1 (MOL-31, owner's decision 20.09.2026):**
`actors.shared_until` is a moment in time — «other people's figures are visible until then» —
so ten ratings buying a month, a dollar buying one, and a grant made by hand all land in the
same column and the paid layer needs no second migration. Nothing sets it but a person with
`psql`; empty and a past date are the same answer. What it opens is described under «Что
брать» below, and what it never opens is anyone's expenses.
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
| Bot               | grammY + `@grammyjs/runner`                             | distribution, auth, rating reminders; the runner is what makes it serve two people at once |
| Receipt OCR (1.0) | separate Python service                                 | the TS ecosystem has nothing here                                                          |
| Tests             | Vitest (domain, use case, component) + Playwright (e2e) | three vitest projects, so the domain keeps running without a DOM                           |
| Lint              | ESLint 9 type-aware + Stylelint + Prettier              | strictest tier; SFCs go through the same type checker as `.ts`                             |

**Tailwind was dropped.** Not one utility class was in use — everything is styled with
scoped SCSS through tokens — and its CSS-first `@import` cannot pass through Sass.

**Nest, Prisma, TypeORM and Quasar were considered and rejected**, each for a reason written in
`.claude/rules/workspace.md`: the domain must not import a framework, raw SQL is the main
instrument here, and a component kit would be a second source of truth about colour. If native
happens at 1.0, **Capacitor** wraps the existing web app.

**Postgres does the heavy lifting:** trigram matching and edit distance for search,
GIN index; aggregates (average ratings, minimum price, store index) are plain SQL.
Hence Drizzle: Prisma hides exactly what everything here rests on.

**Telegram Mini App was dropped:** `getUserMedia` is broken on both platforms and the
native scanner only reads QR. Native is a 1.0 question.

**Exchange rates:** official ones from the open CBA API; real exchange rates from users.
Scraping rate.am was rejected.

## Rules by area

Each area below is a file in `.claude/rules/`, loaded by its `paths:`. The lines are the rules
that are easiest to break; the file holds every rule of the area and the reason for each.

### Catalogue search — `.claude/rules/search.md`

- **Transliteration happens in `packages/model`, not in Postgres**: every name carries a
  `search_key`, the whole name normalised to Latin plus `ц` by `toSearchKey`, on write and on read.
- **The alphabet folds the transliteration forks** (`ж`, `ц`, `х`, `щ`), and Latin `c` is decided
  by the next letter — soft is `ц`, hard is `k` (MOL-11); `ц` itself is never decided by position.
- **Armenian is in the table**; `ու` and `և` are resolved before the per-character pass.
  **What draws nothing is one list, `INVISIBLE` in `text.ts`**, for the measure and the key alike.
- **The key is never an identity**: a duplicate is decided by `nameIdentity` (MOL-12).
- **The tables and the fold rules are frozen: changing one after a key is stored is a migration.**
- **Candidates come from `search_key %> $1` only** — the one form that reaches the GIN index — at
  `word_similarity` > 0.15, with the threshold set locally inside the query's transaction.
- **Ranking is by minimum Levenshtein word against word**, a budget of 2; sizes, units and
  digits do not ground a match (MOL-10, MOL-48); the last word also matches the start of a word.
- **The answer says whether it is near (MOL-46)** by every word within one edit; nothing is
  dropped for being far.
- **Every candidate is ranked; there is no ceiling** before ranking.
- **A pick is remembered per person, under the query's key** (MOL-11): above distance, only among
  what was found — except the person's own word (`search_picks.admits`, MOL-45).
- **Synonyms are a dictionary in the domain** (`synonymKeys`, MOL-45): only the query is expanded,
  a synonym counts only as the word of the kind, at most sixteen per query, never into a brand.
- **At one distance the order is fixed** (MOL-112): found by the word before by a synonym, whole
  word before a start, fats typed with «%», then the shorter name, then the similarity, the uuid.
- **The thresholds were measured and kept** (MOL-14); a change of either is checked against the
  pinned corpus. **Embeddings are a 0.2 question.**
- **The catalogue grows by «Предложить товар» and the seed** (MOL-112): the seed only adds, is
  not a migration, never stays in `_test` or `_e2e`, and holds no brands.

### «Что брать» and verdicts — `.claude/rules/advice.md`

- **«Не брать нигде» has no field for a price, a place or a threshold** — the answer is a
  discriminated union on `level`.
- **The domain owns the two figures**: `verdictLevel` and `averageScore`; the rating crosses the
  wire as a decimal string; the group is decided by the printed tenth (Р-22).
- **Free is one's own data; `actors.shared_until` opens other people's**, and `scope` travels with
  the answer.
- **An aggregate needs three people** (`AGGREGATE_MIN_CONTRIBUTIONS`); a stranger's lone verdict
  does not appear at all. **Prices are stricter**, filtered by the asker's country and city, one's
  own purchases excepted and put own city first (Р-26).
- **«Только если дёшево» is the lower median from three purchases**; one «currency + unit» per
  item; order by rating down, then name.
- **The limit never cuts one's own rows or the warnings** (Р-23, Р-25:
  `ADVICE_WARNINGS_RESERVED`); the server names no superlative; every row carries `isMine`.
- **A withdrawn verdict is still a row** (MOL-27): the gate counts every row, **every other reader
  filters `deleted_at IS NULL`**.
- **The search on «Что брать» is answered by the server** (`GET /advice/search`, MOL-128): the
  list's own statement and rules for what is found, never glued on the phone; it writes no visit and
  no pick; offline — the remembered list by the start of words.

### Money: rates, exchanges, incomes — `.claude/rules/money-rates.md`

- **Starting a record never goes to the network** (the old «Начать поход»): a trip snapshots the official rate from the cache,
  which the API refreshes hourly; the cache holds one currency against the dram per day.
- **The CBA first, then the Bank of Russia, then open.er-api.com**; a pair is never built from two
  providers; a jump is flagged, not refused; an answer that is not strict is not written; an empty
  cache gives a trip no rate, for good.
- **The person's own rate comes from exchanges, never from a typed number** (MOL-40): the wallet is
  the average cost of what is held, every currency has a cost in the currency of conversion, and
  money of no known cost is valued at the official rate of its day, marked `estimated`.
- **A change of the currency of conversion works forwards** (В-2); the chain is exact to eighteen
  digits and rounded to six once.
- **An exchange or an income is amended with its version kept**, removed with «Вернуть» for ten
  minutes, a repeat is the same write or 409, and a rate outside the band is refused where written.
- **An income is a link of the same walk** at the official rate of its day (MOL-66); money bought
  with the currency of conversion is an exchange, not an income.
- **A rate is printed on the side whose number is at least one** (`formatRate`, MOL-81).

### Money: spendings and «Деньги» — `.claude/rules/money-spendings.md`

- **A spending makes no item, feeds no price and no verdict** (MOL-73); a purchase at a shop is
  still entered in «Покупки».
- **A category is removed by archiving**, never erased; a spending in another currency keeps the
  rate of its own day, written with it and never recomputed.
- **The month is counted by the server**; a closed month is frozen at the rate of its last day,
  let go (`thaw`) from the day of an exchange or an income written, amended, removed or brought
  back, and let go whole by a change of the rule.
- **«Остаток» is the money on the accounts on the evening of the month's last day** (MOL-134), in
  the income currency, everything and without the savings — never «пришло − потрачено», and never
  frozen. **«Пришло» may take a salary from a chosen day into the next month** (the owner's 25th),
  by the person's own setting, `actors.salary_shift_day`, kept beside the settings and never in the
  form of MOL-65.
- **Removal is a mark, «Вернуть», final after ten minutes by the minute timer.**
- **Every write of «Деньги» goes through its own queue** (`stores/spendingQueue`); a write a send
  has begun on is never folded into; a spending in the queue is a row, never a figure.
- **Days of Yerevan are printed as calendar days** (`calendarDay`); the frontend's tests run in UTC.
- **A bar of «Графики» is the month of «Деньги»** (MOL-74): `countMonth` with `monthRate`, never a
  second count; its third figure is «Разница», since «Остаток» is the money on the accounts.

### Money: accounts — `.claude/rules/money-accounts.md`

- **There is no rate on an account, ever**; the balance is counted, never stored: the start and
  every operation dated after its day. A trip is dated by the day it started.
- **An account on an operation is optional**; one the owner has not got, or one that does not fit,
  is «без счёта», never a refusal.
- **«Списано со счёта» moves the balance and nothing else**, counts only while it applies, and any
  change of a trip's money takes it off.
- **A check looks for the reason before it offers to close the difference**; only a check that came
  out even is where the next one starts.
- **On the phone (MOL-123) every figure is the server's**: the default account is the screen's, a
  check recounts only once nothing put right still waits in either queue, and a difference above
  zero is written through the income's own sheet, with «сколько было до» (В-5).

### Trips and the queue on the device — `.claude/rules/trips.md`

- **Every write to a trip goes through the queue on the device (MOL-24)**, online or not; storage
  is the queue, one window sends at a time under `navigator.locks`, and a refusal other than the
  ones that hold is set aside, never retried.
- **A removed trip is marked** (MOL-76): «Вернуть» for ten minutes, **every reader filters the
  mark** except erasure, the timer and an account's «удалить или убрать».
- **A trip names its own geography** (`context`, MOL-65): a start without one is
  `error.trip_context_required`, held by the queue without a timer; the settings are settled
  choice by choice inside the `UPDATE`.
- **«Покупки» is empty, and «Что брать» greets a newcomer, only for an answer known to be empty**
  (`answeredEmpty`, MOL-77; the memory of `useAdvice`, MOL-128); a phone-side cache is read by both
  versions. **The record typed by hand goes up to «Покупки» once none is open**, never under a sheet.

### Identity, sessions, the way in and out — `.claude/rules/auth.md`

- **Identity is proved by a session; `actors.id` proves only ownership** (MOL-52, MOL-53). The
  token exists in the database only as a `sha256`; revoking a session is deleting its row.
- **A login is a five-minute, one-use request** (MOL-54); whose Telegram confirms is not checked,
  an accepted price; the cookie is sent after commit, only once.
- **`backend/src/cookie.ts` is the only module that touches a cookie**: `__Host-`, `HttpOnly`,
  `Secure` always, `SameSite=Lax`, `Max-Age`; setting it and saying `no-store` are one act.
- **What a secret may look like is one rule, in `backend/src/secret.ts`**; more than one cookie of
  that name is refused, and the refusal clears nothing.
- **The term slides, moved by one write a day**; four refusals give one answer, `401 error.no_actor`.
- **The login is a gate, not a route** (MOL-56): the door has one definition, `login.closed`; the
  device remembers the request and never the secret; whose account this is, is asked before anyone
  is let in; the queue and the drafts send only once the server has said who we are.
- **«Выйти» erases this device's drawer after the server's `204`, never on the tap** (MOL-57); a
  lost `204` is settled by the server's next answer; offline there is no way out.

### Privacy: erasure, trackers, logs — `.claude/rules/privacy.md`

- **Erasure is one function**, `ErasureRepository.erase`, in one transaction; catalogue items stay
  with `created_by` nulled, every place stays, and one is added to `erasures` — a count by week of
  arrival, no id (MOL-91). **A new table that points at `actors` must join
  erasure** — a test holds `ACTOR_REFERENCES` to every foreign key.
- **Locks are taken in one order everywhere**: the account, then the request rows, then the owner.
- **No third-party trackers or analytics**; any third-party script that sees data is a decision.
- **Logs live fourteen days and carry no address and no query**; a failure is logged by its kind
  through `describeFailure`, never by its message.

### The bot — `.claude/rules/bot.md`

- **Whose data goes is `ctx.from.id`, never anything in the button.**
- **Every message is an i18n key**; the bot keeps no state of its own and repeats none of the API's
  rules.
- **Updates of different people at once, of one person in order** (`@grammyjs/runner` with
  `sequentialize`).
- **An outcome is written into the message; a refusal is only shown over it, and written nowhere.**
- **Telegram updates are never logged whole.**

### Frontend — `.claude/rules/frontend.md`

- **Two self-hosted faces, Nunito and Onest; the dram sign from a face of its own.**
- **Every screen has four states — loading, empty, error, offline — drawn by `ScreenSkeleton` and
  `ScreenState` only** (MOL-19): offline is never red, and offline or error is decided after the
  failure; polite states speak through the one live region in `App.vue`.
- **Native HTML first, then Reka UI, never a styled kit**; the catalogue combobox is our own.
  Interface icons come from MDI through `unplugin-icons`.
- **An installed app takes a new version only when hidden and holding no typing** (`pwaUpdate.ts`),
  **or by «Обновить»** (MOL-132): never reloaded without the tap; the strip is the top row over the
  tab bar, and an error while a version waits offers it first.
- **Every screen sits in `AppScreen`, and every move goes through the router** (MOL-17); no gesture
  is intercepted but the sheet's own pull down (MOL-80); only the page scrolls, except a sheet.
  **«Что брать» is home** (MOL-128): the `tabMove` of «back»; old addresses of «Поход» redirect for
  good.
- **A screen is built from the kit** (MOL-18); the sheet is a native `<dialog>` with an entry in the
  history, and puts the page back — and focus, wherever the platform gave it — by what it was
  opened from (MOL-63, MOL-80). **Its press is heard on the document**: iOS hands a tap on the
  scrim only to a listener there (MOL-80).

### End-to-end — `.claude/rules/e2e.md`

- **End-to-end has a database and ports of its own**, and the database is dropped before every run.
- **Every spec comes in through `open()` in `e2e/session.ts`.**
- **The sheet alone also runs on WebKit** (`iphone`, MOL-80); a test it cannot run says why.
- **Words said out loud are taken by a locator outside the live region**, never muted with
  `.first()`.

### Deployment — `.claude/rules/deploy.md`

- **`api` and `bot` ship as a single bundled file each**; every container logs to journald for
  fourteen days; the database is copied every night, encrypted, off the machine.
- **Migrations run when the API starts. A merged migration is never rewritten**; before the merge
  a task's migrations may be folded, and every database that ran the old file is brought into
  line by hand.
- **A merge is a deploy** (MOL-90); a failed deploy puts the previous image back, not the schema,
  **so a migration that drops or renames goes out in two merges**.

## Tracker and documentation

They live outside the repository, on the same Atlassian site, reachable through the
`jira-confluence` MCP server configured for this working copy.

|                                 | Where                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Tasks, epics, sprints           | Jira, project **MOL** — `https://molvi.atlassian.net/jira/software/projects/MOL` |
| Product plan, design, decisions | Confluence, space **MOL** — page `294930` is the root                            |
| Rules for writing code          | `CLAUDE.md` and `.claude/rules/*.md`, in the repository                          |
| The map of all three            | `docs/README.md`, in the repository                                              |

The split is deliberate. Rules change together with the code and must be reviewed in the
same commit, so they belong in git. The plan and the decisions do not follow the code and
must survive a lost disk, so they belong in Confluence, which keeps versions and backups.

**An epic carries the why, a task carries the what.** Descriptions in Jira are written to
answer why a thing is done the way it is, not to restate the title — so a later session
does not reopen a settled question.

The operational side — what the MCP server cannot do, the field ids and the traps —
is in `docs/tracker.md`.

**Where a new rule goes.** A rule of one area goes into that area's file in `.claude/rules/`,
with its reasons, and gets one line in «Rules by area» above only if it is easy to break. A rule
that concerns the whole project goes here. A new area is a new file with its own `paths:`, and a
line in the map (`docs/README.md`). The chronicle of tasks is not rules: it goes to
`docs/onboarding.md`. Never pull an area's file into this one with `@import` — imported files
load at launch, which is exactly what the split avoids.

## Commands

**The Makefile is the canonical entry point** — prefer a `make` target over a raw script.
`bin/` only holds sub-operations the Makefile does not cover. `make` with no target
prints the list.

```bash
make setup       # fresh copy: symlinks, .env, dependencies, git hooks
make up          # start Postgres and apply migrations
make down        # stop the stack, keeping the data
make psql        # psql inside this copy's database
make db-reset    # drop this copy's volume and start clean (DESTRUCTIVE)
make seed        # the common names into the catalogue; YES=1 writes, without it a dry run
make gates FROM=2026-10-05  # read gates 0.2 and 0.3; TO= optional, a day taken in whole
make dev         # run api, pwa and bot
make e2e         # end-to-end tests in a phone-sized browser
make icons       # regenerate the app icons from favicon.svg
make certs       # locally trusted dev certificate, for the camera on a real phone
make prod-build  # build the production images without deploying them
make check       # format -> lint -> typecheck -> test, in order
make ports       # this copy's index and ports
```

Ports, database name and compose project all come from `.env`, so `make` behaves
differently in every working copy by design.

### Gates that run without being asked

- **Hooks** (`.githooks`, wired by `make setup`, no husky). `pre-commit` refuses a commit
  whose formatting or lint is dirty; `pre-push` refuses a push whose types or tests —
  end-to-end included — are not green. The slow checks sit at push because that is when
  the work leaves the machine. A deliberate bypass is `--no-verify`; needing it twice in a
  row means the rule is wrong and should be changed, not dodged.
- **CI** (`.github/workflows/ci.yml`) repeats all of it on push and pull request, in two
  jobs: checks and e2e. CI **checks** formatting rather than fixing it — `make format`
  mutates files, and a diff must fail rather than be silently repaired. It generates its
  `.env` with the same `bin/init-env.sh` every working copy uses, so CI cannot drift from
  local setup.

## Architecture

npm workspaces monorepo. A pure core with thin adapters — no DI container and no ports
layer: the core is tested directly.

```
backend/        Fastify
  src/routes/     HTTP: parse -> call the use case -> respond. Zero business logic
  src/parse.ts    the seam a request is parsed through — shared by routes and use cases
  src/usecases/   scenarios: orchestrate domain and repositories
  src/db/         Drizzle schema, migrations, repositories — the only place with SQL
  tests/          integration tests and their fixtures — they need a database
frontend/       Vue 3 + Vite: views, composables, styles/_tokens.scss, i18n
bot/            grammY, a client of the API
packages/
  model/        domain: types, Zod schemas, pure rules. Dependencies: zod only
    src/support/    errors, fixed-point decimals, text and patch helpers
    src/values/     money, units, exchange rates, geography
    src/entities/   actor, item, place, trip, expense, verdict
    src/contracts/  what crosses the wire whole: health, errors, events
    tests/          mirrors src, so src holds only what ships
  client/       typed API client built on the model schemas
services/                 anything that is not a TypeScript workspace
  receipt-ocr/  Python, 1.0, not started
```

`services/` is separate from `apps/` on purpose: a different runtime is a different
boundary, and it should be visible in the tree rather than only in the docs.

Packages export their TypeScript source (`"exports": "./src/index.ts"`), so there is no
build step between a change in the domain and the app that uses it.

**Before searching the repository, open the code map** (MOL-133): `docs/map/<area>.md`, named as
the area's rules file, or `docs/map/README.md` for the skeleton and for which area a thing belongs
to. A file added, moved or removed changes the map in the same commit; `make lint` refuses a map
that lies.

### Three applications that happen to share a repository

`frontend`, `backend` and `bot` are treated as separate applications — as if they were
three repositories that live together only because it is convenient — and each must stay
deployable on its own. Each owns its `package.json`, `tsconfig.json`, `eslint.config.js`,
`vitest.config.ts` and `Dockerfile`, and each lints, type-checks and tests standalone:

```bash
npm run lint -w @molvia/backend     # its own config, from its own directory
npm run test -w @molvia/frontend
```

`@/` is configured per module, so it can point somewhere different in each. In the three
applications it points at that module's `src/`, because that is where importable code
lives — not because a shared rule decided it. The packages under `packages/` have no `@/`
at all: they ship their source, so they use `#<name>/…` instead, for the reason below.

**The root only gathers the modules** — shared presets and a list of the modules' configs; what
deliberately stays at the root (Prettier, `.editorconfig`, `.gitignore`, the development `.env`,
the `Makefile`, `playwright.config.ts`) and why is in `.claude/rules/workspace.md`.

**Imports are either an alias or a sibling** — checked by the linter:

- `@/…` to reach anything outside the current directory,
- `./thing` only for a file in the same directory,
- never `../…`, and never `./sub/thing`.

A path that climbs out of its own folder hides where a thing lives and breaks the moment
a file moves. `./sub/thing` hides it half as much and breaks just as readily.

**A package that ships TypeScript source uses `#<name>/…`, not `@/…`.** `@` is configured
per module, so inside `packages/model` it would resolve against whichever module is doing
the compiling — `backend/src`, `frontend/src` — and the import would silently point at
someone else's file. Node's package subpath imports are resolved by the package that
declares them, whoever is building, and `tsc`, `vue-tsc`, Vite and esbuild all honour
them. `packages/model/package.json` declares `"imports": { "#model/*": "./src/*.ts" }`;
the same shape applies to any other package under `packages/`.

**Boundary rules — enforced by the linter, not by eye:**

- `packages/model` imports nothing but `zod`. Not fastify, not drizzle, not vue,
  not `node:*`. If a rule needs I/O, it is not a domain rule.
- `usecases` know nothing about HTTP: no `request`, no `reply`, no status codes inside, and
  no import from `routes` — a body whose schema is known only after a read is parsed
  through `@/parse`, the same seam the routes use (MOL-27).
- `routes` contain no business logic and never reach the database except via repositories.
- SQL lives only in `src/db`. Not a single line of SQL in routes or use cases.

**The API is the only write path.** The bot and the PWA are its clients and have no direct
database access. In a product about data integrity, two write paths will silently diverge.

## Money and quantity rules

- **Never `float`.** An amount is an integer in minor units: `amount_minor bigint` +
  `currency char(3)`.
- **The minor-unit exponent is a property of the currency, never a constant.** Today all
  four supported currencies happen to use 1/100 — drams included: an Armenian receipt
  prints hundredths (`5 403,12 ֏`), even though a shop usually rounds them away at the
  till, by ordinary half-up. That coincidence is not a licence to hardcode `100n`: a
  constant is what breaks first on a currency with three digits or none, and it hides
  where the fact actually belongs. Checked with the owner on 2026-09-08 — the earlier
  wording "1/100 for every currency" was right about today's value and wrong about where
  it lives.
- **A unit price is not money and keeps its own scale.** It is a computed ratio, so it may
  carry more precision than any amount in that currency does.
- **The rate is stored with the transaction** and never recomputed retroactively.
  Otherwise last month's total changes with today's rate.
- **Compare by unit price only** (per kg / l / piece). Unit price is computed, never
  entered. 520 ֏ for 0.9 l is more expensive than 570 ֏ for a litre, and the user must
  not have to work that out in their head.
- Rounding happens on output only — never in storage or in intermediate results. **One written
  exception: the links of the wallet's chain** are brought to eighteen digits (MOL-42, Ж1, owner's
  decision 25.09.2026). Kept exact, the fraction grew by some ten digits an exchange and 800 of
  them held the event loop — the whole API — for seconds. The error stays some twelve orders below
  the sixth digit a rate is printed with — which can still turn on an exact half, where any error
  decides the rounding: a chain may then print one unit of the sixth digit below the same price
  made in one pair (round 2, Л3). A named price, not a hidden one.
- **A rate is printed on the side whose number is at least one** (`formatRate`, MOL-81) — the
  whole rule and its prices are in `.claude/rules/money-rates.md`.

## Data rules

- **What an address of a resource may look like is one rule, in `packages/model/src/support/resource.ts`
  (MOL-25, Р-3).** An identifier in a path is taken in either case and answered in lower case:
  Postgres compares uuids without case and answers in lower case, so a path spelled `AB12…` would
  reach a row whose id comes back `ab12…` and the device would not recognise its own row in the
  reply. A malformed one is **404, not 400** — malformed, missing and someone else's are one
  answer, or an identifier could be guessed by the difference. Bodies that _create_ a row are the
  other way round and stay strict (`deviceIdSchema`), so the answer and the draft on the phone
  agree on one spelling. The rule lived in three places and two of them had already drifted over
  the case; tests on both sides hold the callers to it, as they do for `INVISIBLE`.
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
  contributions — three of them, and a contribution is a person, not a row
  (`AGGREGATE_MIN_CONTRIBUTIONS`). Otherwise someone's basket can be derived from the
  "average price". **An open place discloses exact prices, not blurred ones:** once three
  buyers open it, the minimum is one person's actual receipt and the median of three is a
  second — and the median's is in no list of places. Both are accepted: the number of three is
  argued from the arithmetic of an _average_, and neither of these averages anything. Closing
  it means giving up the threshold, since a middle built from what is already shown almost
  never has three places behind it. **The threshold closes the still picture, not the moving
  one:** a row that
  read «4.3 · 3 оценки» yesterday and «4.5 · 4 оценки» today hands the fourth person's score
  to whoever looked twice, and the same holds for prices. Closing that needs noise or delayed
  publication, neither of which 0.1 has — a known limit, not an oversight.
- Country and city are part of the key from the start, not "we'll add it later".

## Frontend and styling rules

- **The target device is a phone in one hand, at the shelf, in bad light.**
  Everything is designed from there; desktop is derived.
- **Tokens live in one file** (`styles/_tokens.scss`). Components use variables only:
  not a single hardcoded hex, not a single magic spacing off the scale. Stylelint enforces
  both — a literal colour or an off-scale padding fails `make lint`.
- **Everything is SCSS.** There is no plain CSS in the project.
- Touch target >= 44px. The primary action is reachable with a thumb.
- **Every SFC is one file in one fixed order:** `<template>`, then `<script lang="ts">`
  exporting a `defineComponent`, then `<style scoped lang="scss">`. The linter keeps the
  order, both languages and the `scoped` attribute; none of it is left to memory.
  Stateful logic goes into composables, not into components.
- **Not a single string of text in the markup — everything through i18n keys, from day one.**
  The plan assumes expanding to other languages without rebranding; hardcoded strings are
  the cheapest mistake today and the most expensive one a year from now.
- **No business logic on the frontend.** The verdict, the unit price and the conversion are
  computed by the server. Client-side validation is for UX only; the backend is the source
  of truth. **One exception, and it is not a second implementation (MOL-24):** while a purchase
  is being typed, the sheet shows its unit price and its estimate in the income currency through
  `unitPrice()` and `convertMoney()` of `packages/model` — the very functions the server calls.
  At the shelf with no connection the price per litre is needed now, to decide whether to take
  the thing. Once written, every number on screen is the server's; the phone never adds up a
  total, not even for rows still in the queue.
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

| Layer       | Where                              | What it covers                            | Dependencies                             |
| ----------- | ---------------------------------- | ----------------------------------------- | ---------------------------------------- |
| Unit        | `packages/**/*.test.ts`            | pure rules from `packages/model`          | nothing but the domain                   |
| Use case    | `backend/**/*.test.ts`             | `usecases`                                | fake repositories, no DB                 |
| Component   | `frontend/**/*.test.ts`            | rendering and the four screen states      | happy-dom, `@vue/test-utils`, API mocked |
| Integration | `backend/**/*.integration.test.ts` | schema, search, aggregates, HTTP contract | a real Postgres                          |
| End-to-end  | `e2e/**/*.spec.ts`                 | the whole stack through a browser         | Playwright starts api and pwa itself     |

**End-to-end runs in a phone profile only.** The product is designed for a phone at a
shelf, so a desktop-only pass would prove nothing about the screen that matters. The sheet runs
on an iPhone profile as well (MOL-80): Safari does not focus a tapped button.

- **Catalogue search is tested only against a real Postgres.** `pg_trgm`, `unaccent` and
  `fuzzystrmatch` cannot be faked, and they are exactly what breaks. Integration tests run against a
  **separate database** on the same server (`molvia_<index>_test`), created and migrated
  by the vitest global setup — a test run can never truncate data entered by hand. This is
  why `make check` needs `make up` first, and why CI runs a Postgres service.
- **When a test fails, look for the bug in the code first** — do not adjust the test to
  match the behaviour. A test proves the app works, not the other way round. And **never by
  making it tolerate leftovers**: that hides the cause and leaves the suite depending on the
  machine's history.
- **Maximize corner cases.** Mandatory checklist:
  - NULL / legacy — the field is empty but the entity still falls under the rule
  - alternative write path — the same outcome reached by a different route
  - boundary — exactly N, N-1, N+1
  - "must not fire" — a state where the action is required not to trigger
  - Molvia-specific: transliteration and a typo in search, weight vs pieces, a non-local
    currency, an item without a barcode, a second price for the same «item + place» pair

## Workflow

### Before a task

1. **Requirements, then a plan, then approval, then code — per Jira task.** Before writing
   anything, work out what the task actually requires; write that up, then write the
   implementation plan. **Code starts only after the owner approves the plan.**

   **Both are files, at fixed paths — never a comment on the Jira issue:**

   |                                          |                     |
   | ---------------------------------------- | ------------------- |
   | `.scratch/tasks/requirements/MOL-<n>.md` | requirements        |
   | `.scratch/tasks/plans/MOL-<n>.md`        | implementation plan |

   The paths are fixed; do not move them. A Jira comment cannot be edited alongside the
   work, cannot be diffed, and is unreachable when the tracker is down — and the MCP
   server times out often enough for that to matter. `.scratch` is shared across every
   working copy, so a plan there is visible from all of them and outlives any one copy.

   **Everything else the work produces goes under `.scratch` too**, unless a location was
   named: self-reviews, self-tests, questions for people, status notes, drafts. The layout
   and the rules are in `.scratch/README.md`. Nothing lands in the repository that was not
   asked for there.

2. **We gather requirements ourselves** — there are no specs. The source is the product
   plan in Confluence; if it has no answer, the requirement is stated explicitly in the
   plan and talked through.
3. **Check against the release cut.** Before building a feature, work out which release it
   belongs to and which hypothesis it tests. A feature without a hypothesis is not built.

### After a task

**Definition of Done:** `make check` — `format` -> `lint` -> `typecheck` -> `test`,
all green. Run them once after the entire plan, not after each step: `format` mutates files
and would otherwise hide real lint errors.

If a decision changed along the way — **update the product plan in Confluence immediately.**
A plan that diverges from the code is worthless, and here the plan matters more than the code.

### Commits

- **The agent commits on its own**; no need to ask permission for each one. The split into
  commits is planned in advance and proposed together with the plan; do not pile everything
  into one final commit. "Ready" = the piece is self-contained (migration + schema; the
  screen separately; the tests separately).
- **Push when everything for the task is done**, not after every commit.
- **The only author is the repository owner.** A `Co-Authored-By:` line in any form is
  forbidden — do not add it automatically or as a tool default.
- **Format — Conventional Commits with the Jira key as scope:** `feat(MOL-1): schema for
the catalogue`. The tracker is a separate system, and the key in the subject is the only
  thing linking a commit to the task it belongs to. After the subject, a blank line, then
  an optional bullet list of what was done — points, not prose.
- **Branches:** `MOL-<n>-<short-description>`, e.g. `MOL-6-schema`.

### Estimating (story points)

Tasks are estimated on the **1..21** Fibonacci scale: 1, 2, 3, 5, 8, 13, 21. Anchors:

| SP     | What it is                                 |
| ------ | ------------------------------------------ |
| **1**  | A micro-fix, 1–50 lines                    |
| **5**  | A small task                               |
| **21** | A hard, unclear task spanning several days |

For calibration: an integration task — client, adapter, trigger and tests — is 8; a large
use case with thresholds and a workflow is 13. The agent estimates when filing the task and
proposes the number together with the plan.

The Jira field is `customfield_10016` ("Story point estimate"). The MCP server does not
write it — set it over REST.

### Ask before, not after

Migrations that lose data, swapping a stack element, CI changes, refactoring outside the task.

## State

The chronicle of what each task built is in `docs/onboarding.md`, «Хроника задач».

What exists, what is decided and what is still open — `docs/onboarding.md`.

**What the database guarantees and what it leaves to the domain** is a line, not a habit:
the schema refuses what makes a row unreadable or breaks the product's core — a currency
beside every amount, a quantity with its unit, a whole rate snapshot or none, one verdict
per «actor + item + place», references that lead somewhere. Everything else — plausibility
bands, «no more than twenty barcodes», visible text, `search_key = toSearchKey(name)` —
stays in `packages/model`, because a second place that decides is a second place to drift.

`docker-compose.yml` runs Postgres only; the applications run natively in development,
because HMR and a debugger attached to a host process beat a rebuild inside a container.
The production stack is a separate file. Extensions are deliberately not created by an init
script: the schema belongs to migrations, and a second source of truth for it would drift.

## Deployment

One VPS, one compose file, Caddy holding the certificate — see `deploy/README.md` and
`.claude/rules/deploy.md`.

## Camera on a real phone

`getUserMedia` only runs in a secure context, and over the LAN a self-signed certificate
is refused exactly like plain http. `make certs` issues one from a locally trusted
authority (mkcert); `PWA_EXPOSE=1 make dev` puts the dev server on the network. Without a
certificate the dev server stays on http, which is right for everything except the camera —
**and, since MOL-53, except signing in**: the session cookie is `Secure`, and over plain http
on the LAN the browser will not keep it. On the loopback nothing changes, because
`http://127.0.0.1` counts as a trustworthy origin.

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

**Isolation between copies rests on `CLONE_INDEX` from `.env`.** Ports are base plus
`CLONE_INDEX*10`; the database and compose project names get a suffix. The main copy is `0`.

|              | Copy 0         | Copy 2         |
| ------------ | -------------- | -------------- |
| API          | 3300           | 3320           |
| PWA          | 5300           | 5320           |
| Postgres     | 5500           | 5520           |
| Database     | `molvia_0`     | `molvia_2`     |
| API in e2e   | 3301           | 3321           |
| PWA in e2e   | 5301           | 5321           |
| e2e database | `molvia_0_e2e` | `molvia_2_e2e` |

- **Each copy gets its own database.** A shared database plus parallel migrations kill each
  other, and silently: the second copy sees a foreign schema and assumes the migration is
  already applied.
- **One development bot token, in the one copy that is testing the login**: two processes on one
  token split Telegram's updates between them at random.

How a copy is linked and filled, what is shared, the port band and the bot token in detail —
`.claude/rules/dev-copies.md`.

## Related

The Google Sheets the project grew out of live in the Drive folder «Жизнь» and are reachable
through the `google-sheets` MCP server (see the memory in the `~/` branch). Accounting in
drams on a ruble salary already works there.
