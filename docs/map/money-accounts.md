# Map · Money: accounts

Rules: `.claude/rules/money-accounts.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/money-account.ts` — Wire schemas of «Счета»: account body and view, the page, journal and its cursor, «не попали», the check, the held hint, a trip's payment.
- `packages/model/src/contracts/transfer.ts` — Wire schemas of «Перевод» (MOL-253): the body and amendment — two accounts, the fee of the money's currency — one transfer's view, and the answer with «Счета» whole.
- `packages/model/src/entities/money-account.ts` — Account entity and its counting: operations of five kinds — a transfer's two halves among them — movement and «списано», balances, the check with its reasons, «не попали», held on a day.
- `packages/model/src/entities/transfer.ts` — Transfer entity (MOL-253): money moved between two of one's own accounts of one currency, its fee, its versions, the undo window.

## backend · routes

- `backend/src/routes/money-accounts.ts` — HTTP of «Счета»: `/money/accounts` CRUD, restore, journal, checks, unassigned, held, and `PUT /trips/:tripId/payment`.

## backend · usecases

- `backend/src/usecases/account-of.ts` — Use-case helpers: which accounts an operation may name, and the account side of a spending, income, exchange or trip payment.
- `backend/src/usecases/money-accounts.ts` — Use cases of «Счета»: the counted page, journal, «не попали», the check, the held hint, add/amend/remove/restore, a trip's account. Tests: `backend/tests/money-accounts.integration.test.ts`.

## backend · db

- `backend/src/db/money-accounts-repository.ts` — Repository of accounts: the accounts, operations of all four kinds in one shape, the checks and the account of a trip. Tests: `backend/tests/money-accounts.integration.test.ts`.

## backend · tests

- `backend/tests/money-accounts.integration.test.ts` — Integration test: accounts over HTTP — ownership, balances from the start, trips and «списано», remove or «убрать», checks, journal, totals.

## frontend · views

- `frontend/src/views/AccountScreens.test.ts` — Component test: the account and accounts screens re-ask the page, lock currency, keep «Вернуть», offer «Подставить», stay calm offline, handle check reasons.
- `frontend/src/views/AccountView.vue` — One account's screen: its balance, start and last check, the journal by day a page at a time, «Сверить с фактом» or «Вернуть».
- `frontend/src/views/AccountsView.vue` — «Счета» screen: totals in the spending currency, «Не попали в остатки» under them (MOL-159), spending and savings accounts, the ones taken out of the choice.

## frontend · components

- `frontend/src/components/AccountChoice.test.ts` — Component test: the account row and picker in spending, income and trip sheets choose, follow the currency, write «Без счёта» and «Списано».
- `frontend/src/components/AccountLine.vue` — One account as a row: name, «сбережения» and balance; with currency and last event on «Счета».
- `frontend/src/components/AccountPickerSheet.vue` — «Счёт» picker sheet over an operation's sheet: accounts of its currency, others where «списано» covers them, «Без счёта».
- `frontend/src/components/AccountRow.vue` — «Счёт: Наличные ֏ ›» row in an operation's sheet that opens the picker; absent while the owner has no account.
- `frontend/src/components/AccountScreens.test.ts` — Component test: «Сверка» asks the fact first and waits for queued writes, «Записать разницу» writes once; the account sheet behaves.
- `frontend/src/components/AccountSheet.vue` — «Новый счёт» / «Счёт» sheet: name, currency, savings, start; written with a connection only, «Удалить» or «Убрать из выбора».
- `frontend/src/components/ChargedField.vue` — «Списано со счёта» field under the account row: what left the account in its currency when the operation was in another.
- `frontend/src/components/HeldFromAccounts.vue` — «По счетам на …: … · Подставить» hint under «сколько было до» of an exchange or income, filled only on tap.
- `frontend/src/components/OperationExchangeSheet.vue` — An exchange opened from an account's journal, «не попали» or a check, read from «Обмен денег» and amended in its sheet.
- `frontend/src/components/OperationIncomeSheet.vue` — An income opened from an account's journal, «не попали» or a check, read from «Доходы» and amended in its sheet.
- `frontend/src/components/OperationSheet.vue` — Dispatcher that opens a journal row's operation in its own sheet — spending, trip summary, income or exchange — with «‹» back.
- `frontend/src/components/ReconcileSheet.vue` — «Сверка» sheet: the fact first, then the server's difference and its reasons, each fixed in its sheet, and «Записать разницу».
- `frontend/src/components/UnassignedSheet.vue` — «Не попали в остатки» sheet: the server's list of operations with no account; a row opens its sheet to choose one.
- `frontend/src/components/accounts.ts` — Helpers of the account screens: signed amounts with U+2212, short days, «на 14:05», page order, the default account, picker groups.

## frontend · composables

- `frontend/src/composables/useAccountChoice.ts` — Composable: the account of one side of an operation in its sheet, defaulting to the first live one of its currency until chosen.
- `frontend/src/composables/useAccountJournal.ts` — Composable: one account's journal from the server, page by page, with its phase including `missing`.
- `frontend/src/composables/useOwnCategories.ts` — Composable: the owner's spending categories outside the month — remembered, queued and the server's — with names by id.

## frontend · stores

- `frontend/src/stores/accounts.ts` — Store: the accounts page and recent journals as this phone last heard them, per owner, shared by every screen that shows or picks an account.

## e2e

- `e2e/accounts.spec.ts` — End-to-end: an account and a spending from it, a check that comes out even once an account is chosen or «Прочее · сверка» written, removal, offline.
