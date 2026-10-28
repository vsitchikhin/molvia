# Map · Trips, the queue on the device, settings

Rules: `.claude/rules/trips.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/settings.ts` — Contract of the four settings (country, city, two currencies): `SETTINGS_COUNTRIES` and `COUNTRY_CITIES` (Armenia, Georgia, Serbia, MOL-109), `settingsCityOf` (the settings' city a stored spelling folds to, MOL-120), `geographyAllowed`, `firstGeography` (a newcomer's by the phone's zone), the update body with its base.
- `packages/model/src/contracts/trip.ts` — Wire contract of trips: start/add/finish/restore/rate-choice bodies, `deviceIdSchema`, trip view and history codecs (a history row with `itemCount` and `total`, MOL-128), recent places.
- `packages/model/src/entities/expense.ts` — Entity of a trip purchase: item required, quantity and amount optional; the new-row and patch schemas.
- `packages/model/src/entities/place.ts` — Entity of a place (shop or venue) with its country and city; the schema a new place is named by.
- `packages/model/src/entities/trip.ts` — Entity of a trip: rate snapshot and rate choice, `TRIP_UNDO_MINUTES`, the effective rate, staleness, totals and conversion.
- `packages/model/src/values/geo.ts` — Value schemas of a country code and a city name, and the time zone a country's day is read in (MOL-101).
- `packages/model/src/values/place-identity.ts` — When two spellings name one place, the TypeScript twin of the database's place index; and `cityWhereNameRepeats` (MOL-120), the one rule for when a place is printed with its city. Tests: `backend/tests/place-identity.integration.test.ts`.

## backend · routes

- `backend/src/routes/places.ts` — Route `GET /places/recent`: the person's recent shops, optionally filtered by country and city.
- `backend/src/routes/settings.ts` — Route `PUT /actors/me/settings`: saves the four settings and answers with the actor.
- `backend/src/routes/trips.ts` — Routes of `/trips`: start, current, history, one trip, purchases, finish, remove, «Вернуть», rate choice, receipt's sum.

## backend · usecases

- `backend/src/usecases/choose-trip-rate.ts` — Use case «По какому курсу считать» after a jump: the new rate, the previous one, or the person's own.
- `backend/src/usecases/current-trip.ts` — Use case: the unfinished trip the record typed by hand opens on (or null), and one trip selected by id.
- `backend/src/usecases/recent-places.ts` — Use case: the last few places «Где вы?» offers to tap (`RECENT_PLACES`).
- `backend/src/usecases/remove-trip.ts` — Use cases «Удалить запись» (marks the trip) and «Вернуть» (back, optionally finished). Tests: `backend/tests/trip-removal.integration.test.ts`.
- `backend/src/usecases/save-settings.ts` — Use case: saves the settings form against its base, and lets frozen months go when a currency changes.
- `backend/src/usecases/start-trip.ts` — Use case: a trip started — the record typed by hand — settles the place from the trip's context and snapshots the person's or the cached official rate.
- `backend/src/usecases/trip-expenses.ts` — Use cases of a trip's purchases: add (with the remembered search pick), amend, remove, «Сумма по чеку», and «Закончить».
- `backend/src/usecases/trip-view.ts` — The one builder of a trip as every trip route answers it: place, rows and items in three reads.

## backend · db

- `backend/src/db/expenses-repository.ts` — Repository of purchases: rows of a trip, unrated ones — for the reminder, by days and not before a withdrawal (MOL-101) — the price queries (cheapest, median) «Что брать» reads, and the person's own last prices and items of a kind «Тут дешевле» reads (MOL-92).
- `backend/src/db/places-repository.ts` — Repository of places: `ensure` one shop per name, reads by id, and the person's recent places.
- `backend/src/db/settings-repository.ts` — Repository of the settings: one conditional `UPDATE` of the actor row against the form's base. Tests: `backend/tests/settings.integration.test.ts`.
- `backend/src/db/trip-money.ts` — A trip's money in SQL (MOL-78): the receipt's sum, else the priced purchases per currency — the one fragment «Записаны», the month and the accounts read. Tests: `backend/tests/trip-receipt.integration.test.ts`.
- `backend/src/db/trips-repository.ts` — Repository of trips: start, lock, current, history page with each row's count and sums, finish, rate choice, receipt's sum, mark, restore, purge. Tests: `backend/tests/trip-rules.integration.test.ts`.

## backend · tests

- `backend/src/usecases/trips.test.ts` — Use-case test of start, current, recent places, add/amend/remove and finish: rates snapshotted, repeats, picks, IDOR.
- `backend/tests/place-identity.integration.test.ts` — Integration test: `placeNameIdentity` agrees with the database's place index across a corpus of spellings.
- `backend/tests/settings.integration.test.ts` — Integration test: settings saved without overwriting another device, and a queued trip keeps the geography it started with.
- `backend/tests/trip-history.integration.test.ts` — Integration test: history of finished trips is private, ordered by the device's finish time, paged by its cursor, each row counted and summed per currency.
- `backend/tests/trip-receipt.integration.test.ts` — Integration test: «Сумма по чеку» through HTTP, and every reader of a trip's money — the trip, «Записаны», the month, the accounts, the hint of an exchange — saying one thing.
- `backend/tests/trip-removal.integration.test.ts` — Integration test: a removed trip is hidden from every reader, «Вернуть» works for ten minutes, the timer purges after.
- `backend/tests/trip-rules.integration.test.ts` — Integration test of the repositories: one open trip per person, device ids as repeats, races, finish, one transaction.
- `backend/tests/trips-hardening.integration.test.ts` — Integration test of the adversarial cases: huge unit prices, concurrent totals, id case, edit/remove races, invisible marks in place names.
- `backend/tests/trips.integration.test.ts` — Integration test of a trip through HTTP: totals and unit prices, repeats, «trip open», IDOR, recent places, picks and rates.

## frontend · views

- `frontend/src/views/FinishedTripView.vue` — «Записанные покупки» (`/purchases/:id`, MOL-207): named by its place, «город · день, время» under it, the purchases, the total as the card of the record typed by hand under them, «+ Сумма по чеку», «Добавить позицию» and «Удалить запись» after it; one `StatusStrip` of the connection, the answer's skeleton.
- `frontend/src/views/PurchasesView.vue` — «Покупки» tab (MOL-128): the record going on first, «ждут оценки», «Записаны» with count and sum, rows of the kit (`ListRow`, MOL-204), one `StatusStrip` over what a failed read drew from memory, dated by the older such read, the receipts' own quiet card with none of them shown, «Раньше … — со связью» offline, «Записать покупки» in the strip, four states.
- `frontend/src/views/SettingsView.vue` — «Настройки» screen: the four settings with draft and conflict notices, links to devices and «Выйти», and the group «Ваши данные» (`YourDataGroup`).
- `frontend/src/views/TripView.vue` — The record typed by hand (`/purchases/manual`, MOL-128): named by its place, rows, the total as a card under them, «Удалить запись»; the strip «Штрихкод · + Позиция · Закончить» (MOL-206), one `StatusStrip` of the connection, the queue's notices over the skeleton; goes up to «Покупки» once no record is open.

## frontend · components

- `frontend/src/components/ManualEntryButton.vue` — «Записать покупки»: «Где вы?» with no record open, «Уже записываете — продолжить / закончить и начать новую» with one; on «Покупки» and the newcomer's «Что брать» — there, with receipts, a row of the kit in a card of its own (`row`, MOL-203).
- `frontend/src/components/ItemDetailsSheet.vue` — Sheet «сколько, в чём, почём» every purchase goes through; writes to the trip queue and closes at once; «Тут дешевле» in the box of the unit price (MOL-92).
- `frontend/src/components/ReceiptField.vue` — The field of «Сумма по чеку» (MOL-78): one sum and its currency, shared by the sheet and the question of «Закончить».
- `frontend/src/components/ReceiptSheet.vue` — Sheet «Сумма по чеку»: typed at any time into a record open or finished, «Убрать сумму»; writes to the trip queue.
- `frontend/src/components/receipt.ts` — What was typed as «Сумма по чеку» — money above zero or nothing — and a sum put back into the field.
- `frontend/src/components/SettingsFields.vue` — The settings fields (country, city, two currencies) with «changed» marks; shared by «Настройки» and the trip-context sheet.
- `frontend/src/components/StartTripSheet.vue` — Sheet «Где вы?»: recent shops and a field for a new one; queues the start of a record, finishing or removing the open one first when asked to.
- `frontend/src/components/TripContextSheet.vue` — Sheet «Уточните город и валюты записи» for a trip the old app started, holding the queue until confirmed.
- `frontend/src/components/TripNotices.vue` — What the queue says about any record — refusals, a record open elsewhere, unsent purchases, a city to name — on «Покупки» and on the record.
- `frontend/src/components/TripRateNotes.vue` — Notes about the rate a trip counts by: it jumped, it is not the central bank's, or the bank has been silent.
- `frontend/src/components/TripRateSheet.vue` — Sheet «По какому курсу считать» after a jump: new, previous or own rate, sent directly rather than queued.
- `frontend/src/components/TripRemoveSheet.vue` — Sheet «Удалить запись?»: names the shop, the day and how many rows go.
- `frontend/src/components/TripRow.vue` — One purchase line of a trip on the kit's `ListRow` (MOL-206): item, quantity and price per unit, the amount or «—», the chevron of a row that opens, its queue mark.
- `frontend/src/components/TripTotalCard.vue` — The total of a record, open or finished, as a card under its list (MOL-206, В-17 «а»; MOL-207): what `useTripTotal` says, one line of parts, the whole card the flip.
- `frontend/src/components/TripUndoStrip.vue` — Strip «Запись удалена · Вернуть» on every screen a removed trip lands on, ten seconds from the removal.
- `frontend/src/components/tripRow.ts` — Type of one trip line (`TripRowView`, `RowMark`) built by the screen and drawn by `TripRow`.

## frontend · composables

- `frontend/src/composables/useCurrentTrip.ts` — Composable: the trip going on, from the store's last answer and the queue's unsent start/finish.
- `frontend/src/composables/useFinishedTrip.ts` — Composable behind «Записанные покупки»: the header's line, rows, amending, adding, removal, the failed reads the strip counts and the refused-write notices.
- `frontend/src/composables/useItemDetails.ts` — Composable: the state of «сколько, в чём, почём», parsed as typed, with unit price and estimate from the domain.
- `frontend/src/composables/usePendingFrom.ts` — The line under «N покупок ждут оценки»: places by name — and city, where one name stands in two (MOL-120) — never counted (MOL-77), on «Покупки» and the newcomer's «Что брать».
- `frontend/src/composables/useSelectedTrip.ts` — Composable: one trip chosen by id, from the history cache and the server, with loading, missing and offline states.
- `frontend/src/composables/useSettings.ts` — Composable and store of the settings form: draft kept per account, base, conflict per choice, save and its notices.
- `frontend/src/composables/useTripContext.ts` — Composable behind the trip-context sheet: a draft of the settings handed to the queue for the held trip.
- `frontend/src/composables/useTripHistory.ts` — Composable behind «Записаны» on «Покупки»: rows with the server's count and sums, paging, reload after a moved list (`moved`: the server answered and the page shown is its answer, `showsAnswer`, no strip), rows finished on this phone marked `onPhone`, the failed loads counted for the strip.
- `frontend/src/composables/useTripReceipt.ts` — Composable: «Сумма по чеку» of one record — the sheet, the sum still in the queue, whether it is offered, the button's one word for the open and the finished record, the rows «Закончить» and the total count.
- `frontend/src/composables/useTripTotal.ts` — What a trip's total says, for the card of either record: the server's total, its estimate in the income currency, the rate and the flip of the two; with a receipt's sum, what the prices say beside it.
- `frontend/src/composables/useTripRows.ts` — Composable: a trip's rows merged with what the queue still holds (waiting, editing, removing).

## frontend · stores

- `frontend/src/stores/queueing.ts` — What every on-device queue shares (trip, verdicts, spendings): the holding codes, write keys, cross-window lock, doubling retry.
- `frontend/src/stores/recentPlaces.ts` — Store: the shops this identity went to, kept on the device for «Где вы?» without a signal.
- `frontend/src/stores/settingsMemory.ts` — The last known settings of an identity, remembered on the device and read back.
- `frontend/src/stores/trip.ts` — Store: the trip as the server last answered it, remembered per identity and read leniently across builds.
- `frontend/src/stores/tripHistory.ts` — Store: the history cache (a row's count and sums kept, MOL-307; a trip view's money fields not, `NOT_CACHED_YET`), local snapshots of finishes not yet confirmed, the «answered empty» flag and the moment of the last answer (`answeredAt`, a key of its own, written with every page put on the shelf, MOL-204).
- `frontend/src/stores/tripQueue.ts` — Store: the on-device queue of every write to a trip (start, purchases, finish, removal, «Вернуть», payment, receipt's sum), sent in order.

## e2e

- `e2e/item-details.spec.ts` — End-to-end: a purchase typed in the sheet becomes one priced row on the server, with a double tap and with no connection.
- `e2e/settings.spec.ts` — End-to-end: the settings draft survives tabs and offline, conflicts show, and an offline or old-app trip keeps its context; the switches saved on the tap — the salary's day, the bot's messages, «Учитывать меня в статистике» — stay after a reload.
- `e2e/trip-history.spec.ts` — End-to-end: «Записаны» paging, editing an old record, offline finishes kept across reload, removal from a finished record.
- `e2e/trip.spec.ts` — End-to-end: a record started from «Записать вручную», filled, corrected, finished, removed and brought back, offline too; the newcomer's «Что брать».
