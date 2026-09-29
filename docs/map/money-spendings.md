# Map · Money: spendings and «Деньги»

Rules: `.claude/rules/money-spendings.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/money.ts` — Wire schemas of the «Деньги» month: the month address, journal page cursor, the month view, the salary-shift setting.
- `packages/model/src/contracts/spending.ts` — Wire schemas of spendings and categories: body and amendment, a spending's view, a category's body and view, the categories answer.
- `packages/model/src/entities/money-month.ts` — The month of «Деньги» counted whole: months and budget month, journal entries and order, «Пришло», «Остаток», `percentChange`, `shareOf`.
- `packages/model/src/entities/spending-category.ts` — Spending category entity: the thirteen presets and their order, the trip's category, name limit, palette colour, chip order.
- `packages/model/src/entities/spending.ts` — Spending entity: money spent outside a trip, its text limits, undo window and its amount in the spending currency.

## backend · routes

- `backend/src/routes/spendings.ts` — HTTP of «Деньги»: `/spendings` and `/spending-categories` writes and undo, `GET /money/months/:month`, `/actors/me/salary-shift`.

## backend · usecases

- `backend/src/usecases/money-month.ts` — Use case: the month of «Деньги» with its rates read first and a closed month frozen, and the salary-shift setting. Tests: `backend/tests/spendings.integration.test.ts`.
- `backend/src/usecases/money.test.ts` — Use-case test: day rates, a spending's rate snapshot on record and amend, and month freezing hold on fake repositories.
- `backend/src/usecases/spendings.ts` — Use cases of spendings and categories: record, amend, remove, restore a spending; list, add and archive a category.

## backend · db

- `backend/src/db/money-repository.ts` — Repository of what «Деньги» reads beside spendings: a month's finished trips as journal lines and the frozen rate of a closed month.
- `backend/src/db/spending-categories-repository.ts` — Repository of the owner's categories: presets given on first read, one's own named by the device, archive and restore.
- `backend/src/db/spendings-repository.ts` — Repository of spendings outside trips: add with repeat/conflict, amend by revision, mark-remove, restore and final erase.

## backend · tests

- `backend/tests/month-rest.integration.test.ts` — Integration test: «Остаток» is the accounts' money at the month's end — which accounts and operations count, frozen and uncounted cases.
- `backend/tests/salary-shift.integration.test.ts` — Integration test: «Зарплата — в следующий месяц» is set and cleared per owner, bounded, and moves a salary into next month's «Пришло».
- `backend/tests/spendings.integration.test.ts` — Integration test: categories, spendings and the month over HTTP — repeats, undo, rates of the day, freezing and thawing, journal pages.

## frontend · views

- `frontend/src/views/MoneyCategoriesView.vue` — «Деньги → Категории» screen: the owner's category list, «Убрать» and «Вернуть», through the queue.
- `frontend/src/views/MoneyView.vue` — «Деньги» screen: one month counted by the server — spent, came in, «Куда ушли», the journal by day, queued rows marked.

## frontend · components

- `frontend/src/components/CategoryBars.vue` — «Куда ушли» card: a bar per category with its sum and share, largest first, and the way into the categories.
- `frontend/src/components/CategoryChips.vue` — Category chips of a spending: a radio group in fixed order, nothing preselected, the last chip «+ Своя».
- `frontend/src/components/MoneyEntries.vue` — Rows on «Деньги» leading to «Обмен денег» and «Доходы», with the person's own rate beside exchanges.
- `frontend/src/components/MonthSwitcher.vue` — «‹ Сентябрь 2026 ›» month switcher of «Деньги»: no future months, no lower bound, no swipe.
- `frontend/src/components/NewCategorySheet.vue` — «Новая категория» sheet over the spending sheet: a name, made through the queue, a preset's name refused.
- `frontend/src/components/SalaryShiftGroup.vue` — Settings group «Зарплата с … числа — в следующий месяц»: a switch and a day select, saved on the tap.
- `frontend/src/components/SpendingRow.vue` — One row of the month's journal: a spending or a finished trip's purchases in one currency, with what the server counted.
- `frontend/src/components/SpendingSheet.vue` — Spending sheet: «Новая трата», amending one's own, or reading a trip's line; writes go to the queue and it closes at once.
- `frontend/src/components/spending.ts` — Helpers of «Деньги» drawing: category icon and colour, rate words, journal rows from the month and the queue, page merge.

## frontend · composables

- `frontend/src/composables/useMoneyMonth.ts` — Composable: one month of «Деньги» from the server, its later pages, re-read when the queue lands; remembered categories.
- `frontend/src/composables/useSalaryShift.ts` — Composable: the «Зарплата — в следующий месяц» setting, read and saved on the tap, nothing kept on the phone.

## frontend · stores

- `frontend/src/stores/spendingQueue.ts` — Store: the on-device queue of every spending and category write, folded while waiting, sent one window at a time.

## e2e

- `e2e/money.spec.ts` — End-to-end: a spending lands in the month through the queue, offline too; «Вернуть», own categories, «Остаток» and the salary shift.
