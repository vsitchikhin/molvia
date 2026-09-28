---
paths:
  - 'packages/model/src/{entities,contracts}/money-account.ts'
  - 'packages/model/tests/{entities,contracts}/money-account.test.ts'
  - 'backend/src/db/money-accounts-repository.ts'
  - 'backend/src/usecases/{money-accounts,account-of}*.ts'
  - 'backend/src/routes/money-accounts.ts'
  - 'backend/tests/money-accounts*.ts'
  - 'backend/drizzle/*money_accounts*.sql'
  - 'frontend/src/**/*{Account,account}*'
---

# Money: accounts, balances and checks

The detail behind the account lines of `CLAUDE.md`.

**An account is where money lies (MOL-115)** — «Наличные ֏», «Карта ₽»: a name, a currency, «сбережения»,
and a start — what it held at the end of a day, below zero for a card in debt (`money_accounts`,
`MoneyAccount` in code, since «account» already means a Molvia account). Private as a spending, the
owner's alone, and gone with them. **There is no rate on an account, ever**: the price of money
belongs to its currency (MOL-42, MOL-43 Р-2).

- **The balance is counted, never stored: the start and every operation on the account dated after
  its day.** The start is the evening of `startOn` — «Старт — вечер 16.09» of the owner's sheet — so
  an operation on that day is history and moves nothing. **A trip is dated by the day it started** —
  the money left at the shelf — and moves its account while still open (Р-29): dated by its finish,
  a trip left open, or finished after midnight, was taken a second time from a start that already
  counted it (adversarial Д4). The day is the phone's where it is earlier than the server's — the
  earlier of the server's start and the device's finish — or a trip begun offline in the evening and
  delivered after midnight took the next day (owner's decision В-6, review Р2-3). A device's finish
  more than a day before the server's start is a wrong clock, not an evening offline, and the server's
  day stands (adversarial Ж1). The month of
  «Деньги» still dates it by the finish. **The price, named** (adversarial Е2): a trip continued on
  later days moves its account on its first day, and one begun before an account's start and
  continued after it is history whole — the start line is drawn once, when the account is made. One loading of all four kinds (`operations`) feeds the balance,
  the journal, the check and «не попали» alike, as one shape (`AccountOperation`).
- **An account on an operation is optional** (MOL-43 В-2): a spending, an income, each half of an
  exchange, a trip. The screen puts the default in, the server never guesses. **The database holds
  whose it is and what it may hold**: every account column is a key with the owner, and an income's
  and an exchange side's key carries the currency too — money lands on an account in its own currency
  or it is not that account. A removed account still takes operations, and so does one marked for
  deletion: what was queued offline is not lost to an account taken away on another phone. **One the
  owner has not got at all, or one that does not fit, is «без счёта», never a refusal** (Р-28, Р-31):
  an account deleted for good, or given another currency, while a phone was offline is not the one
  the phone saw, and a refusal would set the operation aside in the queue for good (adversarial Д3,
  Е1); someone else's account gets the same answer, so nothing tells the two apart.
- **«Списано со счёта»** (MOL-43 В-3) is what left the account exactly, in its currency, on a
  spending in another currency, or a trip that is itself or has a purchase in another — a trip's
  purchases may be in any of the four, and a trip in drams with a dollar purchase would otherwise be
  named «без списано» by every check and refused the one thing that fixes it (adversarial Д2). Keys
  and checks hold the rest; the trip's case is the use case's, since its row cannot see its lines.
  **It counts only while it applies** (`debitedOn`): a trip whose dollar purchase was corrected to
  drams is counted exactly by its sums (adversarial Е3). **And any change of a trip's money takes
  its «списано» off** (Р-32, adversarial Ж2) — a priced purchase added, a price changed, a priced one
  removed: the figure was what left the account for the trip as it was, and kept, it counted a
  purchase it never covered the day a dollar one was added; the check names the trip until it is
  entered anew. **Nothing
  about it is refused** (Р-31): sent where it does not apply it is dropped, and in another currency
  than the account's it means the account is not the one the phone saw — the operation is written
  «без счёта»; a write from the queue that was refused would be lost. It moves the balance
  and nothing else: not the month of «Деньги» (owner's decision В-1) and not the person's own rate,
  since those drams were never in their hands. **Without it the amount is converted by the rule of
  «Деньги»** — the spending's own snapshot when it is of the pair, otherwise the person's rate of that
  day, else a fresh official one — and marked «≈» (Р-14): one spending is one number on the month and
  on the account. Nothing to convert it by and it is «не посчитано»: in no balance, named by every
  check. A trip's «списано» is the trip whole, whatever currencies its purchases were in (Р-18); it is
  set from the summary by `PUT /trips/:id/payment`, whole each time, so the queue can send it twice.
- **A field of the account left out of an amendment is kept, not cleared** (Р-26) — the one
  exception to «an amendment is the operation whole»: the screens older than accounts amend a note
  without knowing the field, and would take the operation off its account in silence. A kept account
  the money no longer fits — the currency was changed — is dropped rather than refused. **A repeat of
  a write sent without the field is still a repeat** after an account was named on it later, or the
  import run again would meet 409 on every row.
- **Naming the account is not amending the fact** (Р-15): on an exchange or an income it writes no
  version, sets no «исправлен» and thaws no month — where the money lay is not what was exchanged. The
  version still moves, so an amendment over the old one elsewhere is a conflict.
- **Removing: without operations a mark, with them «убран из выбора»** (handoff 03). A marked account
  is offered back for ten minutes and then deleted by the minute timer; an operation that named it
  meanwhile is left without an account and lands in «не попали» — not lost (Р-17). One with operations
  keeps its history and balance, leaves the picker and the totals (Р-22), and comes back by the same
  «Вернуть». A name is unique among the owner's accounts that still exist, removed ones included, in
  any case, under the owner's lock (Р-21) — so «Вернуть» never meets a conflict. The currency of an
  account with operations does not move: they were counted in it.
- **The totals are the live accounts in the spending currency by the rule of «Деньги», always «≈»**
  — «всего», «можно тратить» without the savings, «сбережения» — and an account nothing converts today
  is left out and counted as such, never as zero.
- **The month of «Деньги» reads the same balances for its «Остаток»** (MOL-134): `balancesOn` — the
  live accounts started by a day, their operations up to it — through `accountsCounted`, the one
  loading of accounts, operations and rates both screens share. A removed account is in neither.
- **A check looks for the reason before it offers to close the difference** (MOL-43 В-4, the owner's
  comment over the option they ticked). The fact is sent first and the count only answered after it,
  so the person does not fit the number; the answer is the difference and what could have made it
  since the last check, or the start: an operation of the account's currency with no account — a
  trip with nothing priced yet included, by its own currency (Д6) — one on it in another currency
  without «списано», a trip on it with purchases that have no price, one no rate counts. «Since» is
  dated after the check's day **or learnt by the server after the check** (`seenAt`): written,
  amended, given or taken an account, a trip received as finished or given a purchase — never the
  phone's clock, or a trip finished offline and delivered after a check hid behind it (Д1, Д1б).
  **Only a check that came out even is where the next one starts** (owner's decision В-4 of the
  review, adversarial Д7): one with a difference is written and shown («сверено»), but what it named
  stays named — in «не попали» too — until a check comes out even; otherwise closing the sheet
  without putting the reason right hid it, and the next check led to «Прочее · сверка», the same
  money twice. Sent again under its name a check counts again, which is how the screen shows a reason
  put right (Р-19). **«Came out even» is exact** (owner's decision В-5, review Р2-2): an account
  counted with «≈» rarely matches the bank to the kopeck, and a difference of rounding is closed like
  any other — «Прочее · сверка» — **after which the screen sends the same check again**, so that it
  comes out even and moves the window; without that repeat the window of such an account stays at
  its start. Closing the difference is an ordinary «Прочее» spending or income with the note
  «сверка», written by the person's own tap through the ordinary routes with the server's sum.
- **«Не попали в остатки» is per account, not per currency** (Р-16): an operation with no account
  that could still explain a difference of some live account of its currency — after its start and
  its last check that came out even. A fresh check of the card does not hide last week's cash; a currency with no
  account is not asked about.
- **«Сколько было до обмена» from the accounts is a hint** (Р-9, Р-20): the balances of the currency
  at the end of the day, the exchange amended left out, and nothing when an account of it starts on
  that day or later. Put into the wallet in silence it would have re-priced the months (MOL-73 В-6).
- **The prices, named:** the balance of a view counts live operations while «удалить или убрать» asks
  of every row — a spending in its ten minutes of «Вернуть» makes an account «убран» rather than
  deleted; an operation naming a marked account is in no balance until the timer unlinks it; a check
  keeps the count of its moment; a new price of a purchase already written does not move its trip's
  `seenAt` — a purchase has no moment of amendment; after «Прочее · сверка» the operation that made
  the difference is still in «не попали» until a check comes out even; and every read counts the
  owner's whole life, a rate per day of a foreign amount — measured at 81 ms on two years of daily
  spending and sixty exchanges (adversarial Д8), accepted.
