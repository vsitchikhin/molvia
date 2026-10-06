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
- **The log does not outlive the person, nor their objection** (MOL-58, MOL-96): erasure and
  «Учитывать меня в статистике» turned off are the two written exceptions to append-only.
- **An objection takes a person out of both gates** (MOL-96): `actors.analytics_off_at`; off erases
  their log under its lock and «Что брать» writes nothing more; each gate names them in a line of its
  own, after time and access; back on counts in 0.3 only from before week four (`analytics_on_at`).
- **The 0.2 gate is `VerdictRepository.reachedRatings`** (MOL-49): one of two readers that act on a
  withdrawn verdict, with the reminder (MOL-101) — the copy only shows it, `put` brings it back; its
  `from` is the release of 0.2, passed by the caller; a window still open is left out; a verdict
  counts from when the server received it.
- **Both gates are read by `dist/gates.js`** (MOL-91), `make gates FROM=…` in a copy: `n` beside
  every share, the stop line printed and no verdict; gate 0.3 closes its window as 0.2 does; the
  erased leave one number, by week of arrival, in `erasures`.
- **The scanner's measure is `receipt_days`** (MOL-222): how readings ended, and at «Записать» the lines
  put right — the phone's word (`edited`), since only it knows what its review showed — a total put
  right as the receipt's own edit, the first record only, and the time from the server taking the
  receipt — by day, no id; read as the block «0.2r» of `make gates`, stop above a third of the lines
  after four weeks.
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
| Charts            | `d3-shape` for the geometry, components our own         | 3 KB; every charting library measured brought its own touch and scales (MOL-156)           |
| API               | Fastify + Zod                                           | Zod schemas shared with the frontend and the bot                                           |
| DB                | PostgreSQL + Drizzle                                    | schema in TS, generated migrations, honest drop into raw SQL                               |
| Bot               | grammY + `@grammyjs/runner`                             | distribution, auth, rating reminders; the runner is what makes it serve two people at once |
| Search by meaning | EmbeddingGemma q4 on `onnxruntime-node`, in the API     | a pinned model, no service of its own; 45 ms a query on the VPS (MOL-105)                  |
| Receipt reader    | Tesseract 5 behind Python's own HTTP server             | no model reads a receipt on the server's CPU in time (MOL-114); the parse is TS            |
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
- **The tables and the fold rules are frozen; Georgian and Serbian are in them** (MOL-109): a
  change reaches the stored keys by `rekeyItems` at the API's start, never by SQL; it forgets the
  picks and the shops' memory by text under the keys it changed, and a rollback past it is a rename.
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
  pinned corpus.
- **The meaning is an addition, never a condition** (MOL-105): EmbeddingGemma in the API, one
  writer of `item_embeddings`; without the model the search is the letters'. A name found by meaning
  stands after one edit and before two, near; nothing within one edit moves. Similarity 0.40, from
  four letters — measured, and a vector of another model is never read.
- **The catalogue grows by «Предложить товар» and the seed** (MOL-112): the seed only adds, is
  not a migration, never stays in `_test` or `_e2e`, and holds no brands.
- **Twins are merged by the night, and a false merge is worse than a missed one** (MOL-106): every
  size with its unit (by its spelling, never the search key), one edit a word, two a name, the meaning
  at 0.90 — measured on the seed; two scripts and a brand's extra word never merge, by the code. Places
  by the same rule, one city each, and only as one spelling — as written, not by the key: a shop's
  name is a proper name.
- **A merged item or place stays a trace** (`merged_into`): its name is the survivor's second name,
  every write by an id goes through `liveItemId` / `livePlaceId`, the search answers the survivor once;
  one person's two verdicts stay two rows, so the gate does not move. **Production runs
  `CATALOGUE_MERGE=report` until the owner says `on`** (В-3); `make unmerge ID=` takes a merge back,
  a chain from its end.

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
- **A place's price is its last one, not its lowest** (MOL-166): its last purchase in any currency
  and unit, never the last of a pair; one's own where one bought, by the fragment «Тут дешевле»
  reads (`latestFirst`) — with access, while one bought there within `SHARED_PRICE_FRESH_DAYS` or
  nobody else opened it; a place opened by others — the lower median of each buyer's last within
  the window.
- **«Только если дёшево» is the lower median from three purchases**; per item the «currency +
  unit» of most purchases first, the other pairs' places after it, never compared (MOL-166); order
  by rating down, then name.
- **The limit never cuts one's own rows or the warnings** (Р-23, Р-25:
  `ADVICE_WARNINGS_RESERVED`); the server names no superlative; every row carries `isMine`.
