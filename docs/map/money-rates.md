# Map · Money: rates, exchanges, incomes

Rules: `.claude/rules/money-rates.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/exchange.ts` — Wire schemas of «Обмен денег»: the exchange body and amendment, the rate preference, the screen's answer with wallet and costs.
- `packages/model/src/contracts/income.ts` — Wire schemas of «Доходы»: the income body and amendment, one income's view, the answer grouped by month.
- `packages/model/src/entities/exchange.ts` — Exchange entity and the wallet: currency costs along the chain, own rates, difference from the official rate, the «сколько было до» hint.
- `packages/model/src/entities/income.ts` — Income entity: the closed list of sources, the undo window, and the per-month sums per currency.
- `packages/model/src/values/rates.ts` — Exchange-rate value: six-digit scale, sources and providers, jump rule, Yerevan days, `latestDay` — the latest day on Earth, the bound of «not in the future» (MOL-121) —, freshness, picking the official rate, `formatRate`.

## backend · routes

- `backend/src/routes/exchanges.ts` — HTTP of «Обмен денег»: `/exchanges` read, record, amend, remove, restore, and `PUT /actors/me/rate-preference`.
- `backend/src/routes/incomes.ts` — HTTP of «Доходы»: `/incomes` read, record, amend, remove and restore, answered `no-store`.

## backend · usecases

- `backend/src/usecases/exchanges.ts` — Use cases of «Обмен денег»: the overview with wallet and official comparison, write/amend/remove/restore, rate preference. Tests: `backend/tests/exchanges.integration.test.ts`.
- `backend/src/usecases/incomes.ts` — Use cases of «Доходы»: the overview by month, record, amend, remove and restore an income. Tests: `backend/tests/incomes.integration.test.ts`.
- `backend/src/usecases/money-rates.ts` — Use case helper: the rates of one day between two currencies that «Деньги» counts spendings and incomes by.
- `backend/src/usecases/refresh-official-rates.ts` — Use case: one hourly refresh of the official-rate cache — the CBA first, then the fallbacks — with jump marking.

## backend · db

- `backend/src/db/exchanges-repository.ts` — Repository of exchanges: add with repeat/conflict, amend with revisions, mark-remove and restore, the held-before hint, rate preference. Tests: `backend/tests/exchanges-repository.integration.test.ts`.
- `backend/src/db/incomes-repository.ts` — Repository of incomes: add with repeat/conflict, amend with revisions, mark-remove, restore and final erase. Tests: `backend/tests/incomes-repository.integration.test.ts`.
- `backend/src/db/rates-repository.ts` — Repository of the official-rate cache: whole-answer upsert, latest on or before a day, jump history, last fetch time. Tests: `backend/tests/rates-repository.integration.test.ts`.

## backend · rates

- `backend/src/rates/cba.ts` — Feed of the Central Bank of Armenia: the SOAP `ExchangeRatesLatest` request and a narrow parser of its envelope.
- `backend/src/rates/cbr.ts` — Feed of the Bank of Russia, first fallback: parses the daily XML and turns rouble quotes into drams.
- `backend/src/rates/erapi.ts` — Feed of open.er-api.com, second fallback: parses its JSON against the dram and inverts it to drams per unit.
- `backend/src/rates/feed.ts` — Shared feed plumbing: the `RateFeed` interface, the foreign-currency list, timeout, strict `published` check, HTTP request.
- `backend/src/rates/feeds.test.ts` — Unit test: each provider's recorded answer parses to the right rates, and malformed, zero, dated-wrong or slow answers are refused whole.
- `backend/src/rates/schedule.ts` — The hourly refresh timer and whether the API refreshes at boot, given when the cache was last written.

## backend · tests

- `backend/tests/exchanges-repository.integration.test.ts` — Integration test: exchanges are written, repeated, refused on conflict, removed, restored within ten minutes and erased with the owner.
- `backend/tests/exchanges.integration.test.ts` — Integration test: «Обмен денег» over HTTP — the wallet, the official comparison, the chain of costs and the rate a new trip takes.
- `backend/tests/fixtures/rates/` — Provider answers recorded byte for byte on 19.09.2026 (CBA, Bank of Russia, er-api, a SOAP fault) that the feed parsers are tested on.
- `backend/tests/fixtures/rates/cba-runtime-error.html` — Fixture: the CBA's «Runtime Error» page its GET form returns, which the parser must refuse.
- `backend/tests/incomes-repository.integration.test.ts` — Integration test: incomes are written, amended with history, refused on conflict, removed, restored and erased with the owner.
- `backend/tests/incomes.integration.test.ts` — Integration test: «Доходы» over HTTP — months and sums, amend and undo, and how an income prices the wallet and a trip's rate.
- `backend/tests/rates-hardening.integration.test.ts` — Integration test: the adversarial cases of the rate cache — stale CBA, ×100 jumps, impossible dates, DB failure — stay held.
- `backend/tests/rates-repository.integration.test.ts` — Integration test: the official-rate cache and its constraints, jump marks and history, and the trip snapshot columns.

## frontend · views

- `frontend/src/views/ExchangeView.vue` — «Обмен денег» screen under «Деньги»: the own rate, which rate trips take, and the list of exchanges beside the central bank.
- `frontend/src/views/IncomesView.vue` — «Доходы» screen under «Деньги»: incomes by month with the per-currency sums, recording, amending and «Вернуть».

## frontend · components

- `frontend/src/components/ExchangeCard.vue` — Card of one exchange: the day, what was given and received, the rate plate against the central bank, the note.
- `frontend/src/components/ExchangeRemoveSheet.vue` — «Удалить обмен?» sheet: the exchange's amounts and day, and what removing does to the rate of new trips.
- `frontend/src/components/ExchangeSheet.vue` — «Записать обмен» sheet: given, received, day, «сколько было до» where it weighs; also amends an exchange with its versions.
- `frontend/src/components/IncomeCard.vue` — Card of one income: the day, the source and amount, the note on a plate below.
- `frontend/src/components/IncomeRemoveSheet.vue` — «Удалить доход?» sheet: the income's amount, source and day, and what removing may do to the rate.
- `frontend/src/components/IncomeSheet.vue` — «Записать доход» sheet: amount, currency, source, day, «сколько было до» where it weighs; also amends an income.
- `frontend/src/components/OperationCardHead.vue` — Head of an exchange or income card: the day, «исправлен …» and the bin, kept outside the card's button.
- `frontend/src/components/OperationSkeleton.vue` — Loading placeholder of exchange or income cards, drawn in `ScreenSkeleton`'s slot so the list does not jump.

## frontend · composables

- `frontend/src/composables/useExchangeWords.ts` — Composable: the words an exchange is said in — on its card, the undo strip and the removal sheet — from the server's figures.
- `frontend/src/composables/useExchanges.ts` — Composable: «Обмен денег» state from the server — phase, overview, writes, amend outcome and «Вернуть» after removal.
- `frontend/src/composables/useIncomes.ts` — Composable: «Доходы» state from the server — phase, overview, record, amend, remove and «Вернуть».

## e2e

- `e2e/exchange.spec.ts` — End-to-end: an exchange recorded on screen becomes the next trip's rate, the chain carries through, amendments and long amounts hold.
- `e2e/incomes.spec.ts` — End-to-end: an income lands in its month, is amended with a trace, comes back after removal, and an unknown cost is said.
