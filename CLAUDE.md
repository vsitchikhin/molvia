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
into the log. Nothing updates or deletes from it — with one written exception, erasing a person
(MOL-58, below) — the gate queries are its only readers, and each is pinned by an integration
test, boundary days included.

**The one writer is «Что брать», once a day per owner (MOL-31).** MOL-8 was going to record
`session_started` on the first visit, and the promise was withdrawn when it was examined:
written once, its timestamp is `actors.created_at` and the row duplicates what a domain table
already knows — the very thing the rule above forbids; written on every launch, it answers a
question no threshold asks, since 0.2 is counted over verdicts. The screen records
`advice_viewed` with `subject: product` **only in the shared mode**, after the answer is
built, at most once per owner and payload in each **day of the person's own life** — days
counted from `actors.created_at`, as the gate counts its weeks from it, and both in hours
rather than calendar days, so a `timezone` set on the database later cannot pull them apart.
Not a rolling 24 hours from the last row: that window slid over the week line and swallowed a
visit early in week four. Overlapping requests are serialised by an advisory lock per actor,
and a failure to record is not swallowed, because a lost row lowers the gate with nothing to
backfill from.

**Both halves of the gate count from `actors.created_at`, not from a first event** (MOL-31,
Р-20). While the search wrote on every visit the two were the same day; with one writer left,
and that one behind a paid door, «first event» had become «first paid view». A person without
access never entered the denominator at all, and one with access had their fourth week counted
from the day they paid — a threshold selected on the very thing it tests, and one that could no
longer say «no». Reading a domain table is not what the log's rule forbids; duplicating it into
the log is, which is why `session_started` stays withdrawn. **And the visit is counted by
intent, not by catch** (Р-21): the condition is access, not content, so someone who opens an
empty screen — or one made entirely of their own figures, which the threshold of three
contributors makes ordinary — counts as having come back for other people's data. They came for
it; there was none.

**The cohort is those who could have answered: access reaching their fourth week** (Р-24). The
numerator stays behind the paid door, so a denominator of everyone who ever appeared counted
people with nothing to come back to, and the threshold read «stop» for a reason unrelated to the
hypothesis. It is read from `actors.shared_until` and is **approximate on purpose**: there is no
history of grants, only the moment access runs out, and it only ever moves forward, so someone
who bought later is counted as having had it then. The denominator errs large and the return
rate errs small — the gate errs towards «stop», the safe side of this number. Exactness needs a
table of grants, and that is a task rather than a line.

**That question was asked and answered once already.** From MOL-12 the writer was the
catalogue search, recording `catalogue_viewed` — and it measured entering, not reading, which
the owner accepted knowingly while no screen showed anyone else's data. The condition was
written down with the decision: when a screen does, who writes the visit is decided again.
MOL-31 is that screen, so the gate moved to `advice_viewed`, and **the search stopped writing
anything at all** — with the gate gone, `catalogue_viewed` had no reader, and whether a person
enters purchases is what `expenses` and `verdicts` answer. The rows already written stay where
they are: the log is append-only, and they were true when they were made.