- **A withdrawn verdict is still a row** (MOL-27): the gate counts every row, and so does the
  reminder, which skips a purchase made before the withdrawal (MOL-101) — so the row outlives
  «Учитывать меня в статистике» off (MOL-97, В1); **every other reader filters
  `deleted_at IS NULL`** but the copy, which marks it, and `put`, which brings it back.
- **A place is named with its city only where its name stands in two cities of one set** (MOL-120):
  the queue of «Оценки», a row of «Что брать», one reminder — one rule, `cityWhereNameRepeats` in
  the domain; the city is optional on the wire, and a place without one leaves its set named as
  before.
- **The search on «Что брать» is answered by the server** (`GET /advice/search`, MOL-128): the
  list's own statement and rules for what is found, never glued on the phone; it writes no visit and
  no pick; offline — the remembered list by the start of words.
- **«Тут дешевле» is one's own history only** (`GET /advice/prices`, MOL-92): a place's last price,
  the record's city, «не брать нигде» with no price; another item of the kind (`kindKey`) when
  cheaper and rated no worse; it writes nothing; offline — the answer remembered, let go by a verdict.

### Money: rates, exchanges, incomes — `.claude/rules/money-rates.md`

- **Starting a record never goes to the network** (the old «Начать поход»): a trip snapshots the official rate from the cache,
  which the API refreshes hourly; the cache holds one currency against the provider's base per day —
  the dram, the dinar for the National Bank of Serbia (`official_rates.base`, MOL-230).
- **The CBA first, then the Bank of Russia, then open.er-api.com**; a pair's bank is the first that
  publishes both its currencies — the lari's the National Bank of Georgia's, the dinar's against the
  rouble, the dollar and the euro the National Bank of Serbia's, against the dram Georgia's — and
  `official` is that bank (`homeBankOf`, MOL-110, MOL-230); a silent country bank asks the open
  sources as the CBA's silence does; a pair is never built from two providers; a jump is flagged, not refused; an answer that is not strict is not written; an empty
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
- **The market is only what an exchange is set beside, never a rate anything counts by** (MOL-137):
  the best of the central bank's figures of its day for the person, and their own channel if named;
  the side is the bank's (`marketSideOf`), a pair without the dram has none; a file is written whole
  or refused. **«Обмены против рынка» sums each exchange as its card measures it** (MOL-152): its own
  channel, else the best; no market — «Без сравнения», never the central bank instead. **The
  official cache holds the bank's history since 2022**, only missing days written.
- **«Курс рубля за 12 месяцев» is the line of all bank clients, the one row with a year of history,
  named so** (MOL-161); a point's percent and its mark are its card's own market, never the line
  (В-1), and the line is on the side of the pair's latest exchange (В-2). **The month, half a year
  and the year come in one answer** (MOL-168): each from the day after the same day N months back,
  whole months on a month's last day — the year is the window of «Обмены против рынка» — the month
  by days, a weekend at Friday's figure; the pairs are the year's, and the period is the screen's
  address.

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
- **A day is printed as a calendar day** (`calendarDay`), and **«сегодня» is the phone's**
  (`localDay`, MOL-121), on the server too: every request names it (`TODAY_HEADER`) and its zone
  (`ZONE_HEADER`), and every «today» of money and every day of a moment the server stamped is
  counted by them; a write is «in the future» only past `latestDay`; a trip keeps
  the phone's day of its taps. The frontend's tests run in UTC.
- **«Деньги» is the month's summary, «Траты» its journal** (MOL-159): six ways out with one figure
  each, every figure from an answer the screen already has — the counts are the server's (`count`,
  `incomeCount`); the tiles are figures, not buttons; a spending of another month moves «Траты»,
  never the summary.
- **A bar of «Графики» is the month of «Деньги»** (MOL-74): `countMonth` with `monthRate`, never a
  second count; its third figure is «Разница», since «Остаток» is the money on the accounts.
  **The usual month is the mean of up to twelve closed months before, from three** (MOL-158): the
  running month against it to the same day, and reading it freezes no month but the one shown.
  **«Год» is the calendar year, the sum of its months** (MOL-160): its dashed line is that same
  usual month, ending with the year's last closed one, and a month before the data or to come is a
  label with no bar.
- **«Бюджет» is the month of «Деньги» against plans** (MOL-117): a plan holds from its month on and a
  write replaces the later ones of its category; a sum in the spending currency or a whole percent
  of «Пришло» by the month's rate; what was spent is `byCategory`, never a second count; over the
  plan is a warning, never red; written with a connection only.

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
  ones that hold is set aside, never retried. A receipt — its parts, removal, «Записать» — goes
  through a queue of its own by the same rules (`receiptQueue`, MOL-127).
