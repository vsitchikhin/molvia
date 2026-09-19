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

The `events` table is that groundwork, and it holds only what no domain table can answer:
whether someone came back, and to look at what. The 0.2 threshold is a query over
verdicts, not an event — anything a domain table already knows must never be duplicated
into the log. Nothing updates or deletes from it, the gate queries are its only readers,
and each is pinned by an integration test, boundary days included.

**The first writer is the catalogue search, once a day per owner (MOL-12).** MOL-8 was going
to record `session_started` on the first visit, and the promise was withdrawn when it was
examined: written once, its timestamp is `actors.created_at` and the row duplicates what a
domain table already knows — the very thing the rule above forbids; written on every launch,
it answers a question no threshold asks, since 0.2 is counted over verdicts and 0.3 over
`catalogue_viewed`. MOL-12 writes that one: every search that parses records
`catalogue_viewed` with `subject: product`, after the search has answered, at most once per
owner and payload in each **day of the person's own life** — days counted from their first
event, as the gate counts its weeks, and both in hours rather than calendar days, so a
`timezone` set on the database later cannot pull them apart. Not a rolling 24 hours from the
last row: that window slid over the week line and swallowed a visit early in week four.
Overlapping searches are serialised by an advisory lock per actor, and a failure to record is
not swallowed, because a lost row lowers the gate with nothing to backfill from.

**This measures entering, not reading, and that was chosen knowingly.** In 0.1 and 0.2 a
search is a purchase being entered; the plan hides other people's data until 0.3 precisely so
that «came to write» and «came to read» stay apart. The owner took the event from the search
anyway, with that price in view. So **when the screens of 0.3 show other people's data, who
writes `catalogue_viewed` has to be decided again** — left as it is, the 0.3 gate counts
someone who only logs purchases as someone who came back for other people's ratings.

One consequence of MOL-6 is open and worth knowing before it is met: the log points at
`actors` with a real foreign key, so an actor that has events cannot be deleted. When
«delete my account» arrives, either the log outlives the actor (`actor_id` becomes nullable,
and the gate queries lose the half they measure by) or that deletion becomes the single
written exception to append-only. It is a product decision, not a schema detail.

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

**Nest, Prisma and TypeORM were considered and rejected**, each for a reason that is not
obvious enough to leave unwritten:

- **Nest** is Fastify plus a DI container, decorators and modules. That superstructure
  solves a team problem — imposing one shape on ten people. Here the shape is imposed by
  these rules and by the linter's import boundaries, for free. Worse, it works against the
  core decision: in Nest the business logic lives in `@Injectable()` classes, so the domain
  would import the framework, and "the domain imports nothing but zod" could not hold.
- **TypeORM** makes an entity a decorated class, so a table becomes a framework object;
  its migration generator has a long history of being unreliable, and the query builder
  returns `any` down many paths — typed on paper, untyped where it matters.
- **Prisma** has the best developer experience of the three. It breaks on exactly this
  project: its schema is its own DSL, and everything the DSL lacks is hand-written into
  generated migrations. Nearly all of the plan sits outside it — the `pg_trgm` and
  `unaccent` extensions, GIN indexes, `similarity()` queries, the aggregates behind "what
  to buy". Raw SQL exists through `$queryRaw` but loses its types, and here raw SQL is the
  main instrument rather than an escape hatch.

**Quasar was rejected for the same reason**, with one addition. It bundles a component kit
with a build layer for SPA, PWA, Capacitor and Electron. The second half is useful one day;
the first brings its own theme and Sass variables, which would become a second source of
truth about colour. And the second half is available on its own: if native happens at 1.0,
**Capacitor** wraps the existing web app for the stores without a component kit or a CLI of
its own. Until then `vite-plugin-pwa` already ships the manifest, the service worker and
the precache — a PWA that installs to the home screen and works offline is the mobile
build.

**Postgres does the heavy lifting:** trigram matching and edit distance for search,
GIN index; aggregates (average ratings, minimum price, store index) are plain SQL.
Hence Drizzle: Prisma hides exactly what everything here rests on.

### How catalogue search works, and why

Measured, not assumed — the numbers below come from a probe against a real database.

- **Transliteration happens in `packages/model`, not in Postgres.** `unaccent` strips
  diacritics; it does **not** turn Cyrillic into Latin, so `moloko` scores exactly 0.000
  against `молоко`. Items carry a `search_key`: the whole name normalised to Latin by a
  pure function in the domain — Latin plus one letter, `ц`, for the reason below. Against that column the same query scores 0.500.
  A custom `unaccent` rules file inside Postgres would buy only this half and cost us
  ownership of the database image — CI can pull a service image but cannot build one.
