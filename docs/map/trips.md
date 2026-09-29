# Map · Trips, the queue on the device, settings

Rules: `.claude/rules/trips.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/settings.ts` — Contract of the four settings (country, city, two currencies): `SETTINGS_CITIES`, `geographyAllowed`, the update body with its base.
- `packages/model/src/contracts/trip.ts` — Wire contract of trips: start/add/finish/restore/rate-choice bodies, `deviceIdSchema`, trip view and history codecs, recent places.
- `packages/model/src/entities/expense.ts` — Entity of a trip purchase: item required, quantity and amount optional; the new-row and patch schemas.
- `packages/model/src/entities/place.ts` — Entity of a place (shop or venue) with its country and city; the schema a new place is named by.
- `packages/model/src/entities/trip.ts` — Entity of a trip: rate snapshot and rate choice, `TRIP_UNDO_MINUTES`, the effective rate, staleness, totals and conversion.
- `packages/model/src/values/geo.ts` — Value schemas of a country code and a city name.
- `packages/model/src/values/place-identity.ts` — When two spellings name one place, the TypeScript twin of the database's place index. Tests: `backend/tests/place-identity.integration.test.ts`.

## backend · routes

- `backend/src/routes/places.ts` — Route `GET /places/recent`: the person's recent shops, optionally filtered by country and city.
- `backend/src/routes/settings.ts` — Route `PUT /actors/me/settings`: saves the four settings and answers with the actor.
- `backend/src/routes/trips.ts` — Routes of `/trips`: start, current, history, one trip, purchases, finish, remove, «Вернуть», rate choice.

## backend · usecases

- `backend/src/usecases/choose-trip-rate.ts` — Use case «По какому курсу считать» after a jump: the new rate, the previous one, or the person's own.
- `backend/src/usecases/current-trip.ts` — Use case: the unfinished trip the «Поход» screen opens on (or null), and one trip selected by id.
- `backend/src/usecases/recent-places.ts` — Use case: the last few places «Начать поход» offers to tap (`RECENT_PLACES`).
- `backend/src/usecases/remove-trip.ts` — Use cases «Удалить поход» (marks the trip) and «Вернуть» (back, optionally finished). Tests: `backend/tests/trip-removal.integration.test.ts`.
- `backend/src/usecases/save-settings.ts` — Use case: saves the settings form against its base, and lets frozen months go when a currency changes.
- `backend/src/usecases/start-trip.ts` — Use case «Начать поход»: settles the place from the trip's context and snapshots the person's or the cached official rate.
- `backend/src/usecases/trip-expenses.ts` — Use cases of a trip's purchases: add (with the remembered search pick), amend, remove, and «Завершить поход».
- `backend/src/usecases/trip-view.ts` — The one builder of a trip as every trip route answers it: place, rows and items in three reads.

## backend · db

- `backend/src/db/expenses-repository.ts` — Repository of purchases: rows of a trip, unrated ones, and the price queries (cheapest, median) «Что брать» reads.
- `backend/src/db/places-repository.ts` — Repository of places: `ensure` one shop per name, reads by id, and the person's recent places.
- `backend/src/db/settings-repository.ts` — Repository of the settings: one conditional `UPDATE` of the actor row against the form's base. Tests: `backend/tests/settings.integration.test.ts`.
- `backend/src/db/trips-repository.ts` — Repository of trips: start, lock, current, history page, finish, rate choice, mark, restore, purge. Tests: `backend/tests/trip-rules.integration.test.ts`.

## backend · tests

- `backend/src/usecases/trips.test.ts` — Use-case test of start, current, recent places, add/amend/remove and finish: rates snapshotted, repeats, picks, IDOR.
- `backend/tests/place-identity.integration.test.ts` — Integration test: `placeNameIdentity` agrees with the database's place index across a corpus of spellings.
- `backend/tests/settings.integration.test.ts` — Integration test: settings saved without overwriting another device, and a queued trip keeps the geography it started with.
- `backend/tests/trip-history.integration.test.ts` — Integration test: history of finished trips is private, ordered by the device's finish time, and paged by its cursor.
- `backend/tests/trip-removal.integration.test.ts` — Integration test: a removed trip is hidden from every reader, «Вернуть» works for ten minutes, the timer purges after.
- `backend/tests/trip-rules.integration.test.ts` — Integration test of the repositories: one open trip per person, device ids as repeats, races, finish, one transaction.
- `backend/tests/trips-hardening.integration.test.ts` — Integration test of the adversarial cases: huge unit prices, concurrent totals, id case, edit/remove races, invisible marks in place names.
- `backend/tests/trips.integration.test.ts` — Integration test of a trip through HTTP: totals and unit prices, repeats, «trip open», IDOR, recent places, picks and rates.

## frontend · views