- **A removed trip is marked** (MOL-76): «Вернуть» for ten minutes, **every reader filters the
  mark** except erasure, the timer and an account's «удалить или убрать».
- **A trip names its own geography** (`context`, MOL-65): a start without one is
  `error.trip_context_required`, held by the queue without a timer; the settings are settled
  choice by choice inside the `UPDATE`.
- **«Покупки» is empty, and «Что брать» greets a newcomer, only for an answer known to be empty**
  (`answeredEmpty`, MOL-77; the memory of `useAdvice`, MOL-128); a phone-side cache is read by both
  versions. **The record typed by hand goes up to «Покупки» once none is open**, never under a sheet.
- **A trip's money is one rule** (MOL-78): the receipt's sum whole when typed, else the prices —
  `tripMoney` in the domain, `tripMoneyRows` in SQL, for every reader; **a price is never worked out
  of the sum**, and a change of the sum takes «списано» off.

### Barcodes: the scanner, the item by its code — `.claude/rules/barcodes.md`

- **EAN-13, EAN-8, UPC-A, UPC-E and nothing else**; UPC comes out as thirteen digits, and a code
  typed by hand is brought to that same form by `typedBarcode` — one package, one code (MOL-98).
- **A code is taken after two frames in a row read it**; decoding is in a worker, one frame at a
  time, only what lies under the frame on the screen.
- **The wasm comes from the app's own origin and is precached** — never the library's default CDN.
- **No camera track outlives the scanner**, the reader's error included; every refusal offers the
  digits typed by hand. **A reader is thrown away only when it is the one that failed.**
- **A code is looked up in the query, never the path** (`GET /catalogue/barcode?code=`, MOL-99): the
  API logs paths. It is looked up with its twins (`barcodeTwins`), the code as read first; the item
  found goes to the purchase sheet with no query — a code teaches the search nothing.
- **A code the catalogue missed is asked of Open Food Facts by the server, never the phone**
  (MOL-162): only a code `writtenBarcode` takes, a shop's label never; a hint, never an error; at most
  twelve a minute and four a person, kept a month found and a week missed; under the button and only
  at the sheet's opening — nothing moves under the thumb; an item proposed with it is marked `origin`
  (ODbL).
- **Anyone writes a code to any item, and anyone lets it go** (MOL-100): it must check
  (`writtenBarcode`); one package is one item with its twins, under a lock per form after the item's;
  a code another item holds writes nothing and answers `409` with the holder; `added_by` is erased
  and copied like an item's author; a pick while a code waits asks «привязать?» before the sheet.
  **A shop's own code is never written** (`inStoreBarcode`, В-4), and a name already there takes no
  code silently — it is asked about (В-5). Eight digits typed that check as EAN-8 are EAN-8 (В-7).

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

- **Erasure is one function**, `ErasureRepository.erase`, behind two doors — `/delete` in the bot
  and «Удалить мои данные» in the settings (`DELETE /actors/me`, MOL-94) — in one transaction; catalogue items stay
  with `created_by` nulled, every place stays, and one is added to `erasures` — a count by week of
  arrival, no id (MOL-91). **A new table that points at `actors` must join
  erasure** — a test holds `ACTOR_REFERENCES` to every foreign key — **and the record of processing**
  (Confluence 12091393, MOL-97) in the same PR, as must a new recipient; nothing holds that one.
- **The copy is what erasure takes** (`GET /actors/me/export`, MOL-93): a section per erased table,
  counted against a dry run, **and every column exported or left out with its reason**
  (`EXPORT_COLUMNS`); stored, never counted; the removed marked; no secret.
- **Locks are taken in one order everywhere**: the account, then the request rows, then the owner.
- **The terms and the privacy page are accepted an edition at a time** (MOL-95): `POLICY_VERSION`
  is raised by hand only for a change that matters, any other edit is a new revision `policy.test.ts`
  holds; the edition and its moment on the owner, only ever raised; which edition to ask about is the
  build's, and the API refuses nothing without it — the step is the door's, after the claim, never
  closing over an app already shown, and the queues of one who accepted none wait on the phone.
- **No third-party trackers or analytics**; any third-party script that sees data is a decision.
  onnxruntime's telemetry is off (`ORT_DISABLE_TELEMETRY`, MOL-105).
- **Logs live fourteen days and carry no address and no query**; a failure is logged by its kind
  through `describeFailure`, never by its message.

### Feedback: «Написать разработчику» — `.claude/rules/feedback.md`