- **The alphabet folds the forks rather than preserving them.** A transliteration fork is
  one letter with two spellings in common use — `ж` is zh or j, `ц` is ts or c, `х` is kh or
  h, `щ` is shch or sch — and the product plan already named them when it picked the name
  Molvia. `search_key` keeps one spelling per fork and folds the other half of each into it,
  on **both** ends: the name on write and the query on read go through the same function.
  Measured over 46 queries: without the fold four miss the distance threshold outright
  (`jem` against `dzhem` is 3, `Grand Candy` against «Гранд Кенди» is 3), with it none do,
  at a cost of 0.26 extra candidates per query. Folding harder than that — collapsing `ч`
  with `ц`, `ш` with `щ` — wins no query and loses the distinction, so it was rejected.
  **The `к`/`c` fork is closed by position (MOL-11).** Latin `c` is two letters: soft before
  `e`, `i` and the diphthong `ae` — that is `ц` (`cena`, `Caesar`) — and `k` everywhere else
  (`Coca-Cola`, `Picnic`); `ch` is `ч` and is left alone. So `ц` is a letter of its own in the
  key: `ц`, `ծ`, `ց`, `ts` and a soft `c` all become `ц`, a hard `c` becomes `k`, and doubling
  collapses before the decision. «Кока-кола» and `Coca-Cola` are one key where they were 2
  apart, and «кока» finds Coca-Cola before «кола» is typed — before, it was not even a
  candidate; memory could not have closed this. **Only Latin `c` is decided by the next
  letter, never `ц`:** the first version hardened every `c`, and a case ending or the next
  keystroke flipped `ц` — «куриц» stopped being the start of «курицы», «огурцов» fell out of
  the budget. The price of the rule is a Russian word typed with `c` for `ц` in a hard
  position: `otec` and `cukaty` cost an edit, `jajca` left the corpus (45 of 46); `ts`
  spellings are untouched. A Latin word cut right after a `c` — «Nutric» on the way to
  «Nutricia» — is not the start of the finished one; narrow, and MOL-14's shelf never met it
  (MOL-47). The fold also fires on what the alphabet itself produced, not only on Latin someone
  typed — `тс` becomes `ts` becomes `ц` — which is what makes «счёт» and «щёт» one key, and also
  what reads the `тс` of «Советский» as `ц`. A false merge costs a candidate, a miss costs the
  answer; the trade is deliberate, and it is a trade. **That is why the key is never an
  identity:** «Предложить товар» decides a duplicate by `nameIdentity` — case, spacing,
  invisible characters and the three Armenian spellings «և» / «եւ» / «եվ» only — because there a
  false merge costs the item itself: «Milo» would be answered with «Мыло» (MOL-12). The identity
  is built from the key's own first steps, and a property test holds that one identity is always
  one key: the lookup is by key.
- **Armenian is in the table, not passed through.** The first market is Gyumri and Yerevan,
  so an Armenian label is the norm on the shelf. With the table «Գյումրի», «Гюмри» and
  `Gyumri` all become `giumri`, and an Armenian name is reachable from all three keyboards;
  worst distance across a corpus of sixteen names in three scripts is 1. Two mechanics are
  easy to get wrong: `ու` and `և` are single letters written with two code points and must
  be resolved before the per-character pass, and the aspirated pairs (`պ`/`փ`, `կ`/`ք`,
  `տ`/`թ`) are collapsed deliberately — the same trade as `ш`/`щ`. A letter no table knows
  keeps itself: dropping it would produce an empty key, and `visibleLine` refuses that, so
  the item would become unbuildable inside the server. **What draws nothing is one list,
  `INVISIBLE` in `text.ts`**, that the name's measure and the key both strip: two copies
  drifted twice — the Hangul fillers in MOL-12, U+13441 in MOL-27, each time a valid name
  whose key its own schema refused, a 500. A test walks every code point to hold them equal.
- **The tables are frozen, and changing one is a migration.** So are the rules that fold and
  decide `c`. The key is stored, so an edit after the first row is written makes every
  accumulated key foreign — silently, with no error and no log line. MOL-11 changed the
  alphabet without one only because no key was stored yet — no production, no real catalogue
  in any copy; MOL-27 widened `INVISIBLE` under the same condition. Same standing as `MINOR_EXPONENT`. Retuning the thresholds is a
  different thing and does not touch the alphabet.
