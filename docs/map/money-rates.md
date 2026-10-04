# Map · Money: rates, exchanges, incomes

Rules: `.claude/rules/money-rates.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/exchange.ts` — Wire schemas of «Обмен денег»: the exchange body and amendment, the rate preference, the screen's answer with wallet and costs, «Обмены против рынка» and the line of the rate (MOL-161).
- `packages/model/src/contracts/income.ts` — Wire schemas of «Доходы»: the income body and amendment, one income's view, the answer grouped by month.
- `packages/model/src/entities/exchange.ts` — Exchange entity and the wallet: currency costs along the chain, own rates, difference from the official rate, the «сколько было до» hint.
- `packages/model/src/entities/exchange-rate-chart.ts` — «Курс рубля за месяц, 6 и 12 месяцев» (MOL-161, MOL-168): the periods and their first day, the days of the month and the weeks of half a year and the year, a step's figure of all bank clients, the pairs and the side of their line, each exchange with its percent and the market it was measured by, the round ticks of each period's axis.
- `packages/model/src/entities/income.ts` — Income entity: the closed list of sources, the undo window, and the per-month sums per currency.
- `packages/model/src/values/market-rates.ts` — Market-rate value (MOL-137): the currencies of the files (MOL-110), channels, the bank's side of an exchange, a day's figure per channel, the best for the person, «exchange offices still to come», the figures of today, the band of a factor of two.
- `packages/model/src/values/rates.ts` — Exchange-rate value: six-digit scale, sources and providers, the pair's own bank (`homeBankOf`, MOL-110), jump rule, Yerevan days, `latestDay` — the latest day on Earth, the bound of «not in the future» (MOL-121) —, freshness, picking the official rate, `formatRate`.

## backend · routes

- `backend/src/routes/exchanges.ts` — HTTP of «Обмен денег»: `/exchanges` read, record, amend, remove, restore, and `PUT /actors/me/rate-preference`.
- `backend/src/routes/incomes.ts` — HTTP of «Доходы»: `/incomes` read, record, amend, remove and restore, answered `no-store`.

## backend · usecases

- `backend/src/usecases/exchanges.ts` — Use cases of «Обмен денег»: the overview with wallet, official and market comparison (MOL-137), the block of today's rates, write/amend/remove/restore, rate preference. Tests: `backend/tests/exchanges.integration.test.ts`.
- `backend/src/usecases/incomes.ts` — Use cases of «Доходы»: the overview by month, record, amend, remove and restore an income. Tests: `backend/tests/incomes.integration.test.ts`.
- `backend/src/usecases/exchanges-market.test.ts` — Unit test: the block «Курсы по данным ЦБ РА» — the central bank's own rate only, the best starred among the latest day.
- `backend/src/usecases/refresh-market-rates.ts` — Use case: the hourly refresh of the market (MOL-137) — each central-bank file on its own, downloaded when its version moved, refused whole outside a factor of two of the official rate or dated ahead. Tests beside it.
- `backend/src/usecases/money-rates.ts` — Use case helper: the rates of one day between two currencies that «Деньги» counts spendings and incomes by.
- `backend/src/usecases/refresh-official-rates.ts` — Use case: one hourly refresh of the official-rate cache — the CBA first, then the fallbacks, and the country banks every hour with their archive walked a day a request (MOL-110) — with jump marking.

## backend · db

- `backend/src/db/exchanges-repository.ts` — Repository of exchanges: add with repeat/conflict, amend with revisions, mark-remove and restore, the held-before hint, rate preference. Tests: `backend/tests/exchanges-repository.integration.test.ts`.
- `backend/src/db/incomes-repository.ts` — Repository of incomes: add with repeat/conflict, amend with revisions, mark-remove, restore and final erase. Tests: `backend/tests/incomes-repository.integration.test.ts`.
- `backend/src/db/market-rates-repository.ts` — Repository of the market (MOL-137): a file written whole, each channel's latest within a week before a day, the latest of all, how far a channel reached. Tests: `backend/tests/market-rates.integration.test.ts`.
- `backend/src/db/rates-repository.ts` — Repository of the official-rate cache: whole-answer upsert, latest on or before a day, jump history, last fetch time. Tests: `backend/tests/rates-repository.integration.test.ts`.

## backend · rates

- `backend/src/rates/cba.ts` — Feed of the Central Bank of Armenia: the SOAP `ExchangeRatesLatest` request and a narrow parser of its envelope.
- `backend/src/rates/cba-history.ts` — The central bank's archive of the official rate (MOL-137): SOAP `ExchangeRatesByDateRangeByISO` and a strict parser of its rows.
- `backend/src/rates/cba-market.ts` — Feeds of the market (MOL-137): three central-bank xlsx files — people in cash and not, all bank clients, exchange offices — strict readers of their sheets, a `HEAD` before each download and a ceiling held on the stream.
- `backend/src/rates/cbr.ts` — Feed of the Bank of Russia, first fallback: parses the daily XML and turns rouble quotes into drams.
- `backend/src/rates/erapi.ts` — Feed of open.er-api.com, second fallback: parses its JSON against the dram and inverts it to drams per unit.
- `backend/src/rates/nbg.ts` — Feed of the National Bank of Georgia, the lari's own bank (MOL-110): parses its JSON of lari quotes into drams inside one answer; the latest and any day of the archive.
- `backend/src/rates/feed.ts` — Shared feed plumbing: the `RateFeed` interface, the foreign-currency list, timeout, strict `published` check, HTTP request; `reach` turns a request with no answer into a `FeedError` worded by its `cause` (MOL-153).
- `backend/src/rates/feeds.test.ts` — Unit test: each provider's recorded answer parses to the right rates, and malformed, zero, dated-wrong or slow answers are refused whole.
- `backend/src/rates/market-feeds.test.ts` — Unit test: the three recorded xlsx files and the SOAP archive read to the right figures, and a file with one cell moved, zeroed or renamed refused whole.
- `backend/src/rates/schedule.ts` — The hourly refresh timer and whether the API refreshes at boot, given when the cache was last written.
- `backend/src/rates/xlsx.ts` — One sheet of a workbook read through exceljs into its cells once, with accessors that refuse what they did not expect (MOL-137).