- **A message to the developer is never a review** (MOL-141): it feeds nothing, and the word «отзыв»
  is not used for it; **the kind is the person's**, the schema has no default (MOL-146).
- **Only what is named goes with the text, and the sheet shows it before sending** (MOL-150, Р-5, Р-7):
  the page's build, the route's name, the platform as `feedbackPlatformSchema` checks it, the language,
  an error's code; the API stamps its own build.
- **A repeat is the same message by `clientKey`, and the phone takes a new key when the content
  changes** (MOL-147, Р-2): the same key with another content is a `409`; at most ten a rolling day,
  under the author's lock, `429`.
- **A thread lives a year from its last message, the owner's reply included** (В-4), and goes with the
  person. **The database holds the thread** (MOL-148): a continuation names its first message, of the
  same person, and answers a reply to that person — never another's.
- **The bot passes, the API decides** (MOL-148): a text written as a reply to the bot goes with
  `ctx.from.id`, the message answered and the tag `#fb42` of its first line — the only place the tag
  is read; only `OWNER_TELEGRAM_ID` makes it a reply, and a person's word finds its thread by the
  message the reply went out as. Delivered is 👌 — ✅ is not a reaction Telegram takes.
- **A screenshot only by the person's own act, from the gallery — or a receipt's photo from this phone
  (MOL-222) — seen before sending** (MOL-167): the
  phone draws it anew and the API keeps nothing but the picture whatever the phone did — every segment
  walked, metadata cut wherever it stands, nothing after the end; the picture lives only until the
  owner's Telegram has it, a week at most, never in the nightly copy or the person's copy — its line
  stays, «sent» only if it reached the owner. Words, a picture, or both.
- **One sheet, two ways in** (MOL-147): «О приложении» in the settings and «Сообщить о проблеме» drawn
  by `ScreenState` — only a full-screen error, somebody known, not in a `<dialog>`; the draft is the
  device's with no queue, and what goes with the text is read from the body it sends.

### Failures and the owner's channel — `.claude/rules/observability.md`

- **A failure belongs to nobody** (MOL-143): `failures` holds the fingerprint — source, kind, code,
  top frame without its position, the route's template — and nothing of a person, so no key to
  `actors`, no erasure, no copy; a new column is a decision about privacy.
- **A failure is an answer of 500 or more, a job of the API's timers, a defect of the bot, the phone's
  own (MOL-144), or an owner's notice the contract no longer reads** (MOL-148, placed as the claim's
  route); one path writes the log and the table (`failureReporter`), and the answer never waits for
  the table.
- **The owner hears of a fingerprint the first time in a build and at 10, 100, 1000 there** —
  no daily summary; through `owner_notices`, claimed by the bot every minute, at most once, written
  to `OWNER_TELEGRAM_ID` of the API's environment — empty in every copy. MOL-148 joins as a kind,
  **handed again until the bot says it went**: a message's notice is all there is of it.
- **The API runs without `--enable-source-maps`** (В-6, +70…80 MB measured): `make failures` reads
  the API's frames back through the image's map.
- **The phone's own failures come by `POST /client-errors`** (MOL-144): no session, the kind and
  frames in one shape for every engine and never the message (`describePhoneFailure`); a screen's
  «error» calls `reportFailure`, which sends only the phone's defects — never an API's word or the
  weather; once a page, kept on the device until the API answers; the build is the name of the page's
  script, and in the fingerprint. The owner hears of the phone three times an hour a sender and twenty
  in all, after the API's, the rest told as a count once an hour; at most sixty new rows of it an hour
  a sender and a thousand in all.
- **The metrics' labels are a route's template, never a path** (MOL-145): `/metrics` on its own port
  (`METRICS_PORT`), never the API's, which is all Caddy reaches; what sees the machine or the database
  is on `metrics`, a network with no way out, and Grafana calls nobody home. **The dashboard and every
  threshold are JSON in `deploy/grafana`**, baked into its image; a test holds the thresholds and that
  every figure read is written. A restart is a reset of the same container's CPU counter, never
  `changes()`; a request whose client left is `aborted`, never lost. **The alarms read a person's
  requests** — never `unmatched`, `/health`, `/internal/*` — go by their own bot, never the product's,
  and have a pulse to healthchecks.io, since Grafana is the one that sends.

### The bot — `.claude/rules/bot.md`

- **Whose data goes is `ctx.from.id`, never anything in the button.**
- **Every message is an i18n key**; the bot keeps no state of its own and repeats none of the API's
  rules.
- **Updates of different people at once, of one person in order** (`@grammyjs/runner` with
  `sequentialize`).
