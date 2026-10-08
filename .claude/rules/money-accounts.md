---
paths:
  - 'packages/model/src/{entities,contracts}/{money-account,transfer}.ts'
  - 'packages/model/tests/{entities,contracts}/{money-account,transfer}.test.ts'
  - 'backend/src/db/{money-accounts,transfers}-repository.ts'
  - 'backend/src/usecases/{money-accounts,account-of,transfers}*.ts'
  - 'backend/src/routes/{money-accounts,transfers}.ts'
  - 'backend/tests/{money-accounts,transfers}*.ts'
  - 'backend/drizzle/*{money_accounts,account_transfers}*.sql'
  - 'frontend/src/**/*{Account,account,Transfer}*'
  - 'frontend/src/components/{ReconcileSheet,UnassignedSheet,ChargedField,HeldFromAccounts}.vue'
  - 'frontend/src/components/{OperationRow,OperationSheet,OperationIncomeSheet,OperationExchangeSheet}.vue'
  - 'e2e/accounts.spec.ts'
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
  an operation on that day is history and moves nothing. **An account made on its own start day
  starts at the moment it was made** (MOL-250, owner's decision 06.10.2026): the start typed is what
  it holds now, so an operation of that day counts once the server got it after the account
  (`writtenAt`, never `seenAt`), and one written before and given the account later is already in
  the start (В-1). A trip is measured by when the server had it finished — the money leaves at the
  till — or started while it is open (adversarial А1): begun at the shelf before the account and
  paid after, it is the account's money once finished. The owner made «Доллары» with 0 for today and wrote two exchanges
  onto it: the roubles left the sheet's account and nothing arrived. `created_on` is the phone's day
  of making (`TODAY_HEADER`), the accounts before it Yerevan's by migration (В-3); a start moved to
  another day is that day's evening again, and a start on a past day stays its evening (В-2), so the
  sheet's accounts did not move. Checks and «не попали» look from the same moment (`markOf`). **The
  price, named:** a spending made at 11:00 and typed in at 12:30 onto an account made at 12:00 counts
  twice, and so does one typed offline before the account and delivered from the queue after it; a
  check names both. An open trip begun before the account moves it only once finished. Editing the
  start keeps its moment — it corrects what the account held when made (adversarial А2), which is
  what the sheet's hint says. **A trip is dated by the day it started** —
  the money left at the shelf — and moves its account while still open (Р-29): dated by its finish,
  a trip left open, or finished after midnight, was taken a second time from a start that already
  counted it (adversarial Д4). The day is the phone's where it is earlier than the server's — the
  earlier of the server's start and the device's finish — or a trip begun offline in the evening and
  delivered after midnight took the next day (owner's decision В-6, review Р2-3). A device's finish
  more than a day before the server's start is a wrong clock, not an evening offline, and the server's
  day stands (adversarial Ж1). **A trip recorded from a receipt is dated by the receipt's day**
  (MOL-126): a day the person confirmed on the review — the printed one or their correction of it —
  not a clock's moment, so a week-old receipt moves its account a week back rather than today, as a
  wrong clock would. The server holds only that it is no day still to come; the receipt's row stays
  while its trip does (a recorded receipt is not removed), so the date does not move later. The month of
  «Деньги» still dates it by the finish. **The price, named** (adversarial Е2): a trip continued on
  later days moves its account on its first day, and one begun before an account's start and
  continued after it is history whole — the start line is drawn once, when the account is made. One loading of all five kinds (`operations`) feeds the balance,
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
  removed, a receipt's sum typed, changed or taken off; under a receipt's sum a price is not the
  trip's money and takes nothing off (MOL-78, review 1): the figure was what left the account for the trip as it was, and kept, it counted a
  purchase it never covered the day a dollar one was added; the check names the trip until it is
  entered anew. **A spending's is kept through a change of its amount** (MOL-123, by the letter of the
  requirement — only a change of account clears it): it stands under the sum in the same sheet, where
  a trip's is typed apart from the purchases. **The price, named:** 10 $ amended to 12 $ with the old
  «списано» left moves the account by the old figure, and the check does not name it. **Nothing
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
  without «списано», a trip on it with purchases that have no price and no receipt's sum (MOL-78:
  with one the trip's money is known whole), one no rate counts. «Since» is
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
- **A check is dated by the phone's today** (MOL-121, adversarial М, И) — the request's
  (`TODAY_HEADER`), as every «today» of money is — and «Записать разницу» with it. Dated by Yerevan's,
  a check at 23:30 in Moscow was of tomorrow and the next month, and east of Yerevan what was typed
  on the phone's day before an even check stayed «after» it, so the window did not close. A trip is
  dated by the phone's day of «Начать» (`started_on`), not more than a day before the server's —
  the rule of Ж1 above. **A check sent again under its name keeps the day it was first written**
  (adversarial round 2 Р): «Записать разницу» repeats it once the correction lands, maybe after
  midnight, and the check stays beside its correction.
- **«Не попали в остатки» is per account, not per currency** (Р-16): an operation with no account
  that could still explain a difference of some live account of its currency — after its start and
  its last check that came out even. A fresh check of the card does not hide last week's cash; a currency with no
  account is not asked about.
- **«Сколько было до обмена» from the accounts is a hint** (Р-9, Р-20): the balances of the currency
  at the end of the day, the exchange amended left out, and nothing when an account of it starts on
  that day or later. Put into the wallet in silence it would have re-priced the months (MOL-73 В-6).
- **A transfer moves two balances and nothing else** (MOL-253, owner's case of 08.10.2026: «Папина
  карта» −2 020 $, «Доллары» +2 000 $). Money moved between two of one's own accounts of **one
  currency** — between two it is an exchange, which has a rate (Р-2). It is in no month of «Деньги»,
  no «Бюджет», no «Графики», no «Траты», and no link of the wallet or the person's own rate: written as
  a spending and an income it swelled «Пришло» and «Потрачено» by its sum and re-priced the currency
  by the bank's rate of its day. Two halves of one `AccountOperation` kind `transfer`, as an exchange's
  (`side`, `counterpart`); their key in a list is by side, the currency being one. **Both accounts are
  required, the owner's, live and of the money's currency** — the keys hold whose and which currency,
  the use case's lock the rest: **a transfer is written with a connection, never from a queue, so an
  account it cannot be on is a refusal** (`error.transfer_account`, 409), the one exception to «без
  счёта, never a refusal» — written without an account it would be no transfer at all. Decided under
  the owner's lock, the one an account's removal takes, so a transfer never lands on an account marked
  for deletion, and an account with a transfer is «убран», never deleted, its currency locked. A
  removed («убран») account still takes one — an old transfer is amended over it — and is never
  offered. So it is never a check's reason and never in «не попали». «Остаток» of the month keeps its
  «всего» and moves «без сбережений» when one side is savings — money taken out of the piggy bank.
- **Its fee is an ordinary spending** (Р-1): a row of `spendings` in «Прочее» of the source, on the
  transfer's day, in its currency, at the rate of its day, pointing at it (`transfer_id`, one fee a
  transfer) — so every reader of spendings counts it with no second count, and it is in the month.
  Written, amended, removed and brought back by the transfer's use case alone, in one transaction, a
  millisecond before the transfer so the journal shows it under it (handoff 03); `/spendings` refuses
  to amend or remove it (`error.spending_of_transfer`) and does not bring it back, and the spendings'
  timer leaves it to its transfer's. Its row says «Комиссия за перевод · Прочее · → Доллары» in the
  journal and «Прочее · комиссия за перевод» in «Траты» by `transferId`, in either language — no note
  is written — and opens the transfer's sheet (Р-5: two rows, never one). **An amendment keeps the
  version before it** (`account_transfer_revisions`, the fee with it), over the version it was
  opened on; a removal is a mark with its fee, «Вернуть» on the server for ten minutes and in the strip
  for its ten seconds (Р-8), one removal offered back at a time. **The fee's rate is a spending's**:
  kept by an amendment while the fee keeps its day and currency and the snapshot still counts it —
  taken anew, a corrected note moved a closed month by today's cache (adversarial А1). **A removal and
  «Вернуть» take the owner's lock** an amendment holds: removed between an amendment's read and its
  write, the transfer was marked and its fee written live beside it (А2).
