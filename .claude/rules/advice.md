---
paths:
  - 'packages/model/src/{entities,contracts}/{advice,verdict,events}.ts'
  - 'packages/model/src/values/gate.ts'
  - 'packages/model/src/entities/cheaper-hint.ts'
  - 'packages/model/tests/entities/cheaper-hint.test.ts'
  - 'backend/src/db/kind-word.ts'
  - 'packages/model/tests/{entities,contracts}/{advice,verdict}.test.ts'
  - 'backend/src/db/{verdicts,events,expenses}-repository.ts'
  - 'backend/src/db/gates-reader.ts'
  - 'backend/src/{gates,gates-cli}*.ts'
  - 'bin/gates.sh'
  - 'backend/src/usecases/{advice,rate-item,amend-verdict,withdraw-verdict,pending-verdicts,own-prices}*.ts'
  - 'backend/src/routes/{advice,verdicts}.ts'
  - 'backend/tests/{advice,verdicts,ratings-gate,events,pending,gates-reader}*.ts'
  - 'backend/drizzle/*{events,verdict,advice}*.sql'
  - 'frontend/src/views/{AdviceView,VerdictsView}*'
  - 'frontend/src/components/{Advice*,adviceRow*,Verdict*,rating*,RatingScale*}'
  - 'frontend/src/composables/{useAdvice,useVerdictQueue,useCheaperHint}*'
  - 'frontend/src/stores/{verdictDrafts,ownPrices}*'
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
both halves of the fraction and one number behind: `erasures`, how many of those who appeared in a
week — a Monday in Yerevan — erased themselves, with no id, no day and no foreign key (MOL-91).
Only how many: whether they had reached five would be one more fact about someone erased.