- **An outcome is written into the message; a refusal is only shown over it, and written nowhere.**
- **The rating reminder: the API decides and marks the step as it hands it out, the bot only
  sends** (MOL-101) — at most once; 19:00 of the person's day, then 3 and 7 days, then six months
  of silence, and any own verdict starts over; a press is the verdict of `ctx.from.id` and keeps
  the scale.
- **The reminders' switch is `actors.reminders_off`, and it says why** (MOL-103): `chosen` or
  `blocked`; a block never overwrites «chosen», an unblock turns on only what blocking turned off,
  **the settings never lift a block** (В-5), and «on» starts the ladder over unless it reminded
  today. Whoever writes to the bot has not blocked it. In the app it is its own address, never the
  settings form.
- **«Чек разобран» goes only to whoever the phone, its page in view (`?shown=1`), did not hand the
  receipt read within 30 s** (MOL-129, `receipts.heard`): the API marks and hands it out in one
  statement, at most once, within 6 h; no sum, no line; the receipt's language; its own switch on the
  page «Бот» (`/settings/bot`), never the rating reminders'; **a block is `actors.bot_blocked_at`**,
  which «chosen» in `reminders_off` cannot hide.
- **Telegram updates are never logged whole.**

### Frontend — `.claude/rules/frontend.md`

- **Two self-hosted faces, Nunito and Onest; the dram sign from a face of its own.** Nunito is one
  weight, 800, set only through `@include display-type` (MOL-171, Ф-7).
- **`frontend/DESIGN.md` is the style, and the linter holds it** (MOL-171): a weight, a size, a
  radius, a colour function or a custom property no file defines fails Stylelint; the token block
  of DESIGN.md is `make format`'s to write and `make lint`'s to check.
- **An icon's size is a step of `--icon-*` by its role** (MOL-173): `@include icon` with the step as
  `font-size`; the row's chevron is 20 everywhere. `molvia/icon-size` holds that every icon is on the
  scale — sized by the pair from a rule that reaches it in the template without a condition, its
  class its own, `--icon*` declared in `_tokens.scss` alone, no width, padding, border or scale on it,
  in the template too; which step is the role's is DESIGN.md's and review's — the role is the place's.
- **Colours that can meet are held apart by `tokens.test.ts`** (MOL-172): two steps of different roles
  and a category against a role 0.08 OKLab apart, marks 3:1, text 4.5:1, both schemes; a value that
  fails is changed, never excused. Data without a colour of its own is `--graphic`. **Any two
  categories 0.07 apart, one hue in both schemes** (MOL-218): a ring puts any two side by side.
- **Not now is one look: `text-muted` at 600, in focus (`inactive` = `aria-disabled`), never opacity**
  (MOL-174); a button keeps its variant's fill or none (В-1). **Chosen is a fill or a form, never a
  weight** — except the current tab, whose 700 comes with its filled icon (MOL-179).
  `--opacity-stale` is only a previous answer while the next is on its way. **At work is a word,
  never not now** (MOL-225): `busy` with its `busy-label` («Удаляем…») in the action's look,
  `disabled` or not, as wide as the wider word; no spinner, and the linter refuses `busy` without it.
- **A row is `ListRow` or `NavRow`, a caps caption `SectionCaption` — caps nowhere else, the linter
  holds it** (MOL-175): the chevron is «opens something to go on with» — a screen or a sheet with
  fields (В-14) — never on a row that acts or asks to confirm, never mixed in one card; a caption's
  place is in `:where()`, the screen's class sets the space above it. **An operation is
  `OperationRow`** (MOL-176): its words come from `journalRowProps` and `operationRowProps`, never
  from the row; the chevron on every one, the amounts in one column, never coloured, never cut — a row
  narrower than 22rem stands its amount under the words. **A search is `SearchField`** (MOL-177): a
  combobox gives it its role and keys, its rows are `ListRow as="li"` with no hover; a second search
  field fails ESLint.
- **Every screen has four states — loading, empty, error, offline — drawn by `ScreenSkeleton` and
  `ScreenState` only** (MOL-19): offline is never red, and offline or error is decided after the
  failure; polite states speak through the one live region in `App.vue`. **The skeleton is the
  answer's shape** (MOL-178): the kit's `SkeletonPart`s in its slot, roots named `skeleton-*` and never a
  class of a screen (a test holds it), bars only `skeleton-bar` — breathing by their own opacity from
  `--skeleton-rest`, never the frame's; the bar is review's, not a linter's.
