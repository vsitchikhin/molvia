# Map · «Что брать», verdicts, the event log and the gates

Rules: `.claude/rules/advice.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/advice.ts` — Wire contract of «Что брать»: `scope`, the row as a union on `level`, places with unit prices, limits, the answer, the search's answer (an item found with its row or `null`, MOL-128), and «Тут дешевле» — the person's own last prices and alternatives, a union on `level` (MOL-92).
- `packages/model/src/contracts/events.ts` — Contract of the event log: the event types, `advice_viewed` among them, each with the payload tied to its type.
- `packages/model/src/contracts/verdict.ts` — Wire contract of verdicts: the path by item, the rating and amendment bodies, the verdict card and the pending list.
- `packages/model/src/entities/cheaper-hint.ts` — «Тут дешевле» (MOL-92): `cheaperHint` — what the sheet of a purchase says of the item's own last prices and of another item of its kind, against the price typed.
- `packages/model/src/entities/catalogue.ts` — Frozen mapping of item kinds and place kinds onto the two halves of the 0.3 gate, product and venue.
- `packages/model/src/entities/verdict.ts` — Entity: a verdict, one per item, plus `verdictLevel`, `averageScore`, the level thresholds and `AGGREGATE_MIN_CONTRIBUTIONS`.
- `packages/model/src/values/gate.ts` — Values of the gates: the product/venue subject, five ratings in two weeks, the stop percentages of 0.2 and 0.3, and the login's line for a second way in.

## backend · routes

- `backend/src/routes/advice.ts` — Routes `GET /advice` (the whole «Что брать» screen, no parameters) and `GET /advice/search?q=` (MOL-128), never cached. Tests: `backend/tests/advice.integration.test.ts`, `backend/tests/advice-search.integration.test.ts`.
- `backend/src/routes/verdicts.ts` — Routes of verdicts: `PUT`, `PATCH`, `DELETE /verdicts/:itemId` and `GET /verdicts/pending`. Tests: `backend/tests/verdicts.integration.test.ts`.

## backend · usecases

- `backend/src/usecases/advice.ts` — Use cases «Что брать»: rows by verdict with prices, own or shared scope, the once-a-day `advice_viewed` in shared mode; and its search — the catalogue's answer with each item's row by the same rules, rated ones past the limit kept, no visit written.
- `backend/src/usecases/amend-verdict.ts` — Use case «Изменить оценку»: changes the score or the review of one's own verdict; nothing to change is not found.
- `backend/src/usecases/pending-verdicts.ts` — Use case «Оценки»: the person's purchases not yet rated, one card per item.
- `backend/src/usecases/rate-item.ts` — Use case «Поставить оценку»: a first or repeated verdict on any catalogue item, the body checked against the item's kind.
- `backend/src/usecases/withdraw-verdict.ts` — Use case «Снять оценку»: hides one's verdict everywhere and erases its text, the row kept for the 0.2 gate.

## backend · db

- `backend/src/db/events-repository.ts` — Repository of the event log: record, record once per day of the person's life, and the 0.3 week-four return. Tests: `backend/tests/events-repository.integration.test.ts`.
- `backend/src/db/gates-reader.ts` — Reader of both gates over one window in a read-only snapshot, with the erased counted by week, the login funnel (`login_days`) by day and the reminder counters (`reminder_days`, MOL-101). Tests: `backend/tests/gates-reader.integration.test.ts`.
- `backend/src/db/verdicts-repository.ts` — Repository of verdicts: put, amend, withdraw, the «Что брать» rows (optionally of given items, for the search) and `reachedRatings` for gate 0.2. Tests: `backend/tests/advice-verdicts.integration.test.ts`.

## backend · other

- `backend/src/gates-cli.ts` — Entry point of `dist/gates.js`: connects to the database and runs the gates command.
- `backend/src/gates.ts` — The gates command behind `make gates`: parses the window, reads gates 0.2 and 0.3, the login funnel and the reminder's lever, prints counts and dates only.

## backend · tests

