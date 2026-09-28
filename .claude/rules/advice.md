---
paths:
  - 'packages/model/src/{entities,contracts}/{advice,verdict,events}.ts'
  - 'packages/model/src/values/gate.ts'
  - 'packages/model/tests/{entities,contracts}/{advice,verdict}.test.ts'
  - 'backend/src/db/{verdicts,events,expenses}-repository.ts'
  - 'backend/src/usecases/{advice,rate-item,amend-verdict,withdraw-verdict,pending-verdicts}*.ts'
  - 'backend/src/routes/{advice,verdicts}.ts'
  - 'backend/tests/{advice,verdicts,ratings-gate,events,pending}*.ts'
  - 'backend/drizzle/*{events,verdict,advice}*.sql'
  - 'frontend/src/views/{AdviceView,VerdictsView}*'
  - 'frontend/src/components/{Advice*,adviceRow*,Verdict*,rating*,RatingScale*}'
  - 'frontend/src/composables/{useAdvice,useVerdictQueue}*'
  - 'frontend/src/stores/verdictDrafts*'
  - 'e2e/{advice,verdicts}.spec.ts'
---

# «Что брать», verdicts and the gates

The detail behind the gate and «Что брать» lines of `CLAUDE.md`.

## The gates: who writes the log, and what they count

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

## What «Что брать» shows, and what it refuses to (MOL-31)

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

## A withdrawn verdict

- **A withdrawn verdict is still a row (MOL-27).** `DELETE /verdicts/:itemId` sets
  `deleted_at` and erases the review; the row stays because the 0.2 gate asks whether someone
  _gave_ five ratings in two weeks, and «rated five, took one back» is still five — the
  owner's decision, with the price in view. So **the gate counts every row, and every other
  reader filters `deleted_at IS NULL`**: the verdict itself, «Что брать», the queue of
  unrated purchases and every aggregate of 0.3. A reader that forgets the filter puts a
  withdrawn opinion back on screen, silently. Rating again brings the same row back and keeps
  `rated_at`, so withdrawing and re-rating cannot move anyone in the gate.