- **The scheme is the device's** (MOL-111): `molvia.scheme`, set before the first paint by the script
  in `index.html` — the one reader of storage outside `storage.ts`; the person's choice wins both ways
  by selectors, and the status bar follows by `media`, the manifest never.
- **The floor of the browsers is `build.target`, written out in `vite.config.ts`** (MOL-231): the
  script after `#app` in `index.html` checks markers of exactly that floor (`browserFloor.test.ts`),
  and below it draws the locales' line, and the app neither starts nor reports. An API above the floor
  raises the floor, never a workaround; no legacy plugin, no polyfills.
- **Native HTML first, then Reka UI, never a styled kit**; the catalogue combobox is our own.
  Interface icons come from MDI through `unplugin-icons`.
- **An installed app takes a new version only when hidden and holding no typing** (`pwaUpdate.ts`),
  **or by «Обновить»** (MOL-132): never reloaded without the tap; the strip is the top row over the
  tab bar, and an error while a version waits offers it first.
- **The bars are opaque `--surface`; the docked strip's margins and column are `AppScreen`'s, and
  «Вернуть» is its `#undo`, 8 over the strip** (MOL-179): never in `#docked`, never a wrapper's
  padding in a screen; a sheet's «Вернуть» stays in its footer.
- **Every screen sits in `AppScreen`, and every move goes through the router** (MOL-17); no gesture
  is intercepted but the sheet's own pull down (MOL-80); only the page scrolls, except a sheet.
  **«Что брать» is home** (MOL-128): the `tabMove` of «back»; old addresses of «Поход» redirect for
  good. **A change of a screen's own query is not another screen** (MOL-136): no scroll, no
  animation, no arrival, and the page is held as tall as the window (MOL-138); **nothing of the
  answer stands above the control that chooses it** — a strip, a refusal, a note go under it.
- **A screen is built from the kit** (MOL-18); the sheet is a native `<dialog>` with an entry in the
  history, and puts the page back — and focus, wherever the platform gave it — by what it was
  opened from (MOL-63, MOL-80). **Its press is heard on the document**: iOS hands a tap on the
  scrim only to a listener there (MOL-80). **Over the keyboard its height is a share of the visual
  viewport**, never of the window, and it scrolls itself to the field being typed in (MOL-135);
  **the lift is the pinned box less the visible height**, never `100dvh` or `innerHeight`, and
  **before the keys come it takes the height they left last time** (MOL-151).
- **Nothing comes or goes in one frame** (MOL-151): `appear` fades in what is put in the page,
  `AppReveal` grows and shrinks what pushes its neighbours; never while a screen moves, never under
  «reduce motion», never for an answer read (more than three rows at once), and never the sheet's
  own height or a change of a screen's own query beyond its answer.

### Receipts — `.claude/rules/receipts.md`

- **No model reads a receipt** (MOL-114): Tesseract in `services/receipt-reader`, a container with no
  database and no disk; the API holds the queue, the photos and the parse, one receipt at a time.
- **The parse is MOL-114's prototype, measured on the bench** (`receipt-text.ts`, `score.mjs`): a rule
  changed is run on the bench's truth before and after; amounts in hundredths, never floats.
- **Every receipt with a line in it is read** (MOL-222, В-1): «переснимите» only when not one line was
  found, and it asserts no cause it does not know — faint print named among those it may be (MOL-227,
  В-2); read in part (`readPartly`, the model's) is a hint on the review, never a refusal — the person's
  corrections are the measure of 0.2.
- **A receipt with no items is its sum** (MOL-227): a section «Բաժին» and no item's mark anywhere — a
  phone in the head is none — only where no reading found a line (`departmentReceipt`); a `parsed`
  receipt with no lines (`withoutItems`), its head the terminal's — the tax number after «ՀՎՀՀ» first,
  never the receipt's own «ԿՀ» — its total two sources of three, none where two receipts show (a head
  under a fiscal number among them); neither «Записать» nor «Убрать сумму» makes a finished trip empty.
- **The reader away leaves a receipt queued; a photo it drops goes to the end with its attempt
  counted; a photo it cannot read fails** — never lost, never read forever; people read in turn.
- **The class code is a boundary, not a layout** (MOL-226): «Դաս. 56.10» opens an item on any fiscal till,
  read beside the two layouts and chosen only where it finds more; a dish found among the catalogue's
  goods is «проверьте», and until 0.3 a café's receipt is recorded as a shop's, with products (В-2 «а»).
- **Every search of the parse has a ceiling, measured in time** — a line's, a reading's, the
  total's (`*_COMBINATIONS_*`, `RECONCILE_*`): it runs in the API's process; half a second at worst.
