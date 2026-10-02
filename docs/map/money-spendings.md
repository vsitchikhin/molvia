# Map · Money: spendings and «Деньги»

Rules: `.claude/rules/money-spendings.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/money.ts` — Wire schemas of the «Деньги» month: the month address, journal page cursor, the month view, the salary-shift setting.
- `packages/model/src/contracts/money-budget.ts` — Wire schemas of «Бюджет» (MOL-117): a plan as a sum or a percent, the body of `PUT /budget/plans`, the month's budget answer.
- `packages/model/src/contracts/money-charts.ts` — Wire schemas of «Графики», every height the server counted: the month's charts of MOL-158 and the year's of MOL-160 (`yearSchema`), the sector of a ring shared.
- `packages/model/src/contracts/spending.ts` — Wire schemas of spendings and categories: body and amendment, a spending's view, a category's body and view, the categories answer.
- `packages/model/src/entities/money-budget.ts` — The budget of a month (MOL-117): which plan holds from which month, a share of «Пришло» by the month's rate, rows against `byCategory`, «Без плана», the total, the savings target.
- `packages/model/src/entities/money-month.ts` — The month of «Деньги» counted whole: months and budget month, journal entries and order, «Пришло», «Остаток», `percentChange`, `shareOf`.
- `packages/model/src/entities/money-charts.ts` — What every chart shares: levels, the ring's sectors (`donutSlices`), months of a period, means and changes, and the exchanges by exchanger of «Обмен денег».
- `packages/model/src/entities/money-chart-month.ts` — «Графики → Месяц» from counted months: the usual month of up to twelve closed ones from three, against the usual by category, the pace by day, the ring with «Остальные» named.
- `packages/model/src/entities/money-chart-year.ts` — «Графики → Год» from counted months: twelve months with what each is to the bars, the year's ring by each month's rate, the usual month of «Месяц» as its dashed line, «Разница» of the year, categories by month.
- `packages/model/src/entities/spending-category.ts` — Spending category entity: the thirteen presets and their order, the trip's category, name limit, palette colour, chip order.
- `packages/model/src/entities/spending.ts` — Spending entity: money spent outside a trip, its text limits, undo window and its amount in the spending currency.

## backend · routes

- `backend/src/routes/spendings.ts` — HTTP of «Деньги»: `/spendings` and `/spending-categories` writes and undo, `GET /money/months/:month` and its `/charts`, `/actors/me/salary-shift`.

## backend · usecases

- `backend/src/usecases/money-month.ts` — Use case: the month of «Деньги» with its rates read first and a closed month frozen, and the salary-shift setting. Tests: `backend/tests/spendings.integration.test.ts`.
- `backend/src/usecases/money-chart-month.ts` — Use case: `GET /money/months/:month/charts` — the month as «Деньги» count it, the usual months before it counted with no rate and never frozen. Tests: `backend/tests/money-chart-month.integration.test.ts`.
- `backend/src/usecases/money-chart-year.ts` — Use case: `GET /money/years/:year/charts` — every month of the calendar year counted and frozen as «Деньги» count it, the usual's months before the year with no rate. Tests: `backend/tests/money-chart-year.integration.test.ts`.
- `backend/src/usecases/money.test.ts` — Use-case test: day rates, a spending's rate snapshot on record and amend, and month freezing hold on fake repositories.
- `backend/src/usecases/today.ts` — `todayOf`: «today» of money for a request — the phone's day it named (`TODAY_HEADER`, MOL-121), or Yerevan's. Tests: `backend/tests/money-accounts.integration.test.ts`.
- `backend/src/usecases/spendings.ts` — Use cases of spendings and categories: record, amend, remove, restore a spending; list, add and archive a category.

## backend · db

- `backend/src/db/budget-plans-repository.ts` — Repository of «Бюджет» (MOL-117): the owner's plans read whole, a plan written from a month on under the owner's lock, replacing the later ones of its category.
- `backend/src/db/money-repository.ts` — Repository of what «Деньги» reads beside spendings: a month's finished trips as journal lines and the frozen rate of a closed month.
- `backend/src/db/spending-categories-repository.ts` — Repository of the owner's categories: presets given on first read, one's own named by the device, archive and restore.
- `backend/src/db/spendings-repository.ts` — Repository of spendings outside trips: add with repeat/conflict, amend by revision, mark-remove, restore and final erase.

## backend · tests

- `backend/tests/month-rest.integration.test.ts` — Integration test: «Остаток» is the accounts' money at the month's end — which accounts and operations count, frozen and uncounted cases.
- `backend/tests/money-chart-month.integration.test.ts` — Integration test: the month of «Графики → Месяц» equals its month of «Деньги», only it is frozen, the usual from three closed months, a removed category, privacy.
- `backend/tests/money-chart-year.integration.test.ts` — Integration test: every month of «Графики → Год» equals its month of «Деньги» and the year is their sum, what is frozen, the average from three, privacy, 404.
- `backend/tests/salary-shift.integration.test.ts` — Integration test: «Зарплата — в следующий месяц» is set and cleared per owner, bounded, and moves a salary into next month's «Пришло».
- `backend/tests/spendings.integration.test.ts` — Integration test: categories, spendings and the month over HTTP — repeats, undo, rates of the day, freezing and thawing, journal pages.

## frontend · views