- **Candidates come from `word_similarity`, never `similarity`.** `similarity` compares
  whole strings, so a long name dilutes the match: «малако» scored 0.158 against
  «Молоко «Ашхар»» and ranked «Марианна» above it. `word_similarity` compares against the
  best-matching part: 1.000 on a correct spelling, 0.600 on one swapped vowel — but only
  0.167 on two, which is the corpus case «малако», so the candidate threshold is 0.15 and
  not 0.3 (measured in MOL-10). Two traps sit under the operator. **Only `search_key %> $1`
  reaches the GIN index** — `$1 %> search_key`, `search_key <% $1` and
  `word_similarity($1, search_key) > t` mean the same and all fall back to a Seq Scan, which
  a test's handful of rows cannot show. And **the threshold of `%>` is a setting of the
  connection** (`pg_trgm.word_similarity_threshold`, default 0.6) that `set_limit()` does not
  touch, so it is set locally inside the query's transaction and never leaks across the pool.
- **Ranking is by minimum Levenshtein across the words**, via `fuzzystrmatch`. Two swapped
  vowels in a six-letter word defeat every trigram measure; edit distance puts «малако» at
  2 from `moloko` with the nearest wrong answer at 3. Across words, not the first word:
  «чанах» is a brand, and matching only the head noun missed it. **Word against word**, never
  the whole query against a name's words: that put «Հաց Կաթ» and `Hats Kat` at distance 4
  while their keys are identical character for character — an artefact of the metric, not of
  the transliteration. How the per-word distances then combine across a multi-word query is
  MOL-10's to settle, and three traps are already known. Taking the worst query word loses an
  item to a _correct_ extra word: «молоко ашхар пастеризованное» scores 11 against «Молоко
  Ашхар 3.2%», and the extra word is the one printed on the package. Keeping every word lets
  a query of nothing but digits match every name that carries them. And **dropping words
  shorter than two characters is not the cure** — those words are the packaging size: it
  makes «Молоко 1 л» and «Молоко 2 л» identical for ranking while «Молоко 1л» written
  without the space stays distinct, so two shops' labels for one product rank by different
  rules. MOL-10 took **the third way**, and its review made it hold on both sides. A word
  **grounds** a match only if it has two characters and no digit — «32», «1л», «500г» are
  sizes, not grounds — and it is measured against the grounding words of the name only, never
  against «л» or «1», which every two-letter word is within two edits of. Grounding words fold by their **mean**,
  rounded up; short words by their **worst**, at most one edit, so each has to find its pair
  and «1 л» against «2 л» costs one. A query with no grounding word but with letters — «M&M's» is
  `m m s`, «m&m» is what the screen sends halfway — finds names in which every one of its words
  is found exactly; digits alone find nothing. The screen searches while the
  person types, so **the last word also matches the start of a name word** — exactly up to
  three letters, one edit from four, two from seven; any slack on two letters matches every
  word there is. The price is that a finished word matches longer ones too: «сыр» finds
  «Сырок», «чай» finds «Чайник» — below the exact match, never above it. Measured on the MOL-10 corpus: the right item first in 20 of 20, junk queries
  find nothing. The correct extra word is still lost (4 against a budget of 2) — chosen
  knowingly, and pinned by a test. The distance is exact `levenshtein` on words cut to 255
  characters: past that it raises an error, and `levenshtein_less_equal` is no substitute,
  because its capped answer distorts the mean. Limits MOL-14 measured and left in place: the
  budget is absolute (MOL-46), so a short wrong word passes where a long right one does not —
  «молоко ашхар кефир» finds the milk, and «кока кола 0,5 л» even finds «Вода Джермук 0.5 л»,
  every word wrong by two; the two thresholds disagree — «ыср» is two edits from «сыр» yet
  shares no trigram with it, so it never becomes a candidate; and a name of punctuation only
  («???») has a key but no query reaches it (both MOL-47). A name without a size ranks level
  with a wrong size — unknown is not worse than wrong, which is likely right.
- **Every candidate is ranked; there is no ceiling.** Any cut before ranking is wrong one
  way or another. By similarity it drops the typo the low threshold exists for — «малако»
  scores 0.429 against any «Малина» and 0.167 against the milk, and two hundred raspberries
  pushed it out. Unordered it drops by row age, that is the newest items, the ones «Предложить
  товар» just added. `order by id` is worse still: the planner walks the primary key and
  filters every row. The cost is bounded by the catalogue and by taking at most twelve words
  of a query: a two-letter query over 20 000 names answers in about 370 ms.