**The question MOL-6 left open is answered: the log does not outlive the person** (MOL-58,
owner's decision 20.09.2026). The log points at `actors` with a real foreign key, so an owner
with events could not be deleted; erasing a person on request is now the single written
exception to append-only, and their rows go with them. The right to be erased outweighs a gate,
and a lost row there is the lesser harm. Whether the log could instead be anonymised to keep the
gates is 0.2's question, and an anonymisation that can be reversed is still personal data.

**The 0.2 gate is `VerdictRepository.reachedRatings` (MOL-49):** of those who appeared in a
window, how many have `GATE_RATINGS` rows in `verdicts` within `GATE_RATINGS_WINDOW_HOURS` of
`actors.created_at` — the same axis and the same hours as 0.3. It is the one reader of
`verdicts` without `deleted_at IS NULL`: «rated five, took one back» is five (MOL-27). **Its
`from` is the release of 0.2, and the caller passes it** — sign-in is open since 0.1, so
counting from the first actor would fill the denominator with people who had nothing of 0.2
to use (MOL-51). **A window still open is left out of the cohort**: counted, someone who came
last week reads as someone who failed. **A verdict counts from when the server received it**,
not from when the person pressed «Сохранить»: the drafts queue can hold it past the window, and
that lowers the rate — towards «stop», the safe side, like Р-24 — accepted rather than trusting
the device's clock, which stays out of the gates. A person deleted on request (MOL-58) leaves
both halves of the fraction and no trace; counting deletions separately is 0.2's.

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
  **grounds** a match only if it has two characters, no digit and is not a unit — «32», «1л»,
  «500г» are sizes, not grounds, and so are «шт», «мл», «см», «հատ», «pcs» (MOL-48): the length
  alone let `sht` through, two edits from «сыр», and every item sold by the piece answered it.
  The units are a list in natural spelling keyed by `toSearchKey` itself, so nothing stored
  depends on it and a missing unit is a line; only the forms written after a number — «рулона»,
  «пакетиков», «таблеток», never «таблетки», which begins the goods' own name. A query word right
  after a number that starts a unit is read as that unit against every name — «батарейки 4 шту»
  on its way to «штук», or the item vanished on every keystroke until the unit was typed whole.
  One that is a slip from a unit — an edit, or two letters swapped: «кефир 500 мд», «500 лм» — is
  that unit only against a name that prints it after the same number — apart or together, «500 мл»
  or «500мл» — and elsewhere the word it spells: read as a size everywhere, «2 сом замороженный» let
  «Котлеты … замороженные» in beside the fish, and against any «см» it let in «Пицца … 30 см» — the
  number gives a slip away. Either way only while another word still grounds the query, because in
  «2 суп» or «2 кап» the word is the goods. What it costs, named: «чай пакетики» misses the tea, its
  word measured as a word (the owner's decision); a right unit no longer carries a typo through the
  mean — «шакалат 100 гр» is lost where «шакалат голд» is found; a real word that shares a unit's
  key goes with it — «7 Up» is `7 up`, which «7 ап» no longer reaches; a slip reaches only the unit
  it slipped from, beside the number typed — «кефир 500 мд» loses «Кефир 1 л», which «кефир 500 мл»
  finds, and «кефир 1 мд» loses «Кефир 1000 мл»; a small count that matches the label passes for a
  slip — «1 суп доширак» brings «Doshirak лапша … 1 уп» in at the soup's distance, since only the
  meaning tells the goods from a mistyped unit; the start of a brand after a number is taken for a
  unit being typed — on «сыр 125 ка» (`ka` starts `kapsul`) every cheese comes one edit behind the
  Camembert, for one keystroke; and «тш» for «шт» is `цh` in the key, no transposition of `sht`, and
  two edits from it.
  A grounding word is measured against the grounding words of the name only, never
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
closed by MOL-48 for the units it lists, which took six of the ten items «сыр» found. Weighting
vowel edits below consonant ones was tried against the budget and refuted:
`ovoshi`/`vishi` share every consonant, while the right `canah`/«Чанах» and `grecka`/«Гречка»
differ by two. **The owner's absent words flatter the search:** of fifty everyday purchases the
shelf does not carry, 24 find something, and they are two outcomes. In 12 the first row carries
the word's root — a taste or a property printed on another item. Six of those are found exactly
or by the start of a word («сметана» is in the chips' name), which no threshold can remove; with
«Предложить товар» shown only on an empty answer, that is a question for the screen (MOL-23),
not the search. The other six are an edit of the ending inside the budget («яблоки» →
«яблочный», gone at a budget of 1). The remaining 12 share nothing but letters — the absolute
budget («водка» → «Вода», «сыр» → «Сок»), MOL-46; the unit word that added to them is gone
(MOL-48).
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

### What «Что брать» shows, and what it refuses to (MOL-31)

One route, `GET /advice`, and the whole screen: the rated items in three groups, each given
exactly what it is entitled to. **«Не брать нигде» has no field for a price, a place or a
threshold** — the answer is a discriminated union on `level`, so cheapness cannot reach a bad
item through an oversight in a later use case. That is the product's core rule held by the
type checker rather than by a reader, the way `bad` is not a tone a screen can ask for.

- **Two figures decide everything, and the domain owns both.** The repository returns a sum of
  scores and how many people stand behind it; `verdictLevel` picks the group and
  `averageScore` prints «4.3». The rating crosses the wire as a **decimal string**, never a
  number: one person's whole five and an average over many share one field, and «never float»
  has to hold for both. **The group is decided by the printed tenth, not by the exact
  fraction** (Р-22): 79 over 20 is 3.95, prints «4.0», and grouping it below «брать» put two
  rows carrying the same number in different groups with nothing to explain it. The person
  reasons with the number they see, so that number decides.
- **Free is your own data; access opens other people's.** `actors.shared_until` decides, read
  once per request, and `scope: 'own' | 'shared'` travels with the answer because the screen
  cannot work it out and «4,3 из 5» read as one's own score would be a lie. There is no
  parameter with which to ask for anyone else's.
- **An average needs three people (`AGGREGATE_MIN_CONTRIBUTIONS`).** With two, whoever knows
  their own score gets the other's by subtraction. Below three the row falls back to the
  person's own figures, and a row that has no own figures either — a stranger's lone verdict —
  **does not appear at all**: its mere presence with a verdict would be that opinion, read
  without them. A contribution is a person, never a row.
- **Prices are stricter than ratings, and in practice almost always one's own.** The same
  threshold counts _buyers of one item in one place_, so a place with fewer than three is shown
  only when the asker shopped there, with their own price. Expenses are private, and one
  stranger's price in one shop is their basket. Ratings travel with the person; **prices are
  filtered by the asker's own country and city**, because «cheaper» across cities means
  «elsewhere». **One's own purchases are the exception, and then the city decides the order**
  (Р-26): the city rule is about other people's prices, so filtering it before «mine or theirs»
  took away the Erevan prices a Gyumri resident could see for free — and leaving it out
  entirely put their own Erevan receipt first, under the word «Дешевле всего». Own city first,
  then by price.
- **The threshold of «только если дёшево» is the lower median, from three purchases**
  (`PRICE_MEDIAN_MIN_OBSERVATIONS`, MOL-33's answer) — `percentile_disc(0.5)`, a price someone
  actually paid, the same rule `isRateJump` follows. Fewer than three and the field is `null`,
  which the contract requires the server to say rather than omit.
- **One «currency + unit» per item, the one with the most observations**, ties broken by the
  latest purchase (MOL-31, Р-4). Two prices in different currencies have no common ground
  without a rate, and a rate belongs to one trip and one day, so they are never shown side by
  side.
- **Order is by rating down, then by name, in all three groups.** The handoff asked for
  ascending unit price; that sorts _different products_ by a number — milk at 570 ֏/л above
  beef at 4 790 ֏/кг — and «compare by unit price» is about one item across places.
- **The limit never cuts what must be seen** (Р-23). The list is ordered by rating, so the
  worst lie at its end, and `ADVICE_LIMIT` used to eat exactly them — two hundred strangers'
  fives deleted the one «не брать нигде» the screen exists for. What survives the cut is this
  person's own rows and every warning; what stands at the top of the screen is still the
  rating. Two orders in one statement, on purpose, and `total` beside the rows so a truncated
  list can say that it is one. **«Own» and «warning» are not the same tier, and the order
  between them mattered** (Р-25): with «own» first, a person holding `ADVICE_LIMIT` rows lost
  every stranger's «не брать нигде» — the one thing on that screen they could not have learnt
  themselves. So `ADVICE_WARNINGS_RESERVED` of the rows are held for them. A reserve and not a
  reordering, because warnings have no bound in the shared mode: putting all of them first
  returned, on a shelf of 250, a page of two hundred warnings and not one recommendation.
- **The server names no superlative.** It returns the places and nothing else; whether that
  reads «Дешевле всего» or «Брали здесь» is the screen's to decide (MOL-34's answer). **It
  decides by comparing the prices, not by counting the places** (MOL-32, А1): the list comes
  own city first and only then by price (Р-26), so the first place is the one to name but not
  always the cheapest — and «Дешевле всего» over 4 790 ֏/кг with «Ещё: 3 000 ֏/кг» under it was
  a lie the screen printed for a person who shops in two cities. And a review is always the
  asker's own: words are not an aggregate, there is nothing in them to average and nothing to
  hide behind.
- **Every row says whose verdict stands behind it** (`isMine`, MOL-32, А2). Nothing else in it
  does: in the shared mode a row may be entirely other people's, and a review is empty there
  exactly as it is on one's own verdict without one. The flag was already in the statement, for
  the warnings reserve; handing it out is what lets the screen offer «Оценить» where there is
  nothing to amend, instead of a `PATCH` that answers 404 under the word «повторите».

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

**The person's own rate comes from exchanges, never from a number typed in (MOL-40).** The plan's
decisions of MOL-41 (22.09.2026) replaced «enter your rate once and edit it» with the operation a
person actually performs: «gave 20 000 ₽, got 95 000 ֏, on this day» — `exchanges`, named by the
device, private always. The rate is what the two amounts say and is not stored beside them.

- **The wallet is the average cost of what is held, and spending does not move it** — it takes
  money and its cost away in one proportion. Only a new exchange does, and the weight of the old
  money in it is exactly how much was left at that moment: `heldBefore`, optional, asked once the
  received currency already came in by an exchange — never of the currency of conversion, which
  always costs one. Unknown, the wallet takes that exchange's rate and says so
  (`basis: 'last'`) rather than counting the remainder as zero in silence; before the first there
  is money of no known cost, so the first exchange never asks. Not derived from purchases: a price
  is optional and spending outside a trip is not written, so a sum of expenses would be a wrong
  weight presented as a right one — it is offered only as a hint, «по записанным тратам».
- **Every currency has a cost in the currency of conversion, and one rule moves them all (MOL-42).**
  Receiving money costs what was given for it, at the cost of that; giving money away moves
  nothing, as spending does not. So roubles → dollars → drams carries the price of the dollars
  into the drams, an exchange back into the currency of conversion leaves the wallet where it was,
  and dollars getting dearer later do not re-price drams already bought. The owner's own journal
  is why this is 0.1: two thirds of their drams came through dollars, and the pair alone did not
  see them. The screen lists the price of every currency a chain went through («$: 89,04 ₽/$») so
  the drams' rate can be checked by eye. Stored per currency, never per account: a dollar on a card
  and one in a pocket cost the same (MOL-43 decides accounts, not costs).
- **Money of no known cost is valued at the official rate of the exchange's day, and says so**
  (В-1): dollars brought from home, whose price in roubles nobody wrote down. What the person
  named counts as named, what they did not comes from a source — never as zero — and the wallet
  carries `estimated` for as long as that part is in the mix. The official rate is taken by the
  rule a comparison uses (a jumped rate gives way to the one before it); none in the cache for
  that day, and the cost is unknown until an exchange starts it afresh — the trip then takes the
  bank. Only a rate fresh for that day counts, by the week a trip allows — the rule for a trip falls
  back to the freshest it has and says `rateStale`, and here nothing would say it (Ж3). The cache
  is read once per day of the list, eight days at a time, and serves both. A wallet missing above
  a list of exchanges says which exchange its cost was lost on (`walletUnknown`), never «no
  exchanges yet».
- **A change of the currency of conversion works forwards** (В-2, the owner's comment over the
  option they ticked): «what I exchanged before is not re-counted». `actors.income_currency_since`
  is the day of the last change — the settings' own `UPDATE` sets it on every change, and a repeat
  of the form does not move it — and **before it no price is ever taken from the bank**: an
  exchange counts when what was given already has a price in the new currency without one — the
  new currency itself (dollars to drams, for someone who now counts in dollars), or a currency
  priced by the links counted so far (euros → dollars → drams, for someone who chose euros later).
  Roubles to drams belonged to the old reckoning and are not re-valued; the drams they brought have
  no price in the new currency, so the link makes their cost unknown rather than vanishing — a
  vanished link let the next dollar exchange weigh rouble drams at the price of dollar ones (review
  round 3, М1). The rows cannot tell a chosen currency from the default `RUB` every account starts
  with, and this rule does not need them to: attempts that cut by the day alone took the whole
  dollar history of anyone who once changed leftover roubles (Ж2, Л1). Which exchanges gave their
  currency a price only the whole walk knows, so the server says it per row (`priced`) and the
  sheet asks «сколько было до обмена» when the latest exchange into that currency on or before the
  chosen day is priced — the currency _has_ a price then, not merely had one once (round 4, Н2) —
  and when this exchange will give one: paid in the currency of conversion, in a currency with a
  price that day, or on or after the day of the change in anything the bank can price (round 5,
  О1). The flags are the server's; the one case the phone cannot see is a week of the bank's
  silence, when it still asks in vain. A wallet lost to the old reckoning says so in its own words
  (`walletUnknown.reason: 'oldReckoning'`), since «no bank rate that day» would be untrue (Н1). Earlier exchanges stay in
  the list as they were. A trip started offline with the old currency in its `context`
  is not cut — the cut is about the current one.
- **Exact to eighteen digits, rounded to six once.** `walletRate` keeps ratios of integers through
  the chain, each link brought to 10¹⁸ (the exception under «Money and quantity rules»), and rounds
  to the snapshot's six digits at the end, the way a cross rate is rounded. The screen walks the
  chain once (`ownRates`) for the wallet, the prices and the reason a wallet is missing.
- **A trip takes it at the start, like the official one, and never again** (В-4): with
  `actors.rate_preference = 'personal'` — the default — and an exchange of the pair dated no later
  than today in Yerevan, the snapshot is `source: 'personal'` with no provider and no jump;
  otherwise MOL-39's branch as it was. Nothing is required of the person: without exchanges the
  two preferences are the same answer. An exchange made while a trip is open moves the next one.
- **Every exchange is set beside the central bank of its own day**, by the same `pickOfficialRate`
  a trip started that day would use — «на 8 754 ֏ больше» or «меньше», never «комиссия»: a good
  exchanger beats the bank, and the difference says nothing about why.
- **An amendment keeps the version before it** (MOL-42, В-3): the rate of a past exchange is a
  fact, so `PUT /exchanges/:id` writes the old version into `exchange_revisions` and the new one in
  place, `created_at` untouched so the exchange keeps its place in its day. It names the version it
  was made over (`revision`): the exchange already as sent is a repeat, 200 and no new version; a
  version another device moved on from is 409, as the settings form is; removed or someone else's
  is 404, and a conflict keeps the sheet open with what was typed, over the version held now —
  which the sheet itself shows, remainder included, since the list that has it is under the sheet
  (round 2, Л4; round 3, М2). A
  remainder the exchange has is shown in the sheet whatever a new exchange would ask: an amendment
  replaces the exchange whole, so a field not shown was a field cleared. The row is a button named
  by its words — an `aria-label` silenced the rate and the comparison. The row says «исправлен», the sheet shows the versions — which is what explains a trip
  that took a rate the exchanges no longer say. The history goes with its exchange: a removal made
  final and erasure take it by cascade. «Где и заметка» is one private line, part of a repeat.
- **Removing is still there, for an exchange that should not exist.** Trips already started keep
  what they took. **The bin asks first, with the amounts and the day, and «Вернуть» stays offered after**
  (owner's decision В-5). A removal marks the row (`deleted_at`) and hides it from every reader;
  «Вернуть» (`POST /exchanges/:id/restore`) clears the mark, so the exchange keeps its
  `created_at` — written anew it took the moment of the tap, which moved both the order of its day
  and the hint. **A removal is final after ten minutes** (`EXCHANGE_UNDO_MINUTES`, owner's decision
  В-7): the server's minute timer deletes older marks of everyone, and the owner's next request of
  the screen deletes theirs sooner — the moment the screen stops offering them back. The screen
  withdraws the offer on an answer, never on a tap: a write lost on the way, or refused before it
  reached that point, leaves the removal undoable, and «Вернуть» stays. Both
  «Вернуть» and a removal are safe to send again after a lost answer: an exchange already back
  answers 200, and a removal never makes final the row it is marking. A «Вернуть» that comes too
  late is told so, and the list is read again — not «check the connection», which sent people to
  enter the exchange a second time.
- **A repeat is the same exchange, or it is a conflict** (В-6). The same name with the same
  amounts, day and remainder answers 200; with anything else, 409 — that is a correction sent
  after an answer that never came, and answering it «saved» left the typo in the wallet. The
  screen then shows what was written and says to tap it and amend it.
- **An exchange no rate in the band says is refused where it is written** (`error.invalid_rate`),
  never accepted and dropped from the wallet later: a zero too many once made the wallet vanish, the
  trip take the bank in silence and the screen say there were no exchanges above a list of two.
- **The hint counts what was spent after the exchange, in trips still open then** — a purchase
  added to a finished trip was paid with the money held before. «After» is the moment the exchange
  was written when that was on its own day, and the end of its day for one written later: counting
  from the record threw away everything bought between the exchange and its entry. Without a remainder named
  at the last exchange it speaks of that exchange's money only. A day's official rate that jumped
  is never an exchange's measure: the rate before the jump is, or no comparison at all.

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
- Rounding happens on output only — never in storage or in intermediate results. **One written
  exception: the links of the wallet's chain** are brought to eighteen digits (MOL-42, Ж1, owner's
  decision 25.09.2026). Kept exact, the fraction grew by some ten digits an exchange and 800 of
  them held the event loop — the whole API — for seconds. The error stays some twelve orders below
  the sixth digit a rate is printed with — which can still turn on an exact half, where any error
  decides the rounding: a chain may then print one unit of the sixth digit below the same price
  made in one pair (round 2, Л3). A named price, not a hidden one.

## Data rules

- **Every write to a trip goes through the queue on the device (MOL-24),** online or not — one
  path, so the sheet never waits on the network. A write is kept first and sent after, one at a
  time, in order, at start, on `online`, when the app comes back into view and, after a 5xx with
  the connection up, again with a doubling pause; there is no background sync on iOS. A repeat is
  safe because the device names every row — **while the row exists**: a remove is a hard delete,
  and an add sent again after it writes the row anew. So **storage is the queue, not a copy of
  it**: the installed app and a tab from the bot share it, every window reads it before each
  change and send, takes out only the write it sent (by the write's own key), and one window
  sends at a time (`navigator.locks`). **Without Web Locks** (Safari before 15.4, old WebViews)
  two windows can send the same head at once, and a removed row can come back — narrowed, not
  closed, as the identity's own fallback says of itself. What must hold is written to every shelf
  or kept in memory, and a shelf that refused the write keeps only the part of its past still
  true — the writes still waiting, never those sent since (removing needs no quota, and the part
  fits into the room it frees). Left whole, its past is read at the next launch and a removed
  purchase is sent again and comes back; emptied, it loses the purchases made with no signal.
  While a shelf refuses, what came after lives in memory only, and a PWA killed before it sends
  loses that — there is nowhere left to keep it. No connection, a 5xx, an answer off the contract (a shop's
  captive portal) and a 401 hold the queue, and so does a code the API did not say itself
  (`ApiError.answered === false` — a portal's 404 page). `error.trip_context_required` holds it
  too, and holds it **without a timer**: nothing changes until the person names the city and the
  currencies of a trip the old app started (MOL-65). Any other refusal is set aside in
  `rejected` and never retried — sent again it would be refused again and hold everything behind
  it. The last known trip is remembered per identity for the same reason: the app opened at the
  shelf with no signal still knows where a purchase goes — but **the memory is for when the
  server cannot be asked, not instead of asking**: the sheet asks every time it opens, and a
  trip answered finished stops being the current one.
- **Identity is proved by a session; `actors.id` proves only ownership (MOL-52, MOL-53).** The
  two were one thing until now, and everything awkward about 0.1 followed from it: `created_by`
  hidden from a catalogue card, a header that must not be logged, `no-store` on every reply
  carrying an identifier. What a person comes back by is `actors.telegram_user_id` — unique,
  so one Telegram account is one owner — and what a request proves itself with is a session
  token. **The token exists in the database only as a `sha256` in hex**, and the repository
  is what holds that: it takes raw tokens and hashes them itself, so no caller has a method
  that could store one. **Revoking a session is deleting its row**, not marking it — which is
  the opposite of a withdrawn verdict above, and for a reason worth keeping straight: a
  verdict is data with a reader (the gate counts it), a session is a key, and a discarded key
  has no readers. Deletion also makes «revoked», «expired» and «never existed» one answer for
  free, where a flag would need every later query to remember it.
- **A login is a five-minute, one-use request (MOL-54).** The link carries a public code;
  `__Host-molvia_login` carries an independent secret, stored only as a hash. The bot confirms
  the code with a Telegram id, but only the browser holding the secret can collect a session.
  **Whose Telegram confirms is not checked against anything** (adversarial А1, owner's decision
  23.09.2026): someone who sees the link within its five minutes can confirm it with their own
  account, and the browser that started it silently collects _that_ account — its purchases
  then land there — and anyone holding the code can decline it. Accepted while the code goes
  from the browser straight into Telegram on the same device; a QR or a login from another
  device reopens the question. The term is the database clock's alone: the row takes both of
  its times from `clock_timestamp()` and the cookie's `Max-Age` is the lifetime itself, so an
  API clock off Postgres neither refuses a start nor shortens the cookie.
  Collection locks the row before checking the current database clock, then consumes it,
  finds or creates the owner and writes the session in one transaction. A concurrent first
  login uses `ON CONFLICT DO NOTHING` and a new read, not a caught unique violation inside an
  already-aborted transaction. Nothing updates the existing owner's settings.
  **The cookie is sent after commit, only once.** A lost response means checking `/actors/me`
  and starting again if it never arrived, not replaying the token. One pending request per
  browser cookie store; a new start replaces its secret. Polls never clear that cookie, since
  an old response could erase a newer request. Safari and an installed PWA have separate stores.
  Start and GET poll require `X-Molvia-Login: 1`, reject foreign fetch metadata and expose no
  CORS; HEAD cannot consume. This GET is the deliberate exception to the usual read-only rule.
  All auth replies are `no-store`, including refusals and what Fastify answers itself under
  those paths — no route, a path that does not decode. The bot uses a separate `BOT_API_SECRET`,
  never the Telegram token; Caddy additionally blocks its internal paths from outside.
  **Thirty starts in a rolling minute, across the database**, including consumed requests:
  the quota is serialized with an advisory lock. Its shared denial-of-service price is accepted.
  Expired requests are removed at start, at boot and every minute; no login writes `events`.
- **The token rides in a cookie, and `backend/src/cookie.ts` is the only module that touches
  one (MOL-53).** `__Host-molvia_session`, with `HttpOnly` so an XSS cannot carry the account
  away and so ITP's seven-day cap — which applies to what a _script_ writes — never reaches it;
  `Secure` always, with no branch for the environment, because a branch saying «here it is not
  needed» eventually reaches production; `SameSite=Lax`, with the special-header guard above
  for the login GET; `Strict` would additionally refuse the one navigation the epic is
  built around — the person coming back from the bot; `Path=/` with no `Domain`, because the
  browser sees `/api/…` and both Caddy and the Vite proxy strip that prefix; `Max-Age` rather
  than `Expires`, so the clock of the device does not decide. The **`__Host-` prefix** is the
  browser holding the last three of those for us, and it buys the half the server cannot: nothing
  else on this host may set a cookie of that name at a deeper path. **Setting it and saying
  `no-store` are one act** — that is how «a cookie is never handed out by a reply that can be
  cached» holds without anyone remembering it, and a test asserts that no second module writes
  `set-cookie`. The one price, named: over plain http on the LAN (`PWA_EXPOSE=1 make dev`)
  `Secure` means no session — the same place the camera already needs `make certs`.
- **What an address of a resource may look like is one rule, in `packages/model/src/support/resource.ts`
  (MOL-25, Р-3).** An identifier in a path is taken in either case and answered in lower case:
  Postgres compares uuids without case and answers in lower case, so a path spelled `AB12…` would
  reach a row whose id comes back `ab12…` and the device would not recognise its own row in the
  reply. A malformed one is **404, not 400** — malformed, missing and someone else's are one
  answer, or an identifier could be guessed by the difference. Bodies that _create_ a row are the
  other way round and stay strict (`deviceIdSchema`), so the answer and the draft on the phone
  agree on one spelling. The rule lived in three places and two of them had already drifted over
  the case; tests on both sides hold the callers to it, as they do for `INVISIBLE`.
- **What a secret may look like is one rule, in `backend/src/secret.ts`** — RFC 6265's
  `cookie-octet`, because the only thing a session token or a login request's secret ever travels
  in is a cookie. It was two rules once, and they drifted by four characters: a token holding
  `"`, `,`, `;` or `\` was written and read perfectly well and then cost a 500 the day its term
  came due, or — for `;`, the header's own separator — a row no request could ever open. A test
  walks every printable code point and holds the rule and the cookie to the same answer, as
  `text.ts` does for `INVISIBLE`. Narrowing does **not** bring back MOL-52's Р4: `+`, `/` and `=`
  all pass, so plain base64 is still a token.
- **More than one cookie of that name is refused, and a refusal then clears nothing.** A browser
  sends the more specific path first, so anything able to set a cookie on this host — a sibling
  app on another port in development, where the port is not part of «site» — could put its own
  session in front of the real one and be answered as. «Which of these is ours» has no honest
  answer; and clearing would delete ours at `Path=/` while leaving theirs, turning an attempt at
  fixation into a lockout. Only a lone cookie that was refused is put out.
- **The term slides, and one write a day moves it (MOL-53).** 180 days from the last use
  (`SESSION_LIFETIME_DAYS`), and both `last_seen_at` and `expires_at` move together, at most
  once in `SESSION_TOUCH_AFTER_HOURS` — a term extended without moving `last_seen_at` would put
  a date in MOL-57's device list that means nothing. The condition lives inside the `UPDATE`'s
  `WHERE`, not only in the caller, so two requests arriving together write once; the caller
  checks it too, off the row it already holds, because an `UPDATE` on **every** request would
  bloat the one table every request touches. The cookie is re-set by the same write, or the
  browser would drop a session the server still holds.
- **Four refusals, one answer.** No cookie, a token nobody was issued, a token of a revoked
  session, a token of an expired one: `401` with `error.no_actor`, identical byte for byte.
  Nothing arranges that — they fail one `WHERE` in the repository, and a value this server could
  not have minted is refused before Postgres sees it, so «malformed» cannot become a third,
  distinguishable answer. Our own refusal also puts the cookie out (`Max-Age=0`) when one was
  sent, which a 401 from Caddy or a shop's captive portal never can, because it never reaches
  this code.
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
- **A person can be erased, and erasure is one function** (MOL-58): `ErasureRepository.erase` in
  `backend/src/db`, one transaction under a lock on the owner's row. It removes sessions, search
  picks, verdicts with the withdrawn ones, events, expenses, trips, exchanges (MOL-40 — the
  person's own money), login requests by Telegram id
  — they carry no foreign key, so no cascade reaches them — and the owner. Catalogue items the
  person added stay with `created_by` nulled, and **every place stays** (owner's decision
  24.09.2026). People erase themselves with `/delete` in the bot; the owner's fallback is
  `dist/forget.js` in the API image (`make forget` in a copy — `TG` reaches the script through the
  environment, never pasted into the recipe, where a value could close a quote and bring its own
  `--yes`, П-3), a dry run unless `--yes`, and
  **a dry run is the real run, rolled back**, so its count cannot disagree with what erasure does.
  **A new table that points at `actors` must join erasure** — a test compares every foreign key
  on `actors` with `ACTOR_REFERENCES`, and another scans every table for the erased person's uuid
  and Telegram id. **Its first lock is the account's, then the person's login requests, and only
  then the owner** (adversarial О-3, П-2): `for update` on an owner who does not exist yet locks
  nothing, and a login collected meanwhile created an owner the transaction had already decided
  was not there — «nobody to erase» over a live account. Collection locks its request row before
  creating the owner, so the two take turns; and a request not yet confirmed has no Telegram id to
  be locked by, so confirmation and erasure share `lockTelegramAccount`, an advisory lock on the
  account taken first by both — and so does **whatever makes an owner**: `create` and `createIfMissing` take
  it themselves (Р-1), so no path — the login, the development seam, whatever comes next — makes an
  owner inside an erasure. Collection takes the account's lock before its request row (read, lock,
  read again), because taken after it, a collection and an erasure could each wait on the other.
  One order everywhere: the account, then request rows, then the owner. The bot's `sequentialize`
  happens to order one chat's presses too, but that is another module's promise and the two API
  routes have no order of their own. **Cleaning expired requests skips locked rows** (Р-3): it runs
  under the one quota lock every login start takes, and waiting there for an erasure — or a dry
  run of one — holding a person's expired request closed the door to everybody. A dry run still
  holds that one account's lock for as long as it runs. **The page and the bot name what stays in full** — the items and the shops —
  and say that copies on the phone are out of the server's reach: nothing clears a device's
  storage for an owner the server no longer knows, since a 401 there is also an expired session.
- **No third-party trackers or analytics, and so no cookie banner** (MOL-58). There are two
  cookies, both strictly necessary: the session and the five-minute one of a login in progress
  (MOL-54); what the phone keeps in its storage is the queue and the drafts the app needs to work.
  **Any third-party script that sees data is a decision, not a dependency** — it changes what the
  privacy page says and is discussed before it lands.
- **Logs live fourteen days and carry no address and no query** (MOL-58). The API logs a request
  as its method and path — the query of `/catalogue/search` is what a person looked for; Caddy
  keeps no access log; Postgres logs its errors `terse`, without the row values of `DETAIL`;
  every container writes to journald, and the term is the host's
  (`MaxRetentionSec=14day`, `deploy/README.md`). **A failure is logged by its kind, on every
  path** (adversarial О-1): name, driver code and stack frames through `describeFailure`, never
  its message — a driver's message is the query with its parameters, and a failed search wrote
  what was searched for and who asked, a dropped connection the hash of every session token in
  flight. **The frames are what follows the stack's own header, cut off whole** (П-1): picked by
  their shape, a line of a multi-line review written as `    at …` passed as a frame, with the
  rest of the parameters behind it. `forget` prints the same. An unknown address answers without echoing it and is not
  logged with its query. What the privacy page (`/privacy`) says about data is a promise these
  rules keep, and it is read before signing in — the one route with `meta.public`, which
  `App.vue` draws past the login screen (MOL-56), linked from that screen and from the settings: a change to either is a change to both — and it says only what they keep: other
  people's prices are shown in the shared mode (MOL-31), so «shown to nobody» is said of the list
  of purchases, and an address can reach Caddy's error log, so «no address» is said of requests.

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
  Reka is for the few things native cannot do; it ships unstyled primitives that tree-shake.
  **The catalogue combobox turned out not to be one of them (MOL-23):** Reka's
  `ComboboxContent` calls `hideOthers` whenever it is shown — an always-open list hid the back
  chevron, the title and the app's live region from a screen reader — and both its input and its
  listbox filter highlight the first row by themselves, so «Найти» took a row nobody chose. The
  combobox is the ARIA 1.2 pattern on a native `<input>`, about a hundred lines
  (`CatalogueCombobox`): no row is active until an arrow makes one.
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
  of truth. **One exception, and it is not a second implementation (MOL-24):** while a purchase
  is being typed, the sheet shows its unit price and its estimate in the income currency through
  `unitPrice()` and `convertMoney()` of `packages/model` — the very functions the server calls.
  At the shelf with no connection the price per litre is needed now, to decide whether to take
  the thing. Once written, every number on screen is the server's; the phone never adds up a
  total, not even for rows still in the queue.
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
  the same address — never a bare `pushState`, whose state lacks the `position` and `back` the
  rules of «back» read. Every close — ×, the scrim, Esc, Android «back» — steps back
  off that entry, and only the pop closes it, so exactly one entry is ever taken. **The sheet puts
  the page back by what it was opened from, never by a number** (MOL-63): it notes the element
  the opening click landed on — a tap, Enter, a screen reader alike, since iOS does not focus a
  tapped button; the click is forgotten once its task is over, and a sheet opened later is measured
  by the focus — and where it stood on the screen, and after the pop that lands on the same screen
  scrolls by the difference. A list that changed height above it meanwhile — reread, a queued row
  sent, a notice come or gone — Chrome and Firefox have already kept still, and the difference is
  nothing (Safari keeps nothing still, and gets it put back); a window the platform moved under the
  sheet — the iOS keyboard for a field in it — comes back, since `overflow: hidden` stops a finger
  and not the platform. At the very top of the page the browser keeps nothing still on purpose —
  what came above the list stays in sight — and there the top stays the top. The
  router's number did the second and broke the first, moving the list by the change. So the router
  does not scroll a move to the same address, which is a sheet's or a refused duplicate push; the
  first navigation comes «from» `START_LOCATION`, whose address is «/», and is not one — read as
  one, the trip loaded again forgot where the person was. And e2e takes «the list stayed» by where
  the opener stands on the screen, never by `scrollY`, which the jump left equal. Any move of
  the router under an open sheet — push, replace, a new query — closes it too; an entry no
  sheet holds — left by a reload or a move away — is stepped off by `installSheetEntryGuard`.
  `close(2)` closes it together with the screen under it, the sheets above and below included,
  and never steps out of the app. Sheets may stack: a pop closes as many from the top as
  entries it went back. Until it has come up the sheet takes
  no tap, so the second tap of a double tap cannot close it or press its main action. Open a
  sheet from a tap only: Chrome skips on «back» an entry laid without a gesture. **The sheet is the one exception to «only the
  page scrolls»**: a panel over the screen has no window of its own, so it scrolls itself and
  the page under it is held still.

## The bot, and what it is allowed to know (MOL-55, MOL-58)

The bot does two things in 0.1. It is the second half of the login: the one place a person is
shown **which device** they are letting in and says «yes» to it by hand. And it is where a person
**erases themselves** (MOL-58): `/delete`, one question naming what goes and what stays, one
press — the only channel people are given, because there Telegram already says who is asking.
Rating reminders are 0.2.

- **Whose data goes is `ctx.from.id`, never anything in the button.** The button carries the
  action and the second it was issued, and it means yes for ten minutes
  (`ERASE_BUTTON_SECONDS`); older, without a time or from the future, it is refused over the
  message and taken away. The API answers `204` whether there was anyone to erase or not, and the
  bot writes one sentence for both — «ваших данных в Molvia нет» — so the second press of a double
  tap cannot overwrite the first with something that sounds different. **«Отмена» is not an
  outcome** (adversarial О-2): it is shown over the message and takes the buttons away, and its
  words are true whichever button came first — written in, «Ничего не удалено» overwrote «Готово»
  over an account already gone. When Telegram will not take the alert, the same words go under
  the message as a reply, and the buttons go only once something was said (П-4): a refusal may be
  silent because its buttons stay, and this one takes them. **A button too old to mean yes is
  answered the same way** (Р-2) — it too takes the buttons, and it was «Удалить навсегда» that
  was pressed. **Under the message speaks only the press that took the buttons away** (С-1): the bot keeps no
  state, but Telegram refuses to take away buttons already gone («message is not modified»), so
  the second press of a double tap stays quiet; if nothing can be said at all, the buttons are put
  back. The erase composer is installed **before** the login's, which
  ends in a catch-all that greets every text.

- **The i18n rule of the frontend covers the bot too, and this is the line that says so.** Not a
  string of text in the code — every message is a key, Russian first, English mirroring it. The
  dictionaries are `.ts` rather than `.json`, unlike the PWA's: there Vite loads them, here the
  module is read by `tsx` and bundled by esbuild, where a JSON import in ESM wants attributes.
  The keys become a type as a result, so **the two languages mirror each other by the type
  checker**, and the test is left to cover what types cannot see — an empty value and a lost
  substitution. The language is `pickLocale` of `packages/model`, the very rule the PWA uses:
  Telegram's `language_code` is an IETF tag like any other, and a second copy of that decision
  would be a second place to drift.
- **The bot keeps no state of its own.** The login code rides in the button's `callback_data`,
  which is Telegram's memory rather than ours, and everything else is asked of the API — the
  only write path there is. So nothing survives a restart, because nothing needs to.
- **Updates of different people are handled at once; updates of one person, in order** — and
  both halves are load-bearing (MOL-55, О-4). `bot.start()` handles updates strictly one after
  another, which is grammY's ordering guarantee and was measured costing the next person their
  whole turn: while the API thought for 300 ms, their request did not leave at all, and a queue
  measured in whole timeouts outlives the login requests standing in it. `@grammyjs/runner` is
  the answer — a dependency the owner agreed to on 24.09.2026 — with `sequentialize` by chat
  keeping the other half: «Войти» and «Это не я» pressed one after the other must end where the
  second press says, not where the faster answer does. Both succeed on their own — `confirm` is
  idempotent and `decline` works on a confirmed request — so unordered they would leave «Вход
  подтверждён» standing over a request that was in fact put out. **The price of that ordering is
  named** (Е1): presses of one chat queue behind each other, so somebody tapping a silent API
  waits a whole `API_TIMEOUT_MS` per tap. Nothing can fix it here — the alert _is_ the answer to
  a press, a press is answered once, and the answer is unknown until the API replies.
- **The question is asked from the account owner's side** (З-2, owner's decision 24.09.2026):
  «Впустить это устройство в ваш аккаунт Molvia?», and the last line names what it costs to
  get it wrong. «Войти в Molvia?» over a button labelled «Войти» read as «log _me_ in» — the
  wrong way round for the one attack the button exists to stop, where a stranger's link makes
  your tap let **their** browser into **your** account.
- **An outcome is written into the message; a refusal is only shown over it** (О-1). Both
  presses of a double tap leave before the first edit lands — the buttons are still on screen,
  which at a shelf on a slow connection is ordinary — so the second was refused by the API,
  correctly, and used to **overwrite «Вход подтверждён» with «Начните вход заново»** over a
  session already granted. A refusal goes to `answerCallbackQuery`, which cannot rewrite what
  is written. The buttons then go only if the link is dead: «the API did not answer, try again»
  has to keep the very buttons it asks for.
- **Confirming twice from the same account is a success, not a refusal** (О-2). A confirmation
  that was written while its answer was lost left the bot unable to tell that from «not written»
  — and it chose wrong, twice: «не получилось», and then «начните вход заново» on the link
  opened again. So `confirm` is idempotent for the same account (another one is still refused —
  that is what the button is for), and a preview says `confirmed`, **whether and not who** (Р-11).
  The bot then says the one true thing: it is confirmed, go back to the app — **and offers «Это
  не я» with it** (Б1). That sentence reaches two people, because «whether» cannot tell them
  apart: the one who just pressed the button, and the person whose link leaked and was confirmed
  from a stranger's Telegram, whose browser is about to collect a session of **somebody else's**
  account. Pure reassurance at that moment is worse than the confusing «ссылка больше не
  действует» they used to get, and `decline` still works on a confirmed request until it is
  collected — the button is the only way to reach it. Telling the two apart needs no id to leave
  the server (the preview could take the asker's), and until it is asked for, the answer is the
  same for both and safe for both.
- **A refusal is shown over the message and written nowhere — and that rule has no exceptions**
  (О-1, and two rounds of trying to make one). Telegram will not answer a callback query that
  aged out while the API was thinking, and then the refusal reaches nobody (В1). Both cures were
  worse than the disease. A **new message** stayed in the chat for good, so the successful retry
  it asked for rewrote the question above it and the last word was a refusal over a login that
  had happened (Г1). **Editing the question** was worse still: it rested on «the API did not
  answer, so no press of this message can have succeeded», which is false — the API can answer
  one press and time out on the next, which is the very case idempotent `confirm` exists for —
  and it erased «Вход подтверждён», handed the buttons back, and «Это не я» among them would
  then put out the person's own confirmed login (Д1). So when the alert cannot be shown, nothing
  is said: the buttons are still there, and the next press carries a **fresh** query that can be
  answered. What that press is made cheap by is the **bot's own API timeout — five seconds, not
  fifteen** (`API_TIMEOUT_MS`): the answer has to be given while the finger is still on the
  button, the API's work here is one indexed row, and a press given up on early is safe to
  repeat. The residue is named: if the alert cannot be shown, that press produces no words at
  all — for a dead link the buttons go instead, and opening the link again says it in full.
- **The spinner is cosmetic, and its failure is not news.** `answerCallbackQuery` throws on an
  aged-out query; on the success path it stands in a `finally` after the outcome is written, and
  letting it out wrote «update failed» in the log about a login that had just succeeded (Г2) —
  the same wrong-thing-named-as-broken that З-4 removed from the other path.
- **The «Это не я» of an already-confirmed request reaches anyone holding the link**,
  so a stranger can put out a login somebody else confirmed — a denial of service, not a
  takeover, since confirming with their own account is still refused (В2, owner's decision
  24.09.2026). Accepted for the asymmetry: a cancelled login costs seconds and is visible, while
  the hijack that button rescues is silent and permanent. The same power over an _unconfirmed_
  request has always been there — the prompt itself carries «Это не я».
- **«message is not modified» is an answer, not a failure.** An idempotent second confirmation
  rewrites the message with the text it already carries, Telegram refuses that, and reading the
  refusal as «the message is gone» put a duplicate reply in the chat on every double tap (Б2).
  And the **outcome is written before the press is answered**, with the answer in `finally`:
  `answerCallbackQuery` throws on a query Telegram has aged out, and with it first that left the
  login made but the message still showing the question (П-2).
- **It repeats none of the API's rules.** The five-minute term, the one-use rule, the quota and
  «expired, spent, declined and unknown are one answer» belong to MOL-54 and are read off its
  refusals. The bot adds exactly two things: the account, which only Telegram can vouch for,
  and the person's explicit consent.
- **Telegram updates are never logged whole** (the privacy page, п. 4.3): an update carries a
  name, a username and a language we deliberately do not store. What goes to the log is the code
  of the error and the operation that failed. How a press is answered — `settle`, `refuse`, the
  spinner, the keyboard — lives in `answer.ts`, shared by the login and erasure.
- **A copy without `TELEGRAM_BOT_TOKEN` or without `BOT_API_SECRET` does not start**, says so in
  one line and exits 0 — «this copy has no bot» must not become a restart loop under compose.
  Such a copy signs in through `POST /dev/login` and cannot use Telegram at all.

## The way in, and what stands behind it (MOL-56)

The login is the first screen a person without a session sees, and every other screen is behind
it. The whole of it is three things the API and the bot cannot do: start the request, survive
the round trip through Telegram, and ask whose account this turned out to be.

- **It is a gate, not a route.** `App.vue` draws it instead of the router's view, so the address
  is all along the one the person was going to: a link from the bot to `/advice` opens «Что
  брать» the moment they are in. A `/login` entry would have to be written into the rules of
  «back» (MOL-17) and would need to remember, separately from the address bar, where the person
  was headed. The one price is the tab's title, which the screen sets and puts back.
- **The door has one definition** — `login.closed`, which `App.vue` only reads — and it turns on
  what is actually known. A session the server named and the person claimed opens it; «no
  session» is an answer too and shuts it, whatever the device remembers. **Where nothing has
  been answered yet** — the launch, offline, a server that did not reply — **the drawer decides**:
  with an owner on the device the app is shown, drawing its own skeletons the way it did before
  this screen existed, and without one there is nothing to show at all, no drawers and no cached
  answers. That last part is the same argument as Q5's, and it is deliberately not written in
  terms of `navigator.onLine`: a shop's captive portal reports `true`, and the rule walked
  straight past it (adversarial А5). Holding the door shut for the whole of the loading was
  tried and is worse than it looks — every launch with a live session flashed «Вход», and what
  caught it was an end-to-end test rather than an eye. **The screen keeps all four of its own
  states behind the door**: an unanswered question with no connection is «нет связи», not a
  skeleton that loads nothing (А2).
- **One tap is one request, and nothing starts a login by itself.** The quota is thirty starts a
  minute **across the whole database**, so an app that started one every time the screen appeared
  would close the door for everybody. «Открыть Telegram» reopens the same link; only «Начать
  заново» asks for another, because a new start replaces the secret in `__Host-molvia_login` and
  makes the previous request uncollectable.
- **The device remembers the request and never the secret.** `{id, url}` under `molvia.login`,
  because iOS unloads the PWA while the person is in Telegram and the confirmation they gave
  would otherwise have nowhere to arrive. The secret stays in the `HttpOnly` cookie; putting it
  on the device would be MOL-8's mistake again. What comes back off the shelf is checked before
  it is opened — `https` and `t.me`, the same shape `loginStartedCodec` holds on the way in.
  **The key is shared between windows and the request inside it is not**: a window removes or
  rewrites only the request it started, because one whose link had died used to `forget` over a
  neighbour's live one — and a neighbour iOS had unloaded came back to «Войти через Telegram»
  with a confirmation on its way to nobody (adversarial А3). Starting a login still replaces what
  is stored: a new start replaces the secret, so whatever was there is dead anyway.
- **«Истекло» is the server's word** (`error.login_unavailable`), never `expiresAt` minus the
  device's clock: a phone whose clock has run away would otherwise be unable to sign in at all.
  There is no countdown on the screen; the text says the link lives five minutes.
- **«Повторить» repeats whatever did not work.** The screen's error state covers two failures at
  once — the login would not start, and the server would not say who we are — and a button that
  always began a login took a person who needed only an answer into Telegram instead, with a
  fresh request against a quota shared by everybody (adversarial Б2).
- **The poll fires on the three ways a person comes back**: a three-second timer, the app
  returning into view — on iOS a frozen PWA gets nothing else — and `online`. A hidden tab polls
  nothing. Every refusal but a dead link keeps the request: the next poll is seconds away, and a
  hiccup must not throw away a confirmation the person is about to give.
- **Whose account this is, is asked before anyone is let in** (MOL-55's round 3). Whoever sees
  the link within its five minutes can confirm it with their own Telegram, and the browser that
  started the login collects _that_ session; the bot's «Это не я» rescues nobody once the screen
  is polling. So the screen stops: it names what the wire carries — the city, the currencies and
  the day the account appeared, «сегодня» for a fresh one — and waits.
- **What the device writes down is the owner the person approved, never «somebody is
  unconfirmed»**, and the difference is the whole of the second review (adversarial А1 и А4).
  A flag saying «ask about this one» is set only when the script sees the answer that collected
  a session — and the browser stores the cookie from that answer's _headers_ whether the script
  lives to read it or not: a restart, or a «Начать заново» a moment earlier, left a session with
  no flag beside it and the door opened on an account nobody had been asked about. The same flag
  was cleared by anything that looked signed-out, and `error.no_actor` is the truth about the
  moment a request **left**: one still in flight from before the login wiped the question, and
  the next `me()` walked in. Written the other way round — `claimed` — the question cannot be
  missed: whoever the server says we are is compared with whoever the person approved, and
  anything else is a question, however the session arrived.
- **A refusal is not a conclusion; the app asks again.** `error.no_actor` from any call sends the
  identity to `verify()`, which asks `me()` once and believes only that: a refusal earned before
  a login landed is discarded by a revision counter, and a server that cannot be reached says
  nothing at all rather than signing anybody out. It steps aside while a question is already in
  flight, or a cold start with no session would ask twice and `verify` would ask itself forever.
- **Another window's login is this window's business.** Two windows share one cookie jar, so a
  session collected in one is the session the other carries; a window that was already open
  would otherwise keep showing the app — and, worse, the question itself — as the owner it
  believed in a minute ago. A write to `molvia.login` shuts the door here and re-asks `me()`,
  and the card is drawn only from the answer.
- The price of the question is named and accepted (owner's decision, 24.09.2026): one extra tap
  on a login into an account this device has not approved before, and one's own first account is
  indistinguishable from a stranger's fresh one — which is the case with nothing yet to take.
  Telling them apart needs the confirming Telegram's name on the wire, and that is a task of its
  own. «Это не я» ends the stranger's session on the server first (MOL-57, `POST /auth/logout`) —
  this browser's session only, the stranger's other devices are theirs — and nothing is claimed,
  so a reload or a relaunch asks again instead of walking in. A way out that fails does not hold
  the way in: the new login replaces the cookie anyway, and the row left behind has no key.
- **Showing the app and writing into it are different rights** (adversarial Б1). The door may
  open on the drawer's name while the first `me()` is still in flight — that is what keeps a
  launch with a live session from flashing «Вход» — but a drawer says nothing about the cookie,
  and in the one case where the two disagree (a session that arrived without the script seeing
  it) a rating held back on a `401` went out into a stranger's account at the first
  `onMounted(send)`. So **the queue and the drafts send only once the server has said who we
  are**, and while another window's login is still being caught up with: the rule sits in
  `flush()` of both, and **only** there — `App.vue` gives the occasion and no second opinion. A gate there as well looked harmless and took away the queue's own
  «the server is silent, try again later»: that timer is set by `flush`, and `flush` was never
  reached (adversarial Г1). The occasion is every settling of the identity, «error» included,
  which is what starts the doubling retry — and the retry asks about the identity first, waiting
  for that answer, because `start()` sets «loading» synchronously and a `flush` in the same tick
  saw no error left to schedule the next attempt from. Nothing is lost by waiting — a queue waits for
  the network anyway, and the answer is one round trip — **but the screen is told**, in the same
  words a failed attempt would have used: silence there left «Отправляем оценку…» standing
  forever at a shelf with no signal, which is the product's main scenario (adversarial В1).
  What is **not** held is everything else: a screen's first fetch goes out in parallel with
  `me()` on purpose, and so does a write a person makes with their own hands in a sheet — the
  rating, the amendment, «Предложить товар». In that same rare window those may reach a session
  the person has not claimed, or draw its figures for a moment before the door shuts. Holding
  them would mean serialising every screen behind the identity and paying a round trip on every
  ordinary launch, to close a case that needs a session to have arrived unseen.
- **What the screen says while it waits is «нет связи», and that is an exception to MOL-19's
  rule rather than its new edition.** There, offline or error is decided by `navigator.onLine`
  read after the failure; here nothing was even attempted, and behind a shop's captive portal
  `onLine` is `true` while «Повторить» would call the same held-back send and change nothing.
  Silence was worse: it left «Отправляем оценку…» standing forever at a shelf (adversarial В1).
- **A `401` anywhere is the login screen**, through one seam in `frontend/src/api.ts` wired in
  `main.ts`. Before it, `error.no_actor` was read by three callers out of a dozen and a half and
  every other screen said «что-то пошло не так» about an account that was simply not there.
  Telling `error.no_actor` from a bare `401` stays where it was, in `packages/client`: a proxy, a
  gateway and a shop's captive portal all answer `401` without knowing what an actor is.
- **Nothing on the device is thrown away by any of this** — by a `401`, that is; «Выйти» is the
  one exception, below. `molvia.actor` stays — it is the name
  of a drawer, not a credential (MOL-53) — so the trip queue, the recent items and the verdict
  drafts wait where they are, and Telegram brings the same owner back. The task's own line about
  deleting it was written before MOL-53 and is answered by it (owner's decision, 24.09.2026).
- **Offline with nobody on the device is the screen's own offline state**, not a notice over an
  empty app: there are no drawers to open and no cached answers to show. Offline **with** an
  owner opens the app, because a PWA at a shelf with no signal is the main scenario there is.
- **The development seam is a button, and only in a development build.** It signed the app in by
  itself until now, which made the screen this epic exists for invisible in every working copy
  and unreachable to the end-to-end suite; `signedIn()` in `e2e/session.ts` now presses it, in
  either language, and waits for the door rather than for the tap. Its failure stays on the login
  screen instead of opening the app with a notice. It shows no «whose account» step: that exists
  for a confirmation given elsewhere, and here the person signs themselves in with no Telegram
  in it at all.

## The way out, and what it takes with it (MOL-57)

The epic's last task: end this device's session, and end another one — the old phone, the laptop
somebody else owns. **Revoking is deleting the row** (MOL-52), so ended, expired and never-issued
stay one answer, and the device that was put out learns it on its next request: `401`, its cookie
put out, the login screen through the seam of MOL-56. Nothing reaches it sooner, and nothing can.

- **Three routes, and each keeps a rule it already had.** `GET /sessions` lists the owner's live
  sessions, **the current one first by the `ORDER BY`** — past `SESSIONS_LIMIT` a caller sorting
  what it was given would cut off the very row in the person's hand — and `total` beside them.
  `DELETE /sessions/:id` puts ownership in the `WHERE`: someone else's, a missing one, an expired
  one and a malformed id are one `404`. **The current session may be ended there too**, and then
  the cookie goes with it — the last session leaves the same way as any. `POST /auth/logout` sits
  with the login's routes, not in the guarded scope: a way out must work for a session already
  gone, so a repeat after a lost answer is the same `204`, and it never says whether a session
  was behind the token. The login's guards apply (`X-Molvia-Login`, fetch metadata, no body), and
  two cookies of the name are refused with nothing cleared — MOL-53's rule, for MOL-53's reason.
- **`withActor` hands the session's id to the request** (`request.sessionId`), from the same read
  that found the owner. It is what «this device» is, and what `DELETE` compares with to know it
  ended its own session — by the id as Postgres spells it, since a path is taken in either case.
- **Expired sessions are deleted by the minute timer** (owner's decision Q4), `skip locked` as the
  login's cleanup is: nothing read them, and a device name kept for good contradicted the privacy
  page's «180 days from the last use».
- **«Выйти» erases this device's drawer — after the server's `204`, never on the tap** (owner's
  decision Q1). This is the exception to «a `401` erases nothing» above, and it is not a
  contradiction: that rule exists because «no session» is also an expired one, with a purchase
  from a shelf with no signal still in the queue. Here the person says it, and the server has
  confirmed it. Without the erasure the drawer would open the app offline — MOL-56's rule for a
  launch with an owner on the device — and show the next person at that laptop the last one's
  trips. `forgetOwner` takes every `molvia.*.<owner>` key and `molvia.actor` from both shelves,
  **by the suffix and not by a list**, so a store added later is swept without anyone remembering
  to; `identity.test.ts` pins which keys exist, so a key that breaks the shape is a decision. The
  login record loses only this owner's approval — a login another window has in progress stays.
  **The owner is let go in this window first** (`release`: `id` to `null`, the revision moved), so
  a rating answering after the erasure finds nobody to file itself under and a `me()` that left
  before it cannot write the drawer's name back (adversarial Б1, self-review С-2); then the drawer
  goes under the trip queue's lock, and the page is loaded afresh at `/`. **Offline there is no
  way out at all** — the cookie is `HttpOnly`, the page cannot put it out, and a session left
  alive is what the person came to end — and the sheet says so **before a tap**: the button is
  inactive and nothing is sent or written down (round 3, Е1). A tap known to be offline used to
  leave an intent behind, and a person who changed their mind at the shelf met the login screen
  at the next launch.
- **A lost `204` is settled by the server's next answer, and by nothing else** (adversarial Б2,
  round 2 Д1, Д3). The intent, `molvia.leaving`, is written before the request leaves: if the
  server deleted the session and the answer never came, the first `401` closed the door on the
  settings and the erasure never happened. The server's «nobody» now finishes it; its «this very
  owner» means the request did not land, and the intent goes. **The identity keeps the server's
  word apart from its own state** (`heard`, `nobody`): a launch with no connection and the intent
  on the device shows the login screen — the door's `signed-out` — but that is the device's
  conclusion, and erasing on it threw away a purchase from the shelf while the session lived on.
  Closing the sheet after a failure does not withdraw the intent — the outcome is unknown — it
  asks the server; so does a return of the connection or of the app while the intent waits. The
  listener is a store of its own (`stores/signOut`), created with the app. **An answer that came,
  and not from our API, is not unknown** (round 4, Ж1): a captive portal's page or a stranger's
  `4xx` (`answered === false`, anything but `error.internal`) means the request never reached the
  server, and the intent goes at once — kept, a portal at the till locked the app further into the
  shop. **The way out succeeds on `204` and on nothing else**: a portal answers a redirected
  request with `200` and a page of its own, which read as «no body», and the phone erased a drawer
  for a session the server never heard about. **Somebody else signing in settles the intent too**
  (self-review Р3-2): the cookie of the owner who left is gone, so their drawer is erased there and
  then and the person now signed in is left as they are — `forgetOwner` removes the drawer's name
  and the intent only when they name the owner being erased. **The price, named:**
  a connection lost while the request was on its way leaves the outcome unknown, and a launch with
  no connection then shows the login screen until the server can be asked — the drawer of someone
  who may have left is not opened on a guess.
- **What would be lost is counted aloud** (owner's decision Q2) — everything the erasure takes
  that the server does not hold: the trip queue and the purchases it refused, every rating draft,
  saved or still being typed, and an unsaved settings form (adversarial Б3). The app is asked to
  send first when the sheet opens. Both «Выйти» and «Завершить» ask before acting, because
  neither can be undone — there is no «Вернуть» for a deleted key.
- **Another window lets the owner go by the drawer's disappearing, and erases its own shelves**
  (adversarial А1). `sessionStorage` belongs to one tab, so the window where «Выйти» was pressed
  cannot clear its neighbours' — and `read` falls back to it, so a neighbour's reload opened the
  app of the person who left. It asks no `me()`: the window that erased did so after the `204`.
  **A tab that slept through the event checks at every start** (round 2, Д2): a drawer on its own
  shelf with not one key of the owner on a shared shelf that works was erased elsewhere — a tab
  the browser unloaded, or one closed and reopened, gets its `sessionStorage` back without the
  event. The drawer's name counts **by its value** (round 4, Ж2): once somebody else signed in, the
  shared shelf names them. A shared shelf that refuses a probe write says nothing: then this tab's
  shelf is the only one, legitimately (Safari's private mode). The premise was checked (self-review
  Р3-1): Safari's seven-day cap clears `SessionStorage` together with `LocalStorage`, so ITP does
  not leave a drawer on one shelf; clearing the shared one by hand still does, and then the tab's
  copy goes too — a named limit, because a marker naming who left would keep their id on the device. A tab that wakes with its memory — frozen by the
  browser, or restored from the back-forward cache — checks on `visibilitychange` and `pageshow`
  too, because `recover` starts nothing from `ready`.
- **«Это не я» and the login's poll take turns** (adversarial Г1). The way out's `Max-Age=0` is
  addressed to the cookie's name, not to a token, so a poll that collected this person's own
  session and answered first had it put out of the jar. `refuse` waits for a poll already on its
  way — and if that one brought the person's own session, there is nobody to put out and no
  login to begin — and holds the next poll until the way out has answered. The server still
  clears by name, as the task asks: the race is closed where the requests are made.
- **«Устройства» keeps nothing on the phone and reads the list again on every return** — to the
  tab, or `online` — not only after a failure (adversarial В2): a list kept in memory for hours is
  the copy it refuses to keep on the disk. A device ended leaves the list at once, not with the
  next read (В1), and a list that could not be read again is not shown at all — the screen says
  «нет связи» or offers «Повторить» instead (round 2, Д4). There is no empty state: a live session is always in its own list. «Были» is a
  day, never a time — `last_seen_at` moves once a day — the current row says none, and a date of
  another year carries the year. An unknown device gets its own sentences rather than its label
  put into somebody else's case.
- **Where they live** (owner's decision Q3, brief of MOL-41): «Устройства ›» and «Выйти» are one
  group, «Аккаунт», on the settings screen, outside the form's states — the way into the account
  does not depend on whether its settings loaded. The current row in «Устройства» has no button:
  one place for one action.
- **Named limits.** A device that was put out keeps what it stored until someone clears it — the
  server does not reach a phone (MOL-58), and the list says so. Without Web Locks the erasure is
  not serialised with another window's send. The development seam now names its sessions by
  `User-Agent`, so a working copy's list is not a column of «unknown device».

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
- **End-to-end has a database of its own too, and it is dropped before every run**
  (`molvia_<index>_e2e`, MOL-60). Until then the suite started the API without a
  `DATABASE_URL` of its own and wrote into the dev database, so every pass left a catalogue
  item and a purchase behind: a leftover «Кефир 4a2d4992» outranked the canonical item a
  test expected — deterministically, and only on a machine with history. `bin/e2e-database.mjs`
  recreates it (and refuses any name not ending in `_e2e`); the API migrates it at boot, so
  there is no second migrator. Recreated rather than truncated: it also makes the schema
  match the migrations after a branch switch, with no hand-kept list of tables. Not the
  `_test` database, because that one is never cleaned between runs — its tests own their
  rows — and `pre-push` runs both suites back to back.
- **The run also has its own ports** (`E2E_API_PORT`, `E2E_PWA_PORT` — the neighbouring port
  in this copy's band). A database alone would not have closed it: `reuseExistingServer`
  handed the suite the dev API whenever `make dev` was up, so no `DATABASE_URL` of ours
  reached a process — and `pre-push` runs e2e exactly then. Now the two stacks coexist.
- **Words that are said out loud are taken end-to-end by a locator outside the live region**
  (MOL-64). The app has one polite region, in `App.vue` above the router, and **six things write
  to it**: `ScreenState` («title. body»), `ScreenSkeleton` («Loading…»), `ItemSearchView` (the
  count of an answer, and an empty answer's own words), `ItemDetailsSheet` (the price per unit),
  `VerdictCard` («Pick a rating») and `useSettings` (the form's notice). Whatever any of them
  says is on the screen twice, so a plain `getByText` matches two nodes and playwright's strict
  mode refuses — a failure the machine's speed decides: measured, one match at once and two from
  200 ms onwards. Strict mode is right, and it is answered with a locator, never muted with
  `.first()`; the region is not the place to fix it either, since the whole announcement is
  MOL-19's decision — a screen reader hears the state whole. **The heading when the block has
  one** (`getByRole('heading', { name: … })`), **the block's own container when it has none** —
  the search's `.not-found-text`, the settings' `.dock`. Three things are easy to get wrong.
  **A heading needs its name where the level is shared:** `{ level: 2 }` alone is not outside
  anything, because a state's `h2` is the level of a card's and a sheet's too, and an inline
  notice puts two of them on one screen (MOL-64, Н3). The `h1` is the exception rather than a
  loophole — `AppScreen` draws one per screen and the pinned copy of the title is `aria-hidden` —
  so `getByRole('heading', { level: 1 })` is the screen's own title, and asserting its text is
  what says which screen this is (`navigation.spec.ts`, `sheet.spec.ts`); naming it there would
  only restate the answer. A second `h1` would make those two the same race. **Not every state speaks** — a full-screen `error` or `attention` carries
  `role="alert"` and hands the region nothing, so of `ScreenState`'s own states only `empty`,
  `offline` and anything `inline` double; that is why four of MOL-64's five places were not
  failing yet and were fixed anyway. And **`exact: true` is not the rule and holds by
  accident:** it saves only while the announcement is longer than what the screen shows.
  `ScreenState` joins with `[title, body].filter(Boolean)`, so a title without a body is
  announced alone and matches exactly too; `useSettings` writes `${title}. ${body}` unfiltered,
  and the trailing «. » is the only reason two settings assertions were ever green (Н2). Two
  ways of joining one string, and a locator must not depend on which one ran.
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
**MOL-25 makes completed trips reachable through the whole history**, in pages of twenty, and
lets a purchase be added, amended or removed there while another trip stays current. The selected
trip owns the currency, rate and total of its sheet. The phone remembers the first history page,
the last selected trip and snapshots of completions still synchronising; the queue remains the
only source of pending writes. **Every conflicting start asks**, including the same shop. A choice
is tied to the owner, the queued start's key and the open trip, checked again under the queue lock.
**Completion has two clocks:** `finished_at` remains the server's receipt, while
`finished_on_device_at` records the first tap kept in the queue. History uses the device's time,
with the server's as fallback for old rows. It may precede the server start after an offline trip;
it changes neither rate snapshots nor gates nor purchase dates. Finishing twice moves neither time.
MOL-27 the verdict — rate, amend and withdraw, addressed by the item;
MOL-39 the official rate — a cache refreshed hourly, snapshotted by every new trip, a jump
left to the person; MOL-24 the sheet «сколько, в чём, почём» — a live unit price, a price in any
of the four currencies, and the queue that keeps a purchase on the phone until it is sent;
MOL-17 built the shell — routes, tab bar, `AppScreen`, the rules of «back»; MOL-18 the kit
screens are built from — button, field, card, verdict badge, sheet. MOL-23 the first real screen,
«Что взяли?»: the search as the person types, the recent items on the device, «Предложить
товар». **A pick leaves with the query it was made on** (`stores/itemEntry`): «Добавить в поход»
sends it and the server remembers the pick under it — handed the item alone, that memory would
silently stop filling. The recent items are written when an item goes into a trip, not on a tap,
per identity. MOL-28 «Оценки»: `GET /verdicts/pending` gives **one card per item**, not per
purchase — a product has one verdict per person — with the place and day of the latest purchase:
when its row was entered, but never after its trip was finished (the sauce found at home was
bought that week). «Сохранить» keeps the rating on the phone and moves on; the app sends it
(`stores/verdictDrafts`, a map «item → latest rating», not an ordered queue: `PUT` is safe to
repeat). «Не сейчас» puts a card behind the others until the item is bought again; the last
answer is remembered for offline. MOL-31 the API of «Что брать» — the three groups, where it is
cheaper, the threshold of «только если дёшево» — **and with it the paid layer, pulled into 0.1
by the owner on 20.09.2026**: free is one's own data, `actors.shared_until` opens other
people's, and the 0.3 gate moved from the search's event to this screen's. MOL-22 built the
trip screen; MOL-32 «Что брать» itself, and with it the last placeholder is gone. **The verdict
decides how much matter a row gets** — a card, a row, a line of text — so the product's rule is
the layout and not a caption: in the last group there is nothing to be cheap with. The screen
computes nothing about the data except one word: one place is «Брали здесь», two and more
«Дешевле всего» (MOL-34), because how many there are is visible to it alone. **The last answer
lives on the phone**, under its owner and parsed back by the same schema, so offline is a strip
naming the age of the list to the minute rather than an empty screen; without a memory it is the
yellow state, and neither offers a button, because the screen comes back with the connection.
**The strip is printed by where the rows came from, not by what became of the request** (А4):
while an answer is still on its way yesterday's prices used to look freshly loaded.
`scope` is said in words — the subtitle, and a footnote saying the reviews and prices are still
one's own. **A verdict is amended where it is met** (MOL-28 left this here): a tap on any row
opens a sheet with the 1–5 scale, the review and «Снять оценку», and until it existed a
mis-tapped «1» stood until the item was bought again. **In the shared mode the sheet offers no
score pre-chosen** — the figure on the row is an average over several people, and a save would
have written it down as this person's opinion — and on a row that is nobody's of one's own it
rates rather than amends (`isMine`). Withdrawing asks nothing and says instead what it does;
rating again brings the same row back. **The count of ratings is printed only in the shared
mode**: in the own one it is always one, and the subtitle says as much. Release 0.1 is broken
into epics and tasks in Jira.
MOL-52 put the schema under accounts: the Telegram identity on the owner, `sessions` and
`login_requests`, and the repositories over them — the routes are MOL-53 and MOL-54. Its
migration **emptied the owners and everything hanging off them**, because a Telegram identity
cannot be invented for a row already written; the catalogue and the places survived, with
`created_by` nulled (owner's decision, 20.09.2026). **The invite door of MOL-8 is gone with
its handle**: `POST /actors`, `withInvite`, `INVITE_HEADER`, `SIGNUP_CODE` and the `?c=` link.
MOL-53 put the session under every request: `withActor` reads the cookie, `liveByToken` answers
with the session and its owner in one statement, and `X-Molvia-Actor` is gone from the model, the
client, the PWA and the tests — the client has no way left to name an owner at all. On the device
the uuid stays, but as **the name of a drawer**: the trip queue, the recent items and the verdict
drafts are filed under it and read at the shelf before the server can be asked who we are. With
the header went everything that existed because the device held a password — the set-aside keys,
«вернуть прежние данные», the claim two tabs negotiated over and the state `lost`; «the session
ended, sign in again» is MOL-56's, together with the screen that can act on it.
**The owner of an account does not change** (owner's decision 22.09.2026). The seam used to mint
a fresh Telegram id on every call, so a session that ran out came back as somebody else — and the
trip queue, the recent items and the verdict drafts, all filed on the device under the owner's
id, were left where no screen could reach them. A cookie of its own now remembers the account
this browser was given, which is what Telegram itself becomes in MOL-54; clearing the browser's
cookies is the one thing that still makes a new person, and that is the development counterpart
of losing the Telegram account.
Development still gets a session from `POST /dev/login`, a seam that **is not in the production
bundle at all** — the bundler folds its guard to a constant and the module is tree-shaken away,
which a test asserts against the built file rather than against the intention; the PWA's call to
it is behind `import.meta.env.DEV`, so the production bundle does not hold it either.
MOL-54 added the real API: browser start/poll and internal bot preview/confirm/decline, shared
contracts and separate clients. Production requires `TELEGRAM_BOT_USERNAME` and `BOT_API_SECRET`.
MOL-55 gave the bot its half: `/start <code>` names the device and the age of the request and
offers «Войти» and «Это не я», the answer replaces the question so its buttons go with it, and
five kinds of dead code get one reply. With it the bot got a dictionary of its own and
`pickLocale` moved into `packages/model`, where the PWA now reads it from too.
MOL-56 closed the epic's user-facing half: the login screen, the gate in front of every route,
the request that survives the round trip through Telegram, and the one seam that turns any `401`
into a door instead of «что-то пошло не так». **And it closed what the bot's review left open:**
«Это не я» in the chat rescues a hijacked login only while the browser is not polling — with the
screen open a stranger confirms and the session is collected in a cycle or two. So the screen
names the account it landed in and waits to be told it is the right one. The rules are in «The
way in, and what stands behind it» above.
MOL-57 closed the epic with the way out: «Устройства» under the settings, «Завершить» on any other
device, «Выйти» that ends this session and erases this device's drawer after the server's `204`,
and «Это не я» that now ends the stranger's session instead of only walking away from it. The
rules are in «The way out, and what it takes with it» above.

MOL-65 gave the person their four fields and a fourth tab: Armenia, Гюмри or Ереван, the currency
purchases are written in and the one they are converted into. `PUT /actors/me/settings` compares
the four it was handed **inside the `UPDATE`**, so two devices cannot both overwrite one form,
and an exact repeat after a lost answer is successful because the target matches as well. The
form is settled **choice by choice**: one nobody here touched follows whatever the account holds
now, and «conflict» means both devices changed the same one — sending the whole stale form took
the other device's move back silently, with nothing on the screen to say which field was about to
go. **A trip names its own geography** (`context`): the settings as the phone knew them when it
started, which offline may be older than the row, so a move made elsewhere neither renames the
shop nor changes the currency of a trip already begun. A start from the old queue carries none,
and so does one naming a geography nothing may be written under — **one answer,
`error.trip_context_required`, because it is one question for the person**; the queue **holds it
without a retry** until they name the city and the currencies, because nothing else knows where
that trip was. A 400 there would have been the end of that trip: the queue sets a start it cannot
send aside, and the purchases behind it go too. **What a trip may name is the rule the settings
refuse by** — `geographyAllowed`: one's own current city, or AM with one of `SETTINGS_CITIES`.
`places` is a table everyone shares, and «the country is fixed as Armenia» must not be held by
the form alone. The city is read by the fold
`places.ensure` stores it under, never by the exact spelling, or a shop written «гюмри» once
falls out of its own owner's prices. **The form's draft belongs to the account and not to the
window**: it is kept under the owner's key on the device, as verdict drafts are, because the
system closes an installed app by itself — and «изменения останутся только пока приложение
открыто» is then what it says, a shelf that refused, rather than a permanent condition nobody
is told about. It is written to both shelves and **read from this window's own one first**, so
a new launch takes the last draft written while two windows open at once keep the forms they
are typing into. «Что брать» answers with the geography it counted by, and
the phone compares it with its own: a different city is a list to load again, and an answer the
settings will not move to is taken as it is — the screen used to stay on a skeleton for good.

MOL-40 put the person's own rate under the trip — «Обмен денег», nested under «Настройки»: the
exchanges, the wallet worked out from them, the preference «мой / ЦБ РА», and every exchange
beside the central bank of its day. The trip total says «мой курс» for it. MOL-42 made it every
currency's cost rather than one pair's — chains, reversals, money of no known cost valued at the
bank's rate of its day, a change of the currency of conversion that works forwards — and gave an
exchange amendments with their history and a note. Incomes and the rest
of the money model are still their own tasks.

MOL-58 gave the people whose data this is the minimum 0.1 owes them: a page that says what is
kept and for how long (`/privacy`, open without a session), `/delete` in the bot, which erases a
person in one transaction — the event log included, the one exception to append-only — and logs
that keep no address and no query and live fourteen days. Export, a delete button in the
settings, versioned policy and consent are 0.2 (Confluence, «Персональные данные», section 5).

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
  packages export TypeScript source, which a runtime image could not read. The API's image
  carries a second file, `dist/forget.js` — the owner's fallback for erasure (MOL-58), since the
  machine has neither the source nor a published database port.
- **Every container logs to journald**, which keeps fourteen days (MOL-58). `LOG_DRIVER=json-file`
  exists only for trying the stack on a laptop, where Docker Desktop has no journald.
- **Migrations run when the API starts.** There is one instance, and a schema that lags
  the code deployed against it is the worse of the two failures. `make migrate`, the test
  setup and the boot path all go through the same code, so a migration cannot behave one
  way locally and another in production.
- **A merged migration is never rewritten.** drizzle decides what to run by the journal's
  `created_at` alone and never compares a file with what was applied: a rewritten migration is
  skipped silently if its stamp is older, and fails on its first `CREATE` if newer — then the
  API does not start.

  **The line is the merge of the pull request, not the first database to run it** (owner's
  decision, 23.09.2026). The rule is about the production database and about branches other
  people build on; a working copy's database is pushed around all through development anyway.
  So while the task is still open, a task's migrations may be folded into one — and then **every
  database that already ran the old file is brought into line by hand, in the same sitting**,
  because those are the ones drizzle will silently skip. MOL-39 checked every copy's journal
  before and after doing it; MOL-25 did the same and applied the added index to this copy's
  three databases with the very statement the file now carries. After the merge the file is
  frozen and a change to the schema is a new migration, always.

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

|              | Copy 0         | Copy 2         |
| ------------ | -------------- | -------------- |
| API          | 3300           | 3320           |
| PWA          | 5300           | 5320           |
| Postgres     | 5500           | 5520           |
| Database     | `molvia_0`     | `molvia_2`     |
| API in e2e   | 3301           | 3321           |
| PWA in e2e   | 5301           | 5321           |
| e2e database | `molvia_0_e2e` | `molvia_2_e2e` |

The band is ten ports wide, so the neighbouring one is always free: a run at `+1` coexists
with `make dev` instead of taking it over. **A copy whose `.env` predates MOL-60 needs
`bin/init-env.sh <index> --force` once** — `make setup` keeps an existing `.env`, and
without the three `E2E_*` values playwright refuses to start and says exactly that.
**`--force` carries `TELEGRAM_BOT_TOKEN` over**: everything else in the file is computed
from the index, that one is typed in by hand, and BotFather does not show it twice — a
reissue revokes the old one. Regenerating was a once-per-copy event until MOL-60 made it
compulsory for every existing copy, which is what turned the loss from unlikely into
documented.

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
- **One bot for development and one for production, and the development token lives in the one
  copy that is testing the login** (owner's decision, 24.09.2026; MOL-56 asked again). Two
  processes on one token do not each get a copy of an update — Telegram hands every update to
  exactly one of them, at random. So with the token in two copies at once, the tap on «Войти»
  reaches the bot of the _other_ copy, that bot asks _its_ API, which holds no such request, the
  person reads «ссылка больше не действует», and the screen under test waits out its five
  minutes. Nothing errors, and the next attempt may work. **A copy without a token cannot sign in
  through Telegram at all** — it says one line, exits 0, and its only door is `POST /dev/login`;
  the same holds without `TELEGRAM_BOT_USERNAME`, which is what the API builds the link from:
  starting a real login there answers `503 error.login_disabled`. That is why moving the token
  costs nothing: a copy without it is not broken, it is simply not the one being tested.

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