- **A photo lives until the receipt is recorded, a receipt not recorded 28 days, a cut-out item line
  28 days after recording, of a line recorded as read only** (В-3, В-4); **photos never enter the
  nightly copy** (В-2), never the log.
- **A line finds its item: the shop's memory by article, by the line, the country's names with the
  heading, the search by the gloss, else new** (MOL-126); names and search once in the queue, the memory
  on every reading. The matcher is MOL-114's `dict-match.mjs`, held to the bench.
- **The shops' memory is shared** (owner, 30.09.2026): the person's own word first, else the item most
  people said, the later on a tie; the erased still count; nobody's word is shown as someone's, and
  another person's shelf price only with access and from three prices, their lower median.
- **A place keeps no tax number**: the place of a seller is where its receipts were recorded, read as
  the memory is; a recorded receipt is not removed while its trip is there — its row dates the trip.
- **On the phone (MOL-127) a receipt is the country's version, never a flag** (Р-1); its photo is
  upright, under 16 Mp, **cut out at «Края чека»** — corners proposed by the bench's winner, moved by the
  person, a square receipt cut as the photo's own pixels and only a tilt warped (MOL-222) — at most
  3 200 px and JPEG without EXIF before it is queued; **its bytes live
  in IndexedDB until the receipt is recorded, removed or gone** — the server gives no photo back —
  a database per owner that «Выйти» takes by its name.
- **The review is the server's reading with the phone's draft over it** (MOL-127): the arithmetic
  is the model's (В-6), «Записать» sends the whole receipt under a trip the phone names through the
  queue, and `router.replace` gives way to the purchases.
- **«Записать» is the whole receipt in one transaction** (`recordReceipt`): a trip finished on the
  receipt's day at its rate, its money the total the phone sends, else the printed one not below the
  lines, else the lines; the owner's lock first; the same trip again is the
  same answer, the same receipt recorded before a 409; a trip from a receipt is dated by its day on the
  accounts too.

### End-to-end — `.claude/rules/e2e.md`

- **End-to-end has a database and ports of its own**, and the database is dropped before every run.
- **End-to-end runs in CI, not on the push** (MOL-164): a pull request merges only on both jobs
  green, and a test green only on a retry is red there.
- **Every spec comes in through `open()` in `e2e/session.ts`.**
- **The sheet, the kit's «not now» and its rows also run on WebKit** (`iphone`, MOL-80, MOL-174, MOL-175); a test it
  cannot run says why.
- **Words said out loud are taken by a locator outside the live region**, never muted with
  `.first()`.

### Deployment — `.claude/rules/deploy.md`

- **`api` and `bot` ship as a single bundled file each** — beside the API's only `onnxruntime-node`
  and the model (MOL-105); every container logs to journald for
  fourteen days; the database is copied every night, encrypted, off the machine.
- **Migrations run when the API starts. A merged migration is never rewritten**; before the merge
  a task's migrations may be folded, and every database that ran the old file is brought into
  line by hand.
- **A merge is a deploy** (MOL-90); a failed deploy puts the previous image back, not the schema,
  **so a migration that drops or renames goes out in two merges**.
- **The Postgres image is an exact tag and part of the contract** (MOL-105): ICU, `vector` and
  glibc; a tag that moves glibc or ICU comes with a migration that rebuilds the text indexes, as
  `0038`. **A migration skipped by its stamp stops the boot** (`assertEveryMigrationApplied`).
- **Production is watched from outside** (MOL-142): a Worker on Cloudflare every five minutes, never
  GitHub's cron, which came hours late (MOL-221; the certificate stays on `watch.yml`, hourly), and
  the bot's pulse — after a claim, while it hears Telegram, never in its first minute — to
  healthchecks.io and its own Telegram, never our bot; **`/health` is `503` whenever it is not
  `ok`**, and the bot is not in it; a check that never got a ping never alarms, so `BOT_PULSE_URL`
  is required.