- **What the user picked is remembered.** A query and the item that went into a trip after
  it are stored under the query's search key, and next time that item comes first. No model,
  no image change, and it compounds from the first day — it is also the labelled set anything
  smarter would later need. Four rules hold it (MOL-11). **Personal:** only the asker's own
  picks count; a sum across people would be popularity in the results, indistinguishable from
  the paid placement forbidden below. **Above distance, but only among what was found:** a
  pick outranks a closer spelling and never lets in what the search did not accept.
  **The same query** means every word but the last equal, one last word the start of the
  other from three characters, and the word being typed still the start of a word of the item
  taken — the screen searches while typing, so the pick was made on «мол» and the next search
  may fire on «моло», but «молоток» typed in full is another word and lifts nothing.
  **Latest first**, then most frequent, summed over the keys that match. Memory belongs to
  the query: a new brand taken on «молоко» is on top of «молоко» from the next trip, but one
  found and taken by its own name («марианна») does not move «молоко» at all. It is written when the item is
  added to a trip, not on a tap — a tap the sheet cancels is a changed mind. It never forgets;
  if a stale pick starts to hurt, decay is a task with a number, not a guess.

**The thresholds — `word_similarity` > 0.15, edit distance <= 2 — were measured and kept
(MOL-14).** The set: the owner's own words from the expense log («кола», «дошик», «туалетка», 73
queries and 19 for what the shelf does not carry) against 64 names written for the shelf of
«Ереван Сити», plus the typo corpus of MOL-5, since the log holds no typos. At the kept point 62
of 73 have what they meant first and alone, 6 more share the first place with an item they did
not mean — a tie the row's uuid breaks: «мол» with «Кофе … молотый», «туалетка» with the
litter's «туалета»; 45 of 45 typos land in the top three; 17 of 19 absent words find nothing.
**No point of the grid did better on both halves.** A threshold of 0.3 empties every false hit
but drops «Молоко Ашхар» from «малако» — the case 0.15 exists for; a budget of 1 empties them
too and loses five typos and «собачий корм»; a budget of 3 wins one query and brings six false
hits. The slack on an unfinished word (MOL-10) moves five or six whole answers either way but
never a first row, so the grid could not tell its three settings apart — kept as it is, not
chosen. What no threshold reaches went to tasks with numbers: **synonyms** — «картошка» against
«Картофель», 6 of 73, one of them («мясо») found by letters only — MOL-45; **the absolute
budget** — «овощи» finds «Мука … высший сорт», «специи» «Соевый соус», «пельмени» «Чай зелёный»,
3 of 25 — MOL-46; **a unit word grounding a match** — «сыр» is two edits from `sht` of «4 шт» —
MOL-48. Weighting vowel edits below consonant ones was tried against the budget and refuted:
`ovoshi`/`vishi` share every consonant, while the right `canah`/«Чанах» and `grecka`/«Гречка»
differ by two. **The owner's absent words flatter the search:** of fifty everyday purchases the
shelf does not carry, 24 find something, and they are two outcomes. In 12 the first row carries
the word's root — a taste or a property printed on another item. Six of those are found exactly
or by the start of a word («сметана» is in the chips' name), which no threshold can remove; with
«Предложить товар» shown only on an empty answer, that is a question for the screen (MOL-23),
not the search. The other six are an edit of the ending inside the budget («яблоки» →
«яблочный», gone at a budget of 1). The remaining 12 share nothing but letters — the absolute
budget («водка» → «Вода») and the unit word («сыр» → «4 шт»), MOL-46 and MOL-48.
`REMEMBERED_PREFIX` was measured by typing letter by letter: a pick lifts its item on the next
letter 18 times at 2, 9 at 3, 5 at 4. It harms 5 times at 2 — where two of the owner's words
share two letters, a pick for Coca-Cola on «ко» puts it above «Колбаса» on «кол», one for
«Креветки» on «кр» above «Крекеры» on «кре», and each the other way round — and once at 3 and at
4, whatever the prefix: the owner's «кол» is a query of its own, for the cola, and a sausage
picked on «кол» while typing «колбаса» takes its first row through the equal key. That is the
price of memory belonging to the query — one short word serving two items. 3 stays, and real
picks measure it again (MOL-47). The corpus pins every answer whole — the shelf, those fifty
words, Latin and Cyrillic brand spellings, Armenian labels — so a change of either threshold
shows what it moves.

**Embeddings are a 0.2 question, not a 0.1 one.** They answer what trigrams cannot —
«молочка» reaching kefir and curd, and the duplicate merging the canonical catalogue needs.
They are not the answer to typos or transliteration, both of which are already solved
deterministically above. The cost is real: `vector` is not in `postgres:17-alpine`, so it
means owning the image, plus a model resident in memory on a cheap VPS.

**Telegram Mini App was dropped:** `getUserMedia` is broken on both platforms and the
native scanner only reads QR. Native is a 1.0 question.

**Exchange rates:** official ones from the open CBA API; real exchange rates from users.
Scraping rate.am was rejected.

**How the official rate reaches a trip (MOL-39).** A trip snapshots it when it starts, from a
cache in the database — **«Начать поход» never goes to the network**: a trip at the shelf does
not wait for a central bank. The API refreshes the cache itself, hourly, and at boot unless
the cache was written less than an hour ago — in development, unless it holds anything at all:
`make dev` restarts on every save
(`RATES_REFRESH`, on by default, off in end-to-end runs). The cache holds what the banks
publish — **one currency against the dram per day**, never a pair; the pair is built at the
snapshot, and an inverse or a cross is rounded there to the snapshot's six digits.

- **The CBA speaks SOAP only** — the GET form answers «Runtime Error» — and dates its rate by
  the day in Yerevan, with nothing on weekends: a Sunday trip takes Friday's rate, with Friday's
  date. The date always travels with the rate; «≈» without one is worse than an old number.
- **Two open sources stand in for it: the Bank of Russia, then open.er-api.com.** «The CBA is
  silent» has two faces and both count: five failures in a row, **or** an answer whose rate is
  over **seven days** old — a service stuck on its last date looks healthy. Every refresh still
  asks the CBA first; an open source as stale as the CBA sends the refresh on to the next one. A
  trip takes a fallback only when it is fresher than a CBA rate over a week old — a shorter bound
  would mark every weekend — and such a snapshot says `source: 'fallback'`. When nothing is
  fresher, the trip keeps the CBA rate with its date and `rateStale: true`: the screen says the
  bank has published nothing since. A pair is never built from two providers.
- **A jump is flagged, not refused (owner's decision).** A rate more than a quarter away from the
  lower median of its recent rates is stored with `jump`. Recent means: the central bank's own last
  five; an open source's own from the last week if it has three, and otherwise the central bank's
  — it is asked only when the bank is silent, so its own history is an old episode or nothing,
  exactly when a trip takes it. **Fewer than three earlier rates, no judgement:** with two the
  median is their mean, one ×100 day made the next right day a jump and offered itself as
  «previous». The trip remembers the jump and shows it always; beside the snapshot it keeps the
  rate before the jump when there is one no older than a week, and the person chooses — the jumped
  rate, that one, or their own for this trip, `personal` (`PUT /trips/:tripId/rate-choice`). The
  snapshot is never rewritten — only the choice moves.
- **Strict or nothing:** an answer missing a currency, carrying a zero or a negative, dated by a
  day that is not one — `0001-01-01`, `1970-01-01`, the 31st of February — or past tomorrow —
  `9999-12-31` — is not written at all. A stale rate with its date beats a mixed one.
- **An empty cache gives a trip no rate, for good** — the snapshot is written once and never
  filled in later (owner's decision, 19.09.2026).

## Tracker and documentation

They live outside the repository, on the same Atlassian site, reachable through the
`jira-confluence` MCP server configured for this working copy.

|                                 | Where                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Tasks, epics, sprints           | Jira, project **MOL** — `https://molvi.atlassian.net/jira/software/projects/MOL` |
| Product plan, design, decisions | Confluence, space **MOL** — page `294930` is the root                            |
| Rules for writing code          | `CLAUDE.md`, in the repository                                                   |
| The map of all three            | `docs/README.md`, in the repository                                              |

The split is deliberate. Rules change together with the code and must be reviewed in the
same commit, so they belong in git. The plan and the decisions do not follow the code and
must survive a lost disk, so they belong in Confluence, which keeps versions and backups.

**An epic carries the why, a task carries the what.** Descriptions in Jira are written to
answer why a thing is done the way it is, not to restate the title — so a later session
does not reopen a settled question.

The operational side — what the MCP server cannot do, the field ids and the traps —
is in `docs/tracker.md`.

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

### Three applications that happen to share a repository

`frontend`, `backend` and `bot` are treated as separate applications — as if they were
three repositories that live together only because it is convenient — and each must stay
deployable on its own. Each owns its `package.json`, `tsconfig.json`, `eslint.config.js`,
`vitest.config.ts` and `Dockerfile`, and each lints, type-checks and tests standalone:

```bash
npm run lint -w @molvia/backend     # its own config, from its own directory
npm run test -w @molvia/frontend
```

The root only gathers them. `eslint.config.base.js` is a shared preset a module opts into,
the way separate repositories share a company config; it knows nothing about the modules'
names. The root `eslint.config.js` ignores the module directories entirely and covers only
`e2e/` and the repository's own config files. The root `vitest.config.ts` lists the
modules' configs as projects rather than defining suites itself.

`@/` is configured per module, so it can point somewhere different in each. In the three
applications it points at that module's `src/`, because that is where importable code
lives — not because a shared rule decided it. The packages under `packages/` have no `@/`
at all: they ship their source, so they use `#<name>/…` instead, for the reason below.

**What deliberately stays at the root**, with the reason:

|                                         | Why                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prettier, `.editorconfig`, `.gitignore` | repository hygiene, not application config; five copies would only drift                                                                                                       |
| `.env` (development)                    | the three must agree on ports here — the frontend proxies to the backend's port and the bot calls it. In production nothing is shared: each container gets its own environment |
| `Makefile`                              | the entry point to the repository                                                                                                                                              |
| `playwright.config.ts`                  | end-to-end spans the whole stack and belongs to no single application                                                                                                          |

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
- Rounding happens on output only — never in storage or in intermediate results.

## Data rules

- **Verdict and expense are separate tables with separate write paths.** Do not merge
  them into one input screen: they have different frequencies and different motivations.
- **A withdrawn verdict is still a row (MOL-27).** `DELETE /verdicts/:itemId` sets
  `deleted_at` and erases the review; the row stays because the 0.2 gate asks whether someone
  _gave_ five ratings in two weeks, and «rated five, took one back» is still five — the
  owner's decision, with the price in view. So **the gate counts every row, and every other
  reader filters `deleted_at IS NULL`**: the verdict itself, «Что брать», the queue of
  unrated purchases and every aggregate of 0.3. A reader that forgets the filter puts a
  withdrawn opinion back on screen, silently. Rating again brings the same row back and keeps
  `rated_at`, so withdrawing and re-rating cannot move anyone in the gate.
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
- **Two faces, both self-hosted:** Nunito for titles and figures (`--font-display`), Onest
  for text (`--font`). The design prototype used Caprasimo and Figtree; neither has a
  single Cyrillic glyph, so its Russian mockups were rendered by a system fallback the
  whole time. Fonts live in the repository and are precached — the app is opened where the
  connection drops, and a request to someone else's CDN is one more thing that can hang.
- **The dram sign `֏` comes from a face of its own,** scoped to `unicode-range: U+058F`.
  Of the 321 Google fonts covering Cyrillic, four also cover Armenian and none is usable
  here. Without this the glyph falls back to a system font and shifts the baseline in the
  one place it must not: the prices.
- **Native HTML first, then Reka UI, never a styled kit.** On a phone `<select>`,
  `<input type="date">` and `<input inputmode="decimal">` open the system pickers, which
  beat anything a library renders; `<dialog>` already brings a focus trap and a backdrop.
  Reka is for the few things native cannot do — the catalogue combobox above all, which is
  the main screen and is full of subtleties (async results, keyboard navigation,
  `aria-activedescendant`, a virtual keyboard covering the list). It ships unstyled
  primitives that tree-shake, so importing `ComboboxRoot` costs only the combobox.
  A styled kit (PrimeVue, Vuetify, Naive) is rejected on purpose: its theme and our tokens
  would be two sources of truth about colour, which empties the rule about hardcoded
  values. shadcn-vue is rejected for the same reason in a different shape — it copies
  components written in Tailwind utility classes, and Tailwind is gone.
- **Interface icons come from MDI** through `unplugin-icons`: inlined as components at
  build time, so only what is used ships, no icon font is fetched, and colour comes from
  `currentColor` — they obey the tokens like anything else. The app icon is different:
  `frontend/public/favicon.svg` is the source, `make icons` rasterises the manifest PNGs,
  and the mark is a placeholder until there is real branding.
- Touch target >= 44px. The primary action is reachable with a thumb.
- **Every screen has four states:** loading, empty, error, offline. The empty state is not
  "no data" but an offer to act. They are drawn by two blocks and nothing else (MOL-19):
  `ScreenSkeleton` for loading, the screen giving the widths of its bars, and `ScreenState`
  for the rest. The tone of the circle carries the meaning and is fixed by the kind — an error
  is always red and always offers «Try again»; offline is green or yellow and **never red**,
  which `vue-tsc` holds rather than memory: `bad` is not a tone a screen can ask for. The
  type holds the prop, not the choice of kind, and that choice is the screen's: **offline or
  error is decided after the failure** (`navigator.onLine` read then, never narrowed from a
  check before the request) — a connection that drops while the answer is on its way is the
  commonest break at a shelf, and drawing it red was the first consumer's bug (MOL-19, A1).
  Back online, a screen tries again by itself, as the identity does — through `useReconnect`,
  which also hears the app coming back into view: an iOS PWA frozen in the background misses
  `online`. Polite states do not carry `role="status"`: they hand their words to the app's one
  live region in `App.vue`, above the router, since a region born with its words is often not
  read. Each announcement is a node added a task later, taken back when its block goes and
  gone by itself after seconds — a hidden region is still read in browse mode. Only an error
  or «attention» on the screen interrupts; anything inline is polite.
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
- **Every screen sits in `AppScreen`, and every move goes through the router** (MOL-17). The
  frame — pinned row, large title that collapses past 24px, back chevron, room under the tab
  bar — is drawn once; a screen fills its slots. A nested route names its `meta.parent` and
  gets the chevron, labelled with the parent's title, never the word «Back». Tabs and the
  chevron move through `useNavigation`: «Trip» is home — leaving it pushes, moving between
  the other sections replaces, returning is a step back — so the system «back» never walks
  through tab taps, and a nested screen opened cold gets its parent laid underneath. A
  section opened cold — a link from the bot — is its own home: «back» leaves the app, the trip
  is not laid under it, because a push without a gesture is what Chrome may skip. **No
  gesture is intercepted**: no touch listener, no `overscroll-behavior` on the root — the
  edge swipe and Android «back» belong to the browser, and the history is the one source of
  «back». Only the page scrolls, never an inner container: iOS hides its address bar and the
  router restores positions only for the window.
- **A screen is built from the kit, not drawn anew** (MOL-18): `AppButton`, `AppField`,
  `SegmentedControl`, `VerdictBadge`, `AppCard`, `BottomSheet` in `components/`, every state of
  them on the development-only page `/_kit`. `AppCard` carries exactly the differences between
  the three cards of 0.1 — `as`, `tone="take"`, `list` — and nothing for later: a component over
  a surface is one prop away from a wrapper around a `<div>`. **The sheet is a native
  `<dialog>` with an entry in the history**, laid through the router's own `history.push` at
  the same address — never a bare `pushState`, which leaves no scroll position saved and drops
  the list to the top on «back». Every close — ×, the scrim, Esc, Android «back» — steps back
  off that entry, and only the pop closes it, so exactly one entry is ever taken. Any move of
  the router under an open sheet — push, replace, a new query — closes it too; an entry no
  sheet holds — left by a reload or a move away — is stepped off by `installSheetEntryGuard`.
  `close(2)` closes it together with the screen under it, the sheets above and below included,
  and never steps out of the app. Sheets may stack: a pop closes as many from the top as
  entries it went back. Until it has come up the sheet takes
  no tap, so the second tap of a double tap cannot close it or press its main action. Open a
  sheet from a tap only: Chrome skips on «back» an entry laid without a gesture. **The sheet is the one exception to «only the
  page scrolls»**: a panel over the screen has no window of its own, so it scrolls itself and
  the page under it is held still.

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
shelf, so a desktop-only pass would prove nothing about the screen that matters.

- **Catalogue search is tested only against a real Postgres.** `pg_trgm`, `unaccent` and
  `fuzzystrmatch` cannot be faked, and they are exactly what breaks. Integration tests run against a
  **separate database** on the same server (`molvia_<index>_test`), created and migrated
  by the vitest global setup — a test run can never truncate data entered by hand. This is
  why `make check` needs `make up` first, and why CI runs a Postgres service.
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

**Scaffolded, the domain model is in, and the schema is under it** — MOL-4: seven entities,
eight write inputs and three rules in `packages/model`, with the wire codecs that money and
quantity need to cross it at all. MOL-5 added the search key; MOL-6 the nine tables of 0.1,
the GIN index over `search_key` and the constraints that hold the product's key. MOL-8 gave
the device an identity and the API its first routes; MOL-12 opened the catalogue — search
and «Предложить товар»; MOL-21 the trip — start it, add, fix and remove its rows, finish it.
**One trip is open at a time, and the choice is the person's:** «Начать поход» while another
is open answers `409 error.trip_open`, and the screen asks whether to continue that one or finish
it first. A finished trip still takes rows — the soy sauce found in the bag at home belongs to the
trip it was bought on. The trip and its rows are named by the device, so a queue sent twice is one
purchase.
MOL-27 the verdict — rate, amend and withdraw, addressed by the item;
MOL-39 the official rate — a cache refreshed hourly, snapshotted by every new trip, a jump
left to the person;
MOL-17 built the shell — routes, tab bar, `AppScreen`, the rules of «back»; MOL-18 the kit
screens are built from — button, field, card, verdict badge, sheet. MOL-28 the first real
screen, «Оценки»: `GET /verdicts/pending` gives **one card per item**, not per purchase — a
product has one verdict per person — with the place and day of the latest purchase: when its row
was entered, but never after its trip was finished (the sauce found at home was bought that
week). «Сохранить» keeps the rating on the phone and moves on; the app sends it
(`stores/verdictDrafts`, a map «item → latest rating», not an ordered queue: `PUT` is safe to
repeat). «Не сейчас» puts a card behind the others until the item is bought again; the last
answer is remembered for offline. «Поход» and «Что брать» are still placeholders. Release 0.1 is
broken into epics and tasks in Jira.
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

One VPS, one compose file, Caddy holding the certificate — see `deploy/README.md`.
The shape worth knowing here:

- **`api` and `bot` ship as a single bundled file each** (`bin/bundle.mjs`, esbuild). The
  runtime image carries no `node_modules` at all: nothing to audit and nothing that can
  drift from the lockfile it was built with. It also sidesteps the fact that the workspace
  packages export TypeScript source, which a runtime image could not read.
- **Migrations run when the API starts.** There is one instance, and a schema that lags
  the code deployed against it is the worse of the two failures. `make migrate`, the test
  setup and the boot path all go through the same code, so a migration cannot behave one
  way locally and another in production.
- **A migration applied anywhere is never rewritten.** drizzle decides what to run by the
  journal's `created_at` alone and never compares a file with what was applied: a rewritten
  migration is skipped silently if its stamp is older, and fails on its first `CREATE` if newer
  — then the API does not start. Folding a task's migrations into one is safe only while no
  database has run them; MOL-39 checked every copy's journal before and after doing it.
- **Postgres publishes no port.** It is reachable only over the compose network.
- **The PWA calls `/api/...`** and Caddy strips the prefix — the same shape the Vite dev
  proxy has, so nothing about the origin differs between development and production.
- **No deploy workflow.** Images are published to GHCR on a tag; the deploy itself is two
  commands on the machine. A deploy job with no machine to deploy to would look like a
  safety net without being one.

## Camera on a real phone

`getUserMedia` only runs in a secure context, and over the LAN a self-signed certificate
is refused exactly like plain http. `make certs` issues one from a locally trusted
authority (mkcert); `PWA_EXPOSE=1 make dev` puts the dev server on the network. Without a
certificate the dev server stays on http, which is right for everything except the camera.

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

**A new copy also needs the tracker.** The `jira-confluence` MCP server is configured per
directory and does not come with the checkout; without it a session cannot read the plan or
the tasks. The command is in `docs/tracker.md`.

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

**Plans and requirements live in `.scratch/tasks/`, not in the working copy and not on the
Jira issue.** A copy is temporary and a task is not; `.scratch` is the shared directory, so
the same file is visible from every copy and survives deleting any of them.

`.scratch` and `.lavish` are symlinks to `../_shared/molvia/{scratch,lavish}`, outside the
repository and in `.gitignore`. The links are relative, so the whole `projects/` tree can be
moved at once. The `_shared` directory is deliberately not in git — in a fresh clone
`bin/link-shared.sh` restores it.

## Related

The Google Sheets the project grew out of live in the Drive folder «Жизнь» and are reachable
through the `google-sheets` MCP server (see the memory in the `~/` branch). Accounting in
drams on a ruble salary already works there.