- `backend/tests/advice-prices.integration.test.ts` — Integration test: the price side of «Что брать» — the lower median, three buyers to open a place, city filter and own city first.
- `backend/tests/advice-verdicts.integration.test.ts` — Integration test: the verdict rows of «Что брать» — own versus shared, three people for an aggregate, order and limit.
- `backend/tests/advice-search-seed.integration.test.ts` — Integration test: the search on «Что брать» over the real seed — a rated item past the limit of twenty is found, its «не брать нигде» too.
- `backend/tests/advice-search.integration.test.ts` — Integration test: `GET /advice/search` — transliteration and typos, a row past `ADVICE_LIMIT`, the threshold of three, no price on «не брать нигде», nothing written.
- `backend/tests/advice.integration.test.ts` — Integration test: `GET /advice` through the server — the three groups, prices, nothing of others without access, the event log.
- `backend/tests/events-repository.integration.test.ts` — Integration test: the 0.3 week-four return by cohort and access, pending windows, and recording at most once a day.
- `backend/tests/gates-reader.integration.test.ts` — Integration test: the gates reader reads both gates over one window, counts the erased, inside a read-only transaction.
- `backend/tests/pending-verdicts.integration.test.ts` — Integration test: `GET /verdicts/pending` — one card per item, latest first, rated or foreign ones out, the limit.
- `backend/tests/ratings-gate.integration.test.ts` — Integration test: gate 0.2 counts five verdicts in two weeks, withdrawn and re-rated included, and refuses open windows.
- `backend/tests/verdicts.integration.test.ts` — Integration test: rating, amending and withdrawing a verdict through the server, and what must not fire.

## frontend · views

- `frontend/src/views/AdviceView.vue` — «Что брать», the home screen (MOL-128): the search over the list, three groups by verdict, whose figures they are, a stale strip over the remembered list, the newcomer's home, the edit sheet.
- `frontend/src/views/VerdictsView.vue` — «Оценки» screen: bought and not yet rated, one card at a time, saved on the phone and sent by the app.

## frontend · components

- `frontend/src/components/AdviceCheapRow.vue` — Row of «Только если дёшево»: the rating, then the price threshold or the place where it was bought.
- `frontend/src/components/AdviceGroup.vue` — Group heading of «Что брать»: the word and badge of «Брать», «Только если дёшево» or «Не брать нигде»; «Ещё не оценивали» for the search.
- `frontend/src/components/AdviceHomeNew.vue` — «Что брать» of a newcomer (MOL-128): «Запишите первые покупки» or «Осталось оценить», the cycle of three steps, the line about trust.
- `frontend/src/components/AdviceNeverRow.vue` — Row of «Не брать нигде»: struck-through name, rating and own review, with no price or place.
- `frontend/src/components/AdviceSearch.vue` — The search on «Что брать»: the field, and what is found laid out by the list's groups and shapes, «Ещё не оценивали» last with «Оценить».
- `frontend/src/components/AdviceRating.vue` — The «4,3 из 5 · 3 оценки» figure shared by all three row forms; the count is left out in own mode.
- `frontend/src/components/AdviceTakeCard.vue` — Card of «Брать»: verdict, rating, name, and where it is cheapest at what price per unit.
- `frontend/src/components/RatingScale.vue` — The 1–5 digit scale used wherever a verdict is given or changed; a second tap takes the choice back.
- `frontend/src/components/VerdictBadge.vue` — Badge of a verdict level told apart by shape and icon, not only colour.
- `frontend/src/components/VerdictCard.vue` — One card of «Оценки»: the item, where and when it was bought, the scale and an optional review.
- `frontend/src/components/VerdictEditSheet.vue` — Sheet from «Что брать»: rate an item, change one's rating or «Снять оценку», talking to the API directly.
- `frontend/src/components/adviceRow.ts` — Helpers of «Что брать» rows: the three row types, how places read, unit price and rating text, one's own score.
- `frontend/src/components/rating.ts` — The `Score` type and the list of scale keys shared by the card of «Оценки» and the edit sheet.

## frontend · composables

- `frontend/src/composables/useAdvice.ts` — Composable: the «Что брать» answer split into groups, remembered on the phone, with stale and city-change states.
- `frontend/src/composables/useAdviceSearch.ts` — Composable: the search on «Что брать» as it is typed — the server's answer, the rhythm of the catalogue search, the remembered list searched offline.
- `frontend/src/composables/useVerdictQueue.ts` — Composable: the queue of «Оценки» as the phone sees it — server order, saved drafts hidden, refusals first, «Не сейчас».

## frontend · stores

- `frontend/src/stores/verdictDrafts.ts` — Store: verdicts saved on the phone and not yet confirmed, a map by item, sent at start, online and on return.

## e2e

- `e2e/advice.spec.ts` — End-to-end: a rating becomes a «Что брать» row with place and price, a bad one has none, the newcomer, offline, error, amend, the search.
- `e2e/verdicts.spec.ts` — End-to-end: «Оценки» rates purchases one by one, puts one off, and sends ratings made offline once the connection is back.

## repository

- `bin/gates.sh` — Script behind `make gates`: reads gates 0.2 and 0.3 and the login funnel from this copy's database for a window.