- **The metrics never judge a rollout** (MOL-145, adversarial А4): pulled before anything changes,
  started only once the application is healthy, a failure of theirs a warning; a rollback leaves them as
  they run. The one port they publish is Grafana's, on the loopback.

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
make reader      # this copy's receipt reader (Tesseract), on the API's band +3
make icons       # regenerate the app icons from favicon.svg
make certs       # locally trusted dev certificate, for the camera on a real phone
make prod-build  # build the production images without deploying them
make check       # format -> lint -> typecheck -> test, on demand; CI runs it anyway
make ports       # this copy's index and ports
```

Ports, database name and compose project all come from `.env`, so `make` behaves
differently in every working copy by design.

### Gates that run without being asked

- **Every check is CI's** (MOL-164, MOL-165): lint, types, every test and end-to-end run there on
  every push, in parallel and with no queue between the copies, and **`master` takes a pull
  request only when both CI jobs are green** — a ruleset, not a habit. A flake green only on a
  retry fails CI (`failOnFlakyTests`). There is no `pre-push`.
- **The one local hook that checks is `pre-commit`, and only the formatting of the files
  committed** (`.githooks`, wired by `make setup`, no husky) — seconds, since CI checks formatting
  rather than fixing it. `commit-msg` holds the subject. A deliberate bypass is `--no-verify`.
- **What runs here by hand takes turns** (MOL-139): `make check`, `make e2e` and the other check
  targets run under one lock for the whole machine, `bin/one-at-a-time.sh`, and a waiting run says
  whose it waits for. **A test run typed by hand takes the same lock**
  (`bin/one-at-a-time.sh <label> npx vitest run …`) unless it is one file of Unit or Use case; the
  lock gives the command no terminal, so vitest does not watch by default, and refuses a vitest told
  to watch and Playwright's `--ui` and `--debug`, which never give it back. Why, in
  `.claude/rules/workspace.md`.
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
  receipt-reader/  Tesseract behind Python's HTTP server, no database (MOL-125)
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
  "average price". **An open place discloses exact prices, not blurred ones:** once three buyers
  open it, its price — the lower median of each buyer's last there (MOL-166) — is one person's
  actual receipt, and the threshold of «только если дёшево», the lower median of every purchase in
  the city, is another — or the same one, where each buyer bought once. Both are accepted: the
  number of three is argued from the arithmetic of an _average_, and neither of these averages
  anything. Closing it means giving up the threshold, since a middle built from what is already
  shown almost never has three places behind it. **The threshold closes the still picture, not the
  moving one:** a row that read «4.3 · 3 оценки» yesterday and «4.5 · 4 оценки» today hands the
  fourth person's score to whoever looked twice, and the same holds for prices. Closing that needs
  noise or delayed publication, neither of which 0.1 has — a known limit, not an oversight.
- Country and city are part of the key from the start, not "we'll add it later".

## Frontend and styling rules

- **The target device is a phone in one hand, at the shelf, in bad light.**
  Everything is designed from there; desktop is derived.
- **Tokens live in one file** (`styles/_tokens.scss`). Components use variables only:
  not a single hardcoded hex, not a single magic spacing off the scale, weight, size or radius.
  Stylelint enforces all of it, and a custom property defined nowhere (MOL-171) — a literal fails
  `make lint`. **The style is described in `frontend/DESIGN.md`**, what Claude Design draws from;
  its token block is generated from `_tokens.scss` (`bin/design-md.mjs`) and never typed.
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
  the thing. **And «Тут дешевле» (MOL-92) compares that price with the person's own past ones
  through `cheaperHint`** — the server sends the prices and cannot know what is typed. **And a
  receipt under review (MOL-127, В-6)**: before it is recorded, «Строки», «≠», the difference with
  the total and «Записать N» are `receiptBalance` and the line rules of `receipt-sum.ts` — the
  functions the server records by — and the edits are a draft on the phone that needs no connection.
  Once written, every number on screen is the server's; the phone never adds up a total, not even for
  rows still in the queue.
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
  by the vitest global setup — a test run can never truncate data entered by hand. Each worker
  runs its files in a copy of it (`…_test_w<n>`, MOL-164), so the files go in parallel. This is
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

**Definition of Done: both CI jobs green on the pull request** (`gh pr checks --watch`, MOL-165).
Every check runs there, so «pushed» is not «done», and a red CI is the task's to fix exactly as a
refused push once was. Locally the work runs what it needs to be written — the test file being
changed, `make check` or `make e2e` when the agent wants an answer before the push — never as a
duty: the machine carries several copies, and CI repeats all of it on every push anyway.

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
- **Never a force push — no exceptions, under no circumstances** (owner's absolute rule, MOL-220):
  no `--force`, no `--force-with-lease`, no `+refspec`, no amend or rebase of anything already
  pushed. A pushed commit is corrected by a new one, a branch is brought up to date by a merge, and
  the push is a plain `git push`. `.claude/hooks/no-force-push.py` refuses the command before it
  runs; it is never worked around. GitHub refuses it too (ruleset «no force push» on every branch).

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

`docker-compose.yml` runs Postgres, and the receipt reader only when asked (`make reader`); the
applications run natively in development, because HMR and a debugger attached to a host process
beat a rebuild inside a container.
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