**The gates are read by `dist/gates.js` (MOL-91)** — `make gates FROM=…` in a copy — in one
`repeatable read, read only` transaction, over one window `--from`/`--to` for both halves: a day is
Yerevan's and `--to` takes it in whole, a moment needs its offset. **Every share stands beside its
`n`** — the cohort is «as many as we find», so «2 of 10» must not read as a sentence — and the stop
lines (`GATE_RATINGS_STOP_PERCENT`, `GATE_RETURN_STOP_PERCENT`) are printed while no verdict is;
the share is rounded down to a tenth, so 19.96 % never stands over «stop below 20» as 20.0.
**Gate 0.3 closes its window as 0.2 does**: someone whose fourth week is not over is not in the
cohort — counted, a person who came last week read as one who did not come back, and the more
people arrived the harder the gate leaned towards «stop». **Time first, access after**: whoever's
fourth week is not over is waiting, with access or without — it can still be granted — and «no
access in week 4» is said only of a week that is over (adversarial А: judged by today's access, a
newcomer read «no access» eighteen days early). Those waiting, those without access and the erased
of the weeks the window touches are each a line of their own, in neither fraction.
**The login's funnel is the third block** (MOL-68, rules in `auth.md`): the logins begun on the days
the window touches — not the people who appeared, since those lost at the door never appear — with
«began» (starts less a device's repeats), «got in» and «lost» beside their `n`, the line
`LOGIN_SECOND_WAY_PERCENT` (25 %) printed and no verdict. **The share of «lost» is rounded up**, the
mirror of the gates' rounding down: that line fires _above_, and 25.09 % printed «25.0 %» sat on it
(review Б) — each share leans towards its own line's side. Where they were lost is counted in
requests, so it need not add up to «lost»; logins still inside their five minutes are «still under
way», a line of their own and not in «lost» — below zero only with outcomes whose start was never
counted, a request an older image made after a rollback, and then it adds nothing to «lost»
(round 2, Р5); above zero it also holds for good a request erased mid-login, which ends in no
outcome at all, and the line says so (Р4). The three are one difference and cannot be told apart
— `login_days` does not know whose start was counted — so on the day of a rollback, logins under
way and outcomes of uncounted starts cancel out: the line reads 0 and the ones under way count as
lost (adversarial round 3, Т3). Named, since it needs a rollback. **Both edges of the window cut a repeat
from its beginning**: begun before `--from` and in after it, «lost» may go below zero; begun on
the last day and in on the next, it is a loss inside the window (review В2). Printed as they are.
Then a row per day that counted anything.

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
- **A place's price is the last one paid there, not the lowest ever** (MOL-166, the owner's
  decision of MOL-92, В-3: «цены в магазинах подниматься могут, а вот спускаются редко»). Where
  this person bought, it is **their own last purchase, in either mode** — by `latestFirst`, the one
  fragment «Тут дешевле» reads too, and in the phone's zone the request names: under the minimum
  the sheet said «Зовуни 600» and the home «Дешевле всего: Зовуни 540» of one milk, and an August
  discount pointed at a shop that no longer sold at it. **A place opened by other people is the
  lower median of each buyer's own last price there** (В-1): the last purchase of a place is the
  receipt of whoever bought last, read as it is by anyone looking twice, and the median of three
  people's figures is a price someone paid without naming who was there yesterday. The moving
  picture stays the known limit it was under the minimum. Places are ordered by this price, own
  city first. **Р-4 still weighs a pair by every purchase in it, in every place**
  (`pairObservations`, adversarial Д, owner's decision) — the places a pair names are fewer, and
  weighed by them one pack in a shop bought by the kilo for ten weeks turned the row to pieces and
  hid the market where the kilo is cheaper. `observations` of a place is its purchases in the pair.
  A place whose last purchase is in another pair is not lost: it follows on the row (below).
  **«Last» is the place's, not the pair's** (adversarial А, owner's decision): a place is named
  by its last purchase in whatever currency and unit it was made, and a pair it was not made in is
  not that place's price at all — three August kilos at a discount stood under «Дешевле всего»
  for a shop where a pack was bought in September, and with access a place one bought packs in was
  named by strangers' kilos. A buyer's last is decided before the threshold of three filters
  (`place_last`, `mine_here` in `pricedRows`), and a pair of a place opened by others needs three
  buyers whose last purchase there is in it. **Other people's last purchases count for
  `SHARED_PRICE_FRESH_DAYS` (90) days** (adversarial Б, owner's decision), by the record's day in
  the phone's zone; fewer than three within the window and the place is closed. One's own has no
  window (В-1). Its «today» is the phone's (`TODAY_HEADER`), as every «today» of the server is.
  The prices, named: two who bought at a discount fifty days ago and never came back
  still hold the place at the discount while the one who goes there now sees today's on their own
  screen (Б1 of the adversarial report — the window closes it only past ninety days); a place one
  bought at last year shows one's own year-old price over three strangers' of this week (Б2, В-1).
- **The threshold of «только если дёшево» is the lower median, from three purchases**
  (`PRICE_MEDIAN_MIN_OBSERVATIONS`, MOL-33's answer) — `percentile_disc(0.5)`, a price someone
  actually paid, the same rule `isRateJump` follows. Fewer than three and the field is `null`,
  which the contract requires the server to say rather than omit.
- **One «currency + unit» per item comes first, the one with the most observations**, ties
  broken by the latest purchase (MOL-31, Р-4). Two prices in different currencies have no common
  ground without a rate, and a rate belongs to one trip and one day, so they are never compared:
  the threshold and the superlative stay inside the first pair. **The places of the other pairs
  follow it, each with its own unit** (MOL-166, adversarial Е, owner's decision) — before, they
  were never shown at all, and once a place is named by its last purchase alone that hid the shop
  of every week behind one pack while the row named a market bought at once a year ago. **A pair
  with a place in the asker's own city comes first, whatever it weighs** (Р-26 across pairs,
  adversarial Ж): three kilos in an Erevan shop headed a Gyumri resident's row over the market of
  their own city. **Any place of another pair on the row takes «Дешевле всего» away** (adversarial
  З, owner's decision): «Дешевле всего: Рынок 2 400 ֏/кг» over «Пятёрочка 300 ₽/кг» read as a lie,
  whatever the word compared. **A place of another pair stands on the row only while its last
  purchase is within `SHARED_PRICE_FRESH_DAYS`** (adversarial И, owner's decision; the first pair
  has no window, В-1): a cheese bought once in Moscow two years ago stayed under «Ещё» for good and
  took the word with it. **«Ещё» is own city first across pairs too** (Р-26, adversarial Ж′). The
  price of Р-27, named (owner's decision on review №10): the first pair also gives the threshold of
  «только если дёшево», so one pack bought at home over ten kilos in Erevan leaves the row without a
  threshold until the pack's pair has three purchases.
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

## The search on «Что брать» (MOL-128)

**The home of the app is «Что брать», with a search at its top** — at the shelf a person looks an
item up rather than scrolls. The field is in the page and scrolls with it, never pinned, and is
there only over a list: loading, a failure and the newcomer have none (the newcomer's search could
only ever answer «not rated yet», and would teach that it is useless).

- **The answer for what is found is the server's, never glued on the phone** (`GET /advice/search`,
  В-1). The list is cut at `ADVICE_LIMIT`, so an item rated past the cut would read «ещё не
  оценивали» over a verdict it has, and gluing is logic on the phone besides. The use case searches
  the catalogue exactly as «Что взяли?» does (`items.search`, `SEARCH_LIMIT`) and hands the items
  found to the list's own statement (`adviceRowsFor` with `itemIds`) and the list's own `describe` —
  so the mode, the threshold of three and «no price on „не брать нигде“» cannot drift between the
  list and the search. An item nobody may be shown a verdict for — a stranger's lone one below the
  threshold — is `null`, «ещё не оценивали», as the list leaves it out.
- **What is rated is not cut by the limit of the search** (adversarial А): the first `SEARCH_LIMIT`
  found, as «Что взяли?» shows them, and past them every near one — each word within one edit
  (`nearIds`) — with a verdict in sight. «Сыр» is 24 names in the seed; cut at twenty before the
  verdicts were asked, the cheese rated «не брать нигде» went missing and twenty «Оценить» stood in
  its place. Far ones past the limit stay out: they are the catalogue's guesses.
- **A row found carries the scope of the search's answer**, and the verdict sheet opened from it
  reads that one, not the list's (adversarial Е): access may open or run out between the two, and
  an average of three was offered pre-chosen as one's own score.
- **After a save the search is asked again quietly** — the answer stays, dimmed — and the field
  that comes back over a list asked again searches what it holds (adversarial Г, Д).
- **It writes nothing** (В-2): no `advice_viewed` — the one writer stays `GET /advice`, which the
  screen asks for whenever it opens and whenever the connection comes back, and the field is not
  shown without a list; the one visit missed (the list failed, the search then worked) errs towards
  «stop». And no pick into `search_picks`: a pick teaches the entry of a purchase, and nothing was
  bought here.
- **The found are laid out by the list's groups and shapes, «Ещё не оценивали» last**; inside a
  group, in the order of the search. «Не брать нигде» has no price and no place here either, and no
  tail «Цены нет намеренно». No «Предложить товар»: nothing was bought. «Оценить» on an item not
  rated opens the verdict sheet without a place (MOL-27).
- **Offline it searches the remembered list on the phone** (В-3, `searchRemembered`): every word
  typed must start a word of the name, as typed or by the domain's `toSearchKey` with «ц» spelt
  out — so transliteration holds, «дет» starts «Детское» (`deцkoe`) and «mat» starts «Мацун», and
  typos and synonyms, which are Postgres's, do not (review Р-9). The word still being typed may
  end halfway through a Latin fold — «k» of «kh», «shc» of «shch», «c» the next letter decides — and
  is also the start of what that tail may still become (`unfinishedFoldSpellings`, review Р-23):
  «Хачапури» is `hachapuri`, and «k» dropped it for one keystroke. The tail is spelt out, never cut
  off: cut, «k» started every name and «sok» found «Соль» (review Р-26, adversarial Н). The tails are
  read from the key's own table, never copied. «yo» against «Ёжик» (`ejik`) is the key's rule, not
  the filter's. The strip says the
  search is the list's only, as of its age.

## «Тут дешевле» on the sheet of a purchase (MOL-92)

**The person types a price and sees where they paid less** — the reason to enter a price and not only
a rating, given back the moment it is typed. `GET /advice/prices?item=&country=&city=[&except=]`
answers, `cheaperHint` of the domain says which line to show against what is typed. The owner's
decisions of 02.10.2026 are В-1…В-10 of `requirements/MOL-92.md`.

- **Only one's own purchases** (В-1 of the 0.2 round, 26.09.2026): with access or without, the same
  answer. Other people's prices by city are an aggregate, and aggregates are 0.3's hypothesis. Family
  (MOL-88) joins when it exists, by one condition on the rows.
- **A place's price is the last one paid there, not the lowest** (В-3, the owner's comment: «цены в
  магазинах подниматься могут, а вот спускаются редко»). Last by the record's own day as the phone
  named it (MOL-121), then the moment it began, then the moment the row was written; the day printed
  is that purchase's. **One row a place, in the currency and unit of that last purchase** (MOL-166,
  adversarial А): a price typed by the kilo is compared only with places whose last purchase was by
  the kilo — the August kilo of a shop where a pack was bought since is no longer said. The price,
  named (adversarial Д2): a pack typed first in a record and the kilo after it — the kilo of this
  very shop is no longer said either, until a kilo is its last purchase again. **«Что брать» names
  the same price** (MOL-166), by the same fragment (`latestFirst`) — a test asks both about one
  place.
- **Only the city of the record** (В-4): a cheaper Erevan receipt is no action at a Gyumri shelf.
  **The server reads it off the record's place** (`trip=`, review №1): `TripView` carries no city,
  and the settings are not the record — a Gyumri resident pressing «Записать покупки» in an Erevan
  shop with a signal had the settings' Gyumri asked for until this was the rule. Only a record still
  in the queue, which the server has never seen, is named by the country and city its start carries.
  A record not the asker's, removed or missing answers empty with `where: null`. The answer names
  the city it was counted in, and the phone keeps it per record for no signal — **and a start put in
  the queue keeps its own** (adversarial А′): a record started at the door with a signal is the
  server's before its first sheet, and with none inside nothing else would know its city. The
  remembered city is folded as a place's name is (review №7): a place keeps the spelling it was first
  written with, the settings their own.
- **«Не брать нигде» says nothing** — the answer is a union on `level`, and `never` has no field for a
  price, a place or an alternative. **The level and the ratings are the person's own verdicts, with
  access or without** (owner's decision on adversarial Д, 02.10.2026, over Р-10): read in the shared
  mode, three strangers' «1» hid the prices of an item the person rated «5», and three strangers' «5»
  offered an item they never rated — an average in the hint, which is 0.3's. Read by the same
  `adviceRowsFor` and `describe` as «Что брать», in its own mode. With access the two may disagree:
  the screen says the town's «не брать нигде», the sheet the person's own «5» — named, on purpose.
  A withdrawn verdict is no verdict: prices again.
- **Another item of the kind** (В-3, В-7…В-9): one's own products bought with a price in the city
  whose word of the kind is the item's (`kindKey`, MOL-45 — the SQL spelling is `kindAt`, one
  fragment for the search and for this). Shown when strictly cheaper than the price typed — before
  one is, than the item's own cheapest — and rated no worse by the printed tenth (Р-22); beside an
  item not rated, only one in «Брать» (В-8); an unrated alternative never (Р-11). Of those that
  qualify, the best rated, the cheapest breaking a tie — «если Марианна дешевле, но оценена ниже,
  показываем Анелик» (В-9). The server sends at most `OWN_ALTERNATIVES_MAX`, best rated first, since
  which one qualifies depends on what is typed. **The word of the kind is coarser than a category**:
  «Сыр плавленый» is an alternative to «Сыр Лори»; «оценено не хуже» is what holds it, and embeddings
  (MOL-87) may replace the word. «Молоко Марианна 3.2» and «… 3.2%» are two items until MOL-87 merges
  them — a second rule of identity here would be a second place that decides (Р-14).
- **Only products** (Р-1): a dish is the venue's own, and «cheaper in another restaurant» is another
  dish. An item the catalogue does not hold has the same empty answer.
- **The comparison is the domain's, called by the phone** — the one extension of MOL-24's exception:
  the server sends prices, it cannot know what is being typed. Unit prices of past purchases are the
  server's (SQL, `UNIT_PRICE_SCALE`); compared only inside one currency and unit, the typed price's
  own. **Two prices are one within half a per cent, or within what the till's rounding of both sums
  can move** (`samePrice`, adversarial Г, Г′): loose goods are weighed and a sum is typed whole, so one
  tag of 690 ֏/кг came out 689,63 and 690,67, and 0,15 kg — 104 ֏ for 103,50 — 693,33; compared exactly
  it read «дороже» in yellow or «дешевле» in green by the weight. Half the step a till rounds a sum to
  (`TILL_STEP_MINOR`, a property of the currency like its exponent), on each sum, spread over what was
  bought: the past purchase's quantity travels with its price. A whole dram, since a shop rounds the
  hundredths away; a whole rouble, since people type roubles without kopecks (owner's decision,
  02.10.2026); a cent for dollars and euros — half a euro on a litre made €1,79 «как» €1,19
  (adversarial Г″, review №8). An
  alternative must be cheaper by more than that. «Last» for a record from an old queue is its moment
  read in the request's zone — the zone its printed day is counted in (review №3) — and a zone
  Postgres does not know, though `Intl` does, is read as Yerevan's rather than answering 500
  (adversarial Ж).
- **It writes nothing**: no `advice_viewed`, no pick. The person looks at their own prices.
- **A hint, not a screen**: no loading, no error. With a signal it waits for the server — a
  remembered answer may predate a verdict given since. With none, **or when the connection goes
  while the answer is on its way** (decided after the failure, MOL-19, adversarial А), the last
  answer for the item in the record's city remembered on the device (`molvia.own-prices.<owner>`, a
  hundred items, the city of the last twenty records, В-5) — never for an amendment, whose
  remembered answer may hold the row itself (`except`, Т-9). A refusal that is the API's own word
  shows nothing.
- **What the phone hears of «не брать нигде» lets go of every remembered answer naming the item**,
  as itself or as an alternative (adversarial Б): a verdict given on this phone, the answer of the
  hint itself, and every answer of «Что брать» — the list the app opens on, so a «1» given in the
  bot's reminder is heard at the next launch with a signal. **One's own «не брать», as the hint
  reads**: without access the list's levels are one's own; with access they are an average, so the
  phone asks `GET /verdicts/never` (adversarial Б′) — a field added to the list would be refused by
  every older client — and a town's «1» over one's own «5» lets nothing go (review №6). **An answer asked before a verdict let
  something go is not remembered, whenever it lands** (adversarial В). The price, named: a verdict
  given elsewhere is not heard while the phone stays offline, and a rating moved within «Брать» or
  «Только если дёшево» lets nothing go.
- **It lives in the box of the unit price** (В-6). The sheet stands on the bottom of the screen, so
  a line coming in lifts the fields above it: **it grows over frames through `AppReveal`, never in
  one** (adversarial Е, MOL-151), and follows what is typed only once typing pauses
  (`HINT_SETTLE_MS`) — each keystroke of «620» crosses a price, and a line came and went under the
  finger with each. **A line that says something else goes and comes too** (keyed by its words,
  adversarial Е′): changed in place from one line to two, it lifted the price by 17 px in a frame. Never red — red is «не брать нигде». Read out with the unit price, after the
  same pause, through the one live region.

## A withdrawn verdict

- **A withdrawn verdict is still a row (MOL-27).** `DELETE /verdicts/:itemId` sets
  `deleted_at` and erases the review; the row stays because the 0.2 gate asks whether someone
  _gave_ five ratings in two weeks, and «rated five, took one back» is still five — the
  owner's decision, with the price in view. So **the gate counts every row, and every other
  reader filters `deleted_at IS NULL`**: the verdict itself, «Что брать», the queue of
  unrated purchases and every aggregate of 0.3. A reader that forgets the filter puts a
  withdrawn opinion back on screen, silently. Rating again brings the same row back and keeps
  `rated_at`, so withdrawing and re-rating cannot move anyone in the gate.
- **The rating reminder asks about a withdrawn item only for a purchase after the withdrawal**
  (MOL-101, В-3 — the answer MOL-29 left for the bot). The queue of «Оценки» shows every purchase
  without a live verdict, as it did; the bot, which writes to the person unasked, skips a purchase
  made before the verdict on that item was withdrawn — the person had their say on it and took it
  back — and asks about one made after, a new experience. The reminder's own rules are in
  `bot.md`.