- `frontend/src/views/MoneyCategoriesView.vue` — «Деньги → Категории» screen: the owner's category list, «Убрать» and «Вернуть», through the queue.
- `frontend/src/views/MoneyChartsView.vue` — «Графики» screen: «Месяц · Год», the month and the year in the address by `replace`, a bookmark of the old period opening the year.
- `frontend/src/views/MoneyView.vue` — «Деньги» screen: the summary of one month counted by the server — spent, came in, «Остаток», «Куда ушли» — and five ways out with one figure each.
- `frontend/src/views/MoneySpendingsView.vue` — «Траты» screen (MOL-159): the journal of the month by day, a page at a time, queued rows marked, the server's count and sum on top.

## frontend · components

- `frontend/src/components/CategoryDonutCard.vue` — «Куда ушли» card on «Деньги»: the month's ring and its three largest sectors with share and sum, «Ещё N», the whole card one way into «Графики → Месяц» of the same month.
- `frontend/src/components/BarChart.vue` — Bars of «Графики»: a reading above, radios for the keyboard, the whole area as the target, a bar not known drawn dashed.
- `frontend/src/components/DonutRing.vue` — The ring of a donut: d3-shape arcs from the server's levels, clockwise from twelve, a gap between sectors, token colours, the chosen sector thicker and the rest dimmed.
- `frontend/src/components/DonutChart.vue` — «Куда ушло» of «Графики → Месяц»: the full ring, the month in its centre, a legend that is a radio group, a sector chosen by a tap and let go by a second.
- `frontend/src/components/DeviationBars.vue` — «Против обычного»: the categories furthest from their usual month, a bar and the usual's mark, ±% with an arrow in the text's colour, «новая», the card of too few months.
- `frontend/src/components/PaceLine.vue` — «Темп месяца»: the month's running total solid against the usual dashed, a day chosen on lifting or sideways and by a native range.
- `frontend/src/components/ChartsMonth.vue` — «Графики → Месяц»: the month's answer in four states and its three cards; the sector and the day chosen on the screen, not in the address.
- `frontend/src/components/ChartsYear.vue` — «Графики → Год» (MOL-160): «‹ 2026 ›», the year's ring, twelve months against the usual, in and out with the year's «Разница», a category by month chosen by a sector of the ring too.
- `frontend/src/components/CategoryChips.vue` — Category chips of a spending: a radio group in fixed order, nothing preselected, the last chip «+ Своя».
- `frontend/src/components/ExchangeLosses.vue` — «Обмены против рынка» card on top of «Обмен денег» (MOL-152, MOL-159): exchangers worst first, a bar from the centre line, no «≈ ₽».
- `frontend/src/components/MoneyEntries.vue` — The ways out of «Деньги»: «Траты» of the month, «Счета», «Обмен денег», «Доходы», «Категории», each with one figure or none until known.
- `frontend/src/components/MonthSwitcher.vue` — «‹ Сентябрь 2026 ›» month switcher of «Деньги», or «‹ 2026 ›» of «Графики → Год»: no future, no swipe; the month with no lower bound, the year back to the first with data (MOL-160).
- `frontend/src/components/NewCategorySheet.vue` — «Новая категория» sheet over the spending sheet: a name, made through the queue, a preset's name refused.
- `frontend/src/components/SalaryShiftGroup.vue` — Settings group «Зарплата с … числа — в следующий месяц»: a switch and a day select, saved on the tap.
- `frontend/src/components/SpendingRow.vue` — One row of the month's journal: a spending or a finished trip's purchases in one currency, with what the server counted.
- `frontend/src/components/SpendingSheet.vue` — Spending sheet: «Новая трата», amending one's own, or reading a trip's line; writes go to the queue and it closes at once.
- `frontend/src/components/charts.ts` — Words of «Графики»: the month long, in three letters and by name, «после октября», a span of months, the closed ones named, a signed percent, «−8 % к августу».
- `frontend/src/components/spending.ts` — Helpers of «Деньги» drawing: category icon and colour, rate words, journal rows from the month and the queue, page merge.

## frontend · composables

- `frontend/src/composables/useMoneyScreen.ts` — Composable: what «Деньги» and «Траты» share — the month in the address by `replace`, the journal and refusals, the spending sheet, «Вернуть».
- `frontend/src/composables/useMoneyMonth.ts` — Composable: one month of «Деньги» from the server, its later pages, re-read when the queue lands; remembered categories.
- `frontend/src/composables/useChartPointer.ts` — Composable: a choice made on a chart by the whole area — a mouse on press, a finger on lifting or going sideways, a scroll never.
- `frontend/src/composables/useMoneyCharts.ts` — Composable: «Графики» of a month (MOL-158) and of a year (MOL-160) from the server, through `useKeptAnswer`.
- `frontend/src/composables/useKeptAnswer.ts` — Composable: an answer of «Графики» kept per owner and subject, only the latest read, offline or error decided after the failure, re-read when a write lands.
- `frontend/src/composables/useSalaryShift.ts` — Composable: the «Зарплата — в следующий месяц» setting through `useTapSetting`, read and saved on the tap.

## frontend · stores

- `frontend/src/stores/spendingHandoff.ts` — Store: a record with no purchases handed over to «Деньги» as a spending (MOL-78, В-1), taken once by the sheet.
- `frontend/src/stores/spendingQueue.ts` — Store: the on-device queue of every spending and category write, folded while waiting, sent one window at a time.

## e2e

- `e2e/money.spec.ts` — End-to-end: a spending lands in the month through the queue, offline too; «Вернуть», own categories, «Остаток» and the salary shift.
- `e2e/money-charts.spec.ts` — End-to-end: «Графики → Месяц» from the ring of «Куда ушли», the month by `replace`, a sector, the usual from three months, a day of the pace; «Год» of the calendar year — the year by `replace` back to the first with data, its average across the new year, a sector choosing the category; offline.