- `frontend/src/views/FinishedTripView.vue` — «Завершённый поход» screen: a finished trip's purchases, adding and amending them, and «Удалить поход».
- `frontend/src/views/SettingsView.vue` — «Настройки» screen: the four settings with draft and conflict notices, and links to devices, «Выйти» and privacy.
- `frontend/src/views/TripHistoryView.vue` — «История походов» screen: finished trips page by page, with the «Вернуть» strip after a removal.
- `frontend/src/views/TripView.vue` — «Поход» screen: the current trip's rows, total, finish/remove, refused writes, «Уже открыт поход» choice, or `TripHome` without a trip.

## frontend · components

- `frontend/src/components/ItemDetailsSheet.vue` — Sheet «сколько, в чём, почём» every purchase goes through; writes to the trip queue and closes at once.
- `frontend/src/components/SettingsFields.vue` — The settings fields (country, city, two currencies) with «changed» marks; shared by «Настройки» and the trip-context sheet.
- `frontend/src/components/StartTripSheet.vue` — Sheet «Где вы?»: recent shops and a field for a new one; queues «Начать поход».
- `frontend/src/components/TripContextSheet.vue` — Sheet «Уточните город и валюты похода» for a trip the old app started, holding the queue until confirmed.
- `frontend/src/components/TripHistoryRow.vue` — One finished trip as a row: place, when finished, whether the finish still waits; used in history and on the home screen.
- `frontend/src/components/TripHome.vue` — «Поход» with no trip going on: the newcomer introduction, or last trips and purchases waiting for a verdict.
- `frontend/src/components/TripRateNotes.vue` — Notes about the rate a trip counts by: it jumped, it is not the central bank's, or the bank has been silent.
- `frontend/src/components/TripRateSheet.vue` — Sheet «По какому курсу считать» after a jump: new, previous or own rate, sent directly rather than queued.
- `frontend/src/components/TripRemoveSheet.vue` — Sheet «Удалить поход?»: names the shop, the day and how many rows go.
- `frontend/src/components/TripRow.vue` — One purchase line of a trip: item, quantity, price and price per unit, with its queue mark.
- `frontend/src/components/TripTotal.vue` — «ИТОГО» of a trip: the server's total, its estimate in the income currency, the rate and the flip of the two.
- `frontend/src/components/TripUndoStrip.vue` — Strip «Поход удалён · Вернуть» on every screen a removed trip lands on, ten seconds from the removal.
- `frontend/src/components/tripRow.ts` — Type of one trip line (`TripRowView`, `RowMark`) built by the screen and drawn by `TripRow`.

## frontend · composables

- `frontend/src/composables/useCurrentTrip.ts` — Composable: the trip going on, from the store's last answer and the queue's unsent start/finish.
- `frontend/src/composables/useFinishedTrip.ts` — Composable behind «Завершённый поход»: rows, amending, adding, removal and the refused-write notices.
- `frontend/src/composables/useItemDetails.ts` — Composable: the state of «сколько, в чём, почём», parsed as typed, with unit price and estimate from the domain.
- `frontend/src/composables/useSelectedTrip.ts` — Composable: one trip chosen by id, from the history cache and the server, with loading, missing and offline states.
- `frontend/src/composables/useSettings.ts` — Composable and store of the settings form: draft kept per account, base, conflict per choice, save and its notices.
- `frontend/src/composables/useTripContext.ts` — Composable behind the trip-context sheet: a draft of the settings handed to the queue for the held trip.
- `frontend/src/composables/useTripHistory.ts` — Composable behind the history and the home screen's last trips: rows, paging, reload after a moved list.
- `frontend/src/composables/useTripRows.ts` — Composable: a trip's rows merged with what the queue still holds (waiting, editing, removing).

## frontend · stores

- `frontend/src/stores/queueing.ts` — What every on-device queue shares (trip, verdicts, spendings): the holding codes, write keys, cross-window lock, doubling retry.
- `frontend/src/stores/recentPlaces.ts` — Store: the shops this identity went to, kept on the device for «Начать поход» without a signal.
- `frontend/src/stores/settingsMemory.ts` — The last known settings of an identity, remembered on the device and read back.
- `frontend/src/stores/trip.ts` — Store: the trip as the server last answered it, remembered per identity and read leniently across builds.
- `frontend/src/stores/tripHistory.ts` — Store: the history cache, local snapshots of finishes not yet confirmed, and the «answered empty» flag.
- `frontend/src/stores/tripQueue.ts` — Store: the on-device queue of every write to a trip (start, purchases, finish, removal, «Вернуть», payment), sent in order.

## e2e

- `e2e/item-details.spec.ts` — End-to-end: a purchase typed in the sheet becomes one priced row on the server, with a double tap and with no connection.
- `e2e/settings.spec.ts` — End-to-end: the settings draft survives tabs and offline, conflicts show, and an offline or old-app trip keeps its context.
- `e2e/trip-history.spec.ts` — End-to-end: history paging, editing an old trip, offline finishes kept across reload, removal from a finished trip.
- `e2e/trip.spec.ts` — End-to-end: a trip started, filled, corrected, finished, removed and brought back, offline too; the home screen without a trip.