- **On the phone** (`TransferSheet`, handoff MOL-253): the way in is «Перевести» under «Сверить» on an
  account's screen and «Перевод между счетами» under the total of «Счета», only while some currency —
  the account's own there — has two live accounts (`canTransfer`). «Куда» offers only the source's
  currency without the source and without «Без счёта», and the one account it can be is put in (Р-6);
  a change of the source's currency empties it. «Перевести» says the first thing missing — the source,
  a second account, the sum, the target, the connection (Ф-6); a refusal stands over it, as the
  exchange's (Р-7), and an account gone on another phone empties its side, marked, the rest kept.
  **A 409 on a new transfer is one already written under its name** — its answer lost, the figures
  changed since: the sheet reads it and becomes its amendment, saying so, so «Сохранить» writes the
  figures over it and never a second transfer (review С-1, А5); a conflict of an amendment says what
  is recorded now (С-4). A transfer a row could not read is said in the sheet — «не ответил» with
  «Повторить», or offline — never a sheet that rises and goes (А6). «Вернуть» is the answer's: too
  late is said, no answer puts the strip back; any later write takes it away, the removal being final
  then, and a newer removal's strip takes the older one's place (С-3, С-6). **Only a write that happened
  makes the removal before it final** — the server purges after `add` and `amend`, never before: a
  refused write left the strip standing over a transfer already gone (adversarial А7). A transfer
  removed answers its amendment 404, said with nothing to retry (А8) — and so does a row opened on it
  (А11) — by the API's own word only, a bare 404 being a shop's portal (А10), and with no cause the
  phone cannot know: removed on another phone and here a moment ago, which «Вернуть» still brings back,
  are one 404 (А12); that, and
  «already written», read «Счета» and move `accounts.transfers` like any write (Р2-1). Offline, a
  transfer that did not open says it opens with the connection and reads itself then (Р2-2).
  Every write answers with «Счета» whole, and `accounts.transfers` tells the journals and the month to
  read again. **The price, named:** one day for both halves — a transfer that arrives the next day is
  written on one; the fee only in the money's currency and only from the source; no list of
  transfers of their own; and «Перевести» floats as a secondary button under «Сверить» until the
  screen's actions go into its docked strip (MOL-194).