## backend · tests

- `backend/tests/exchanges-repository.integration.test.ts` — Integration test: exchanges are written, repeated, refused on conflict, removed, restored within ten minutes and erased with the owner.
- `backend/tests/exchanges.integration.test.ts` — Integration test: «Обмен денег» over HTTP — the wallet, the official comparison, the chain of costs and the rate a new trip takes.
- `backend/tests/fixtures/rates/` — Provider answers recorded byte for byte that the feed parsers are tested on: 19.09.2026 (CBA, Bank of Russia, er-api, a SOAP fault), 30.09.2026 (the CBA's archive — asked again with the lari on 04.10, MOL-110 — and its three xlsx files of the market, MOL-137) and 03.10.2026 (the National Bank of Georgia, MOL-110).
- `backend/tests/fixtures/rates/cba-runtime-error.html` — Fixture: the CBA's «Runtime Error» page its GET form returns, which the parser must refuse.
- `backend/tests/incomes-repository.integration.test.ts` — Integration test: incomes are written, amended with history, refused on conflict, removed, restored and erased with the owner.
- `backend/tests/lari.integration.test.ts` — Integration test: the lari (MOL-110) — a trip takes the National Bank of Georgia as official and the CBA as its fallback, an exchange and an income of lari price the wallet, the database holds the pair's own bank as the domain does.
- `backend/tests/incomes.integration.test.ts` — Integration test: «Доходы» over HTTP — months and sums, amend and undo, and how an income prices the wallet and a trip's rate.
- `backend/tests/market-history.integration.test.ts` — Integration test: the central bank's archive since 2022 and its recorded file of banks in one hour — the file written whole, a non-cash exchange of 2024 beside all bank clients (review А).
- `backend/tests/market-rates.integration.test.ts` — Integration test: the market table and its constraints, the official history filling holes only, and «Обмен денег» against the market over HTTP — sides, best and own channel, stand-ins, the block of today, the channel in repeats and amendments.
- `backend/tests/rates-hardening.integration.test.ts` — Integration test: the adversarial cases of the rate cache — stale CBA, ×100 jumps, impossible dates, DB failure — stay held.
- `backend/tests/rates-repository.integration.test.ts` — Integration test: the official-rate cache and its constraints, jump marks and history, and the trip snapshot columns.

## frontend · views

- `frontend/src/views/ExchangeView.vue` — «Обмен денег» screen under «Деньги»: «Обмены против рынка» and the line of the rate on top, the own rate, which rate trips take, and the list of exchanges beside the market.
- `frontend/src/views/IncomesView.vue` — «Доходы» screen under «Деньги»: incomes by month with the per-currency sums, recording, amending and «Вернуть».

## frontend · components

- `frontend/src/components/ExchangeCard.vue` — Card of one exchange: the day, what was given and received, the rate plate against the market of its day and the central bank, the note.
- `frontend/src/components/ExchangeRateChart.vue` — «Курс рубля за месяц, 6 и 12 месяцев» on «Обмен денег» (MOL-161, MOL-168): the market of all bank clients by day or week, the exchanges as dots with a mark to the market each was measured by, the reading above, the pairs and the period, hidden radios.
- `frontend/src/components/ExchangeRemoveSheet.vue` — «Удалить обмен?» sheet: the exchange's amounts and day, and what removing does to the rate of new trips.
- `frontend/src/components/ExchangeSheet.vue` — «Записать обмен» sheet: given, received, day, how it was changed, «сколько было до» where it weighs; also amends an exchange with its versions.
- `frontend/src/components/IncomeCard.vue` — Card of one income: the day, the source and amount, the note on a plate below.
- `frontend/src/components/IncomeRemoveSheet.vue` — «Удалить доход?» sheet: the income's amount, source and day, and what removing may do to the rate.
- `frontend/src/components/IncomeSheet.vue` — «Записать доход» sheet: amount, currency, source, day, «сколько было до» where it weighs; also amends an income.
- `frontend/src/components/MarketRatesCard.vue` — «Курсы по данным ЦБ РА» on «Обмен денег» (MOL-137): per currency the official rate and each channel's latest figures to sell and to buy, dated, the best starred and said.
- `frontend/src/components/OperationCardHead.vue` — Head of an exchange or income card: the day, «исправлен …» and the bin, kept outside the card's button.
- `frontend/src/components/OperationSkeleton.vue` — Loading placeholder of exchange or income cards, drawn in `ScreenSkeleton`'s slot so the list does not jump.

## frontend · composables

- `frontend/src/composables/useExchangeWords.ts` — Composable: the words an exchange is said in — on its card, the undo strip and the removal sheet — from the server's figures.
- `frontend/src/composables/useExchanges.ts` — Composable: «Обмен денег» state from the server — phase, overview, writes, amend outcome and «Вернуть» after removal.
- `frontend/src/composables/useIncomes.ts` — Composable: «Доходы» state from the server — phase, overview, record, amend, remove and «Вернуть».

## e2e

- `e2e/exchange.spec.ts` — End-to-end: an exchange recorded on screen becomes the next trip's rate, the chain carries through, amendments and long amounts hold; the line of the rate by the finger and by period.
- `e2e/incomes.spec.ts` — End-to-end: an income lands in its month, is amended with a trace, comes back after removal, and an unknown cost is said.