- **The prices, named:** the balance of a view counts live operations while «удалить или убрать» asks
  of every row — a spending in its ten minutes of «Вернуть» makes an account «убран» rather than
  deleted; an operation naming a marked account is in no balance until the timer unlinks it; a check
  keeps the count of its moment; a new price of a purchase already written does not move its trip's
  `seenAt` — a purchase has no moment of amendment; after «Прочее · сверка» the operation that made
  the difference is still in «не попали» until a check comes out even; and every read counts the
  owner's whole life, a rate per day of a foreign amount — measured at 81 ms on two years of daily
  spending and sixty exchanges (adversarial Д8), accepted.

## «Счета» on the phone (MOL-123)

The handoff of MOL-116 whole: a card on top of «Деньги» — gone since MOL-159: the number of live
accounts is the row «Счета» of «Деньги», and «Не попали в остатки» stands under the total of
«Счета» — the page `/money/accounts`, one account at
`/money/accounts/:accountId`, the sheet of an account, the check, and the choice of an account in the
sheets of a spending, an income, an exchange and a trip's summary. The phone adds nothing up; every
balance, total and difference is the server's.

- **One store for every screen that shows or picks an account** (`stores/accounts`, Р-1): the card,
  the page, three sheets and the cards of exchanges and incomes read the same page. It is kept per
  owner under `molvia.accounts` — the page with its `countedAt`, the «на 14:05» of offline, and the
  first page of the journals of the three accounts opened last — read back by the strict codecs. A
  write of an account answers with the page whole and is taken over any read still on its way; a
  landing of either queue reads it again — for a trip, any write that landed (`wrote`), since a
  price added, changed or removed moves the balance of the account the trip is on (adversarial И) —
  **while a screen of accounts is up** (`useAccountsOnScreen`): read for every purchase at the shelf,
  the dearest answer of the server went out beside the queue itself with nobody looking (adversarial
  round 2, Н2); every such screen reads it as it comes up.
- **A screen asks the page every time it is shown** (adversarial А): the page kept from an earlier
  launch is no answer, and an account's screen took its balance from it over a fresh journal. The
  balance is the newer answer's — the page once it answered in this session, else the journal.
- **A row of an account's journal carries the `revision` of its operation** (Р-2): a spending is
  amended from the journal, from «не попали» and from a check — offline too, through its queue.
  Exchanges and incomes open from their own lists: they need the connection they are written with.
  One component opens a row in its own sheet everywhere (`OperationSheet`), where the account is also
  changed. The row is the kit's `OperationRow` (MOL-176), the words of an account's operation
  `operationRowProps` in `accounts.ts`, `journalRowProps` those of «Траты» — two shapes of data, one
  row. A trip
  whose removal waits in the queue is shown in no journal, «не попали» or check (MOL-76).
- **The default is the screen's** (`defaultAccount`, `useAccountChoice`): the first live account of
  the operation's currency in the order of «Счета», following the currency until chosen by hand;
  an amendment opens on the account it was written with, a removed one too; a removed account is
  never offered. An amendment on an account this phone does not know sends its «Списано» back as it
  was, and an income or an exchange moved to another currency leaves an account that cannot hold it
  for the default. No account at all — no row. An income and an exchange offer only their own
  currency and never «Списано»; a spending and a trip offer the others with «Списано» under the row.
- **The check asks the fact first and shows nothing of the count until the server answers** — not in
  text, not in `aria`; the result is said through the app's live region and takes the focus. The
  same fact goes again under the same name, also after an answer that never came (Р-19). A reason
  is put right in its own sheet over the check, and the same check is sent again **once nothing put
  right is still waiting** — no spending, and no write of a trip but its start and finish (its account,
  its removal or «Вернуть», a purchase added, amended or removed) in either queue: «some queue landed»
  recounted before the trip's account did, and «Записать разницу» wrote the same money twice (review
  15, adversarial В); a priced purchase added to a trip on the account the same evening was written
  as «Прочее» and again with the trip (adversarial round 6, Н8). **Any answer that comes while
  something waits is muted** and «Записать разницу» with it, until it lands: a trip being removed is
  hidden from the reasons while the server still counts it, and the difference had no reason on
  screen (review 33); the muted difference says «пересчитаем». **Not waited on: a trip's write the
  queue will not send by itself** — behind a start standing on a question of «Покупки», or of a trip
  the server refused: waited on, it held every check of every account with nothing to say why
  (adversarial round 3, Н4). The check counts without it and says the trip waits for an answer in
  «Покупки». **But «Записать разницу» stays shut while any such write waits**: the difference it explains became
  «Прочее», and the trip's own money followed once the person answered — twice (review 36,
  adversarial round 4, Н5). Any trip's, not only this account's: a payment names the account it moves
  the trip to, never the one it takes it off, and a removal names none (review 37, round 5, Н6). Once
  the write moves — answered, or the question settled by itself — the difference is muted until it
  lands and the same check is asked again then (Н7); gone without being sent — a refused trip taken
  away in another window — it is asked again at once. A reason removed from its sheet is offered back in the check and in «не
  попали», where the person is. Only the newest answer is taken: a recount landing after «Ввести
  другую сумму» does not take the sheet back. A recount that failed leaves the difference stale with
  «Повторить»; offline is one yellow line, drawn by the connection and gone with it, never red.
- **«Записать разницу»** writes the server's `difference` as «Прочее» with the note «сверка» — read
  back as «Прочее · сверка» in either language. **Below zero**: a spending through its queue, named
  once per answer, and the same check once more after that spending has landed, kept in the store
  by the spending's name, so a closed sheet or another stuck spending neither loses nor holds it (В-5
  MOL-115); a reload before the landing loses the repeat. **Above zero**: the sheet of an income,
  filled — the sum, «Прочее», «сверка», the account and the day — which the person saves, answering
  «сколько было до» (owner's decision В-5 of MOL-123): an income written without it is a link that
  sets the price of the whole currency to the bank's (MOL-66 В-1), and it re-priced the person's rate.
  The income is named by the check's answer, as the spending is: an answer lost and a second «Записать
  разницу» are one income, and a 409 under that name is the difference written already — the check
  counts again (adversarial round 2, Н3).
- **An account is written with a connection only**, as an exchange: no queue, named once per opening
  of its sheet, and a 409 on a new one goes on as an amendment of the same account. The sheet decides
  «amend or new» by the account it was opened on, never by whether the page holds it (review 23):
  opened cold, a rename made a second account. An amendment goes over the version the form was
  filled from; a refused currency (an operation came meanwhile) goes back to the account's own. Its
  outcome is told once the sheet is away, and «Удалить» or «Убрать» on the account's own screen then
  go to «Счета» a task later — stepped inside the pop that closed the sheet, the step was lost. Onto
  «Счета» itself (`goUp`), never past it: a step back where it lies underneath, a replace onto it where
  «Деньги» does — an account opened from a line of the card stepped back to «Деньги», and its
  «Вернуть», which stands on «Счета», was nowhere (review 32).
  «Вернуть» of a deleted account goes with the answer, never with the tap; 404 is «too late».
- **A removed account's screen says so and offers «Вернуть» where «Сверить» stands** (owner's decision
  В-2); its sheet offers no «Убрать». «Все ›» stands while there is any account, a removed one too.
- **«По счетам на …: … · Подставить» under «сколько было до»** (owner's decision В-3): the server's sum
  of the accounts of the currency (Р-20 MOL-115), put in by a tap only; nothing below zero; no
  answer, no line.
- **The prices, named:** the journal of an account cannot say «и ещё N операций» — the server answers
  a cursor, not a count; the names on the cards of exchanges and incomes are the accounts' names now;
  the sheets of an income and an exchange over a check open once their list has answered, not on the
  tap itself.
