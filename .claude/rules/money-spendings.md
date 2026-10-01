---
paths:
  - 'packages/model/src/{entities,contracts}/{spending,spending-category,money,money-month,money-charts,money-chart-month}.ts'
  - 'packages/model/tests/{entities,contracts}/{spending,money,money-month,money-charts,money-chart-month}*.test.ts'
  - 'backend/src/db/{spendings,spending-categories,money}-repository.ts'
  - 'backend/src/usecases/{spendings,money-month,money-rates,money}*.ts'
  - 'backend/src/routes/spendings.ts'
  - 'backend/tests/spendings*.ts'
  - 'backend/tests/{salary-shift,month-rest,money-charts,money-chart-month}*.ts'
  - 'backend/drizzle/*spending*.sql'
  - 'frontend/src/views/Money*'
  - 'frontend/src/components/{Spending*,spending*,Category*,NewCategorySheet*,MoneyEntries*,MonthSwitcher*,UndoStrip*,FloatingDock*,BarChart*,DonutRing*,DonutChart*,DeviationBars*,PaceLine*,Charts*,RateLine*,ExchangeLosses*,charts*}'
  - 'frontend/src/composables/{useMoneyMonth,useMoneyCharts,useKeptAnswer,useChartPointer}*'
  - 'frontend/src/composables/useSalaryShift*'
  - 'frontend/src/components/SalaryShift*'
  - 'frontend/src/stores/{spendingQueue,queueing,spendingHandoff}*'
  - 'frontend/src/days*'
  - 'e2e/money{,-charts}.spec.ts'
---

# Money: spendings, the month, and «Деньги» on the phone

The detail behind the spending and «Деньги» lines of `CLAUDE.md`.

## Spendings and the month, on the server

**A spending is money spent outside a trip (MOL-73)** — the barber, the rent, the domain: a day, an
amount in its currency, one of the owner's categories, «что это» and «где» as free text
(`spendings`). The personal accounting layer of MOL-72, private as an income. It makes no item,
feeds no price and no verdict: a purchase at a shop is still entered in «Покупки», and the sheet says
so (В-2) — the boundary is held by the hint, not by a ban, because the owner's own sheet is full of
«кола, молоко, несквик… · ереван сити».

- **Categories are the owner's own** (В-3): every account is given thirteen presets the first time
  it asks — the handoff's ten and «Дом и быт», «Животные», «Документы» — and may make its own.
  **Removing one takes it out of the choice and erases nothing** (`archived_at`): the spendings in
  it keep it and past months keep their sums; otherwise removing «Продукты» would rewrite every
  month. A spending's category is the same owner's, held by a composite key, and a removed one of
  theirs still takes spendings — one queued offline must not be lost to a chip taken away elsewhere.
- **A spending in another currency keeps the rate of its own day** — the person's, else the central
  bank's, by the rule a trip started that day uses — written with it and never recomputed. The
  person's is **the pair priced by one walk of the chain and rounded once** (`walletCross`, review
  Р-1): two wallet rates divided after rounding lost 24 ֏ on 1 500 $. The bank's is **only a fresh
  one** (`isRateFresh`, Р-4): the cache's latest may be weeks old, and a snapshot kept for good has
  nowhere to say so — without one the spending is «не посчитано».
- **Every rate of «Деньги» is kept on the side whose number is at least one** — «390 ֏ за $», never
  «0,002564 $ за ֏» — the snapshot, a day's rate and the month's (`convertAcross` converts from
  either side): six digits of a small number are four significant ones, and 11 $ came out
  4 290,17 ֏ (С-1, adversarial Д2б).
- **What was spent is counted by the trip's rule, what came in by the bank's alone** (review Р-2,
  Р-3). A trip's line in another currency and a spending whose snapshot is not into the spending
  currency of now — none was known that day, or it was written before a move — are converted on
  the fly by the rule a spending's snapshot is taken by: ten dollars at the shop and ten at the
  barber's on one day come to the same, and drams of August stay counted after a move to dollars
  (Р-5, Д8). An income in another currency is the official rate of its day (MOL-66, В-1), never
  what the money already held cost. An amendment keeps the snapshot only while the day, the
  currency and the snapshot's use stay; otherwise it is taken anew. The price, named: on-the-fly
  lines move when an exchange of their period is amended (С-3).
- **The month is counted by the server** (`GET /money/months/:month`): spendings and **finished**
  trips — one line per currency of the trip's money, on the device's day of finishing, in
  «Продукты», read every time by `tripMoneyRows` so an amendment, the receipt's sum (MOL-78) or
  MOL-76's removal moves it by itself, **each line counting the purchases behind its own sum**
  (owner's decision В-7) — every purchase of the trip under a receipt, which stands for all of them;
  a trip with no price and a receipt's sum is a line, one with neither is none — what came
  in, the rest (MOL-134, below), the categories and every day's total; the journal comes forty rows
  a page, and a day cut by the page keeps its whole total. **The next page starts after the key of
  the last row shown** — day, moment, name (`journalCursorCodec`) — never an offset, which moved
  under the page with every write above it (Д3). The key is the row's own, so an amendment that
  moves a spending to another day moves it across the cursor: it comes twice, or not at all, until
  the journal is read from the start — which the screen does after its own amendment of a day (round
  2, Е3). A row no money can hold is «не посчитано», never a failed month (Д5, MOL-66's rule). A
  month is one of the days a rate may be dated by — `0000-01` is 404, not a 500 from Postgres (Д4).
- **A closed month is counted in the income currency by the rate of its last day, frozen the first
  time it is read** (`money_month_rates`): a new exchange today does not move August. **A fact of
  August amended later does** (owner's decision В-6): writing, amending, removing or bringing back
  an exchange or an income of a day lets go of the months frozen from that day on (`thaw`), and the
  next read freezes them again. The running month is never frozen, so today's exchange lets go of
  nothing. **A change of the rule lets go of every month** (owner's decision В-8): «мой курс / ЦБ РА»
  switched, or the income or spending currency changed — otherwise two past months stood on two
  rules, decided by which was opened first. A trip keeps its snapshot either way. The prices, named:
  a month read while the write is on its way may freeze without it; `thaw` runs after the write,
  not inside it, so a database failing between the two leaves the write done and the answer 500 —
  a repeat of a write or an amendment lets go again, a repeat of a removal does not, since the day
  is read off a live row; an official rate reaching the cache for a past day moves the wallet of
  that month and lets nothing go.
- **«Остаток» is the money on the accounts at the end of the month (MOL-134)**, not what came in
  less what was spent. The owner saw «≈ −306 828 ₽» over September where the sheet said millions:
  the roubles that bought the dollars on arrival were exchanges, not income (MOL-71), so even a
  running sum of «пришло − потрачено» came out near −220 000 ₽, and the sheet counts its rest from a
  starting capital — every account on the evening of 16.09, which the app already has as the
  accounts' starts (MOL-115). So the rest is **every live account started by the month's last day,
  its start and its operations dated up to that day** (`balancesOn`), and what is carried from month
  to month is simply the same money. **On the last day for the running month too** (Н-3): a spending
  may be dated tomorrow and «Потрачено» already counts it. **The price, named** (self-review 5): a
  trip is not a spending here — an account dates it by the day it started, open ones included
  (MOL-115, Р-29), and «Потрачено» by the day it was finished, finished ones only; a trip from the
  30th to the 1st is in September's rest and October's «Потрачено», and an open one is in the rest
  before «Потрачено». **In the income currency, always «≈»**: the spending currency by the month's
  own rate — the one «≈ потрачено» is counted by, frozen for a closed month — any other by the rule
  of «Деньги» on the last day, or today while the month runs. **Two figures** (owner's decision
  В-1): everything, and without the savings — «всего» and «можно тратить» of «Счета». **The balances
  of one currency are summed exactly and converted once** (adversarial В): each account rounded on
  its own made the same money on two accounts a kopeck short of it on one; a sum of nothing needs no
  rate. **Each figure is decided on its own, and names under it the accounts it misses** — by name,
  in their own currency, never a zero, and never summed with another: savings and a card in debt in
  one currency cancelled out into «не посчитано: 0 €» under both figures (adversarial А), and a
  figure the currency came to nothing in was told it missed them all (adversarial З); an empty
  account is in no figure and named nowhere (adversarial Д). **The operations no rate counted are
  counted for each figure** (`operationsUncounted`), as «Счета» says of each account: without it the
  figure looked whole in that month and every one after (adversarial Б), and one number could not
  tell which figure it was missing from — one on the savings misses «всего» alone (adversarial Е).
  **A removed account is in no month, past ones included** (Р-2), or «Деньги» and «Счета» disagree
  about which money there was — the price: removing an account with money thins the months behind
  it. **Not frozen** (Р-3): an amended spending of August moves August's rest as it moves its
  «Потрачено». An operation with no account is in no rest (Р-4) — «Счета» says «не попали». Before
  the first account the rest is «—» with the day the accounts begin (`accountsFrom`), and with no
  account at all «Завести счёт» (В-4) — unless every account there is was removed
  (`accountsRemoved`, self-review 4), when the way is «Вернуть» on «Счета», not a new one. Counted
  for the month shown only — the month before is read for «−8 %» alone (Н-6) — and **on the first
  page of its journal only**: the phone keeps the first page's figures, and every «Показать ещё»
  read every account with its whole history for nothing (self-review 3). A later page says `rest:
null` beside the same «Потрачено», and the contract says that this is not «no accounts»
  (adversarial Ж).
- **«Пришло» may take a salary into the next month** (MOL-134, В-2, В-3): with «Зарплата — в
  следующий месяц» on, a salary received on the chosen day or later counts in «Пришло» of the month
  after (`budgetMonthOf`), as the owner's sheet has it — the salary of the 25th pays for the next
  month. Only the source «зарплата»; the day of the income, the journal of «Доходы», the balances
  and the person's own rate go by the day it came. A day the month does not have moves nothing — «с
  31-го» in September (Н-7). The month names the moved days both ways (`shiftedIn`, `shiftedOut`),
  since the switch of months does not go past the running one and a salary of the 26th would
  otherwise just be missing from September. **The setting is the person's own, off by default**
  (`actors.salary_shift_day`, 1–31 or empty), **saved on the tap** (В-5) through
  `/actors/me/salary-shift`, never a field of the settings form: those four fields are also a trip's
  `context` and a draft on the shelf, and `/actors/me` is read strictly by an installed app that
  would have failed «who am I» on a new field (Н-1). It thaws nothing — a frozen month holds a rate,
  and «Пришло» is counted on every read.
- **Removal is the money rule, held by the server**: a mark, «Вернуть», final after ten minutes by
  the minute timer and nothing else (В-4) — no other write makes it final sooner, unlike an
  exchange's, and a spending sent again while it is marked is 409, not a new one (Д6). After the ten
  minutes a spending sent again is written anew, as a trip's row is — at once, not when the timer
  comes round (round 2, Е2). Erasure takes spendings,
  categories and frozen rates.
- **The names of one's own categories are checked under the owner's lock** (Д7): two phones adding
  «Такси» at once wrote two. A name equal to a preset's («Продукты» beside `groceries`) is the
  screen's to refuse — the server does not know the language of the chips (MOL-82).

## «Деньги» on the phone

**«Деньги» on the phone (MOL-82)** — the fifth tab, between «Оценки» and «Настройки»: the month
of `GET /money/months/:month`, the sheet of a spending, and one's own categories. The screen adds
nothing up.

- **«Деньги» is the summary of the month, «Траты» its journal** (MOL-159, owner's decision В-8 of
  MOL-155, handoff MOL-157 01, 02, 06): the owner found one screen of accounts, totals, exchanges,
  bars and the whole journal «очень сложно анализировать». The summary is the month, the card
  «Потрачено / Пришло / Остаток», «Куда ушли», and five ways out — «Траты» of the month shown, then
  what is «now» and not the month's: «Счета», «Обмен денег», «Доходы», «Категории» — **each with one
  figure from an answer the screen already has**: the rows of the journal and the incomes of
  «Пришло», counted by the server (`count`, `incomeCount`), the live accounts of the accounts' page,
  the person's own rate, the live categories. A figure not known yet is no figure, never a zero; the
  row is a way in either way. **`count` is the rows of the journal** (Р-1) — a trip in two currencies
  is two, as «И ещё N трат» counts — **and `incomeCount` the incomes of «Пришло»** (Р-2), a salary
  moved in counted and one moved out not: the figure stands under «Пришло» and speaks of its money.
  The price, named: «Доходы» group by the day an income came, so a salary of the 26th is September's
  there and October's in the count. Both are defaulted (`null`), so a month kept before them, or an
  answer of a server before them, reads; an installed phone of the version before fails the new
  field and is offered «Обновить», as with `slices`. **The tiles are figures, not buttons** — one way,
  one button: «Доходы» is a row; a closed month's rest is «На счетах 31 авг.». **«Траты»**
  (`/money/spendings`, `meta.parent: 'money'`) is the journal moved whole, not copied — the queue's
  rows, the pages, «Вернуть», the row of a saved spending brought into view — with the server's count
  and sum on top, «· N ещё не учтена» beside them. **The two share `useMoneyScreen`**: the month in
  the address, the sheet, the journal and the refusals. **«Добавить трату» is the strip under the
  thumb** (`#docked`, as «Сфотографировать чек», MOL-128) on both, in every state where a category is
  known; «Вернуть» floats over it. **A spending of another month moves «Траты» to it, never the
  summary** (Р-5): there is no row on the summary to bring into view. A newcomer's state has no button
  inside (Р-6) and no «Траты» under it, nothing to see there — the price, named (adversarial В of
  MOL-159): «newcomer» is a guess from the month and the month before, so a person back after a whole
  empty month is greeted as one and finds «Траты» by flipping a month back. **«Счета», «Обмен денег»
  and «Категории» keep their figures under the skeleton and the error** (adversarial Г): they are
  «now», read from answers of their own, and the month that failed is not theirs. **A spending of the
  month the server refused is named on the summary and leads to «Траты»** («Не принята N трат этого
  месяца», adversarial А): its row there is where it is put right, and the summary, which has no
  row, said nothing at all — the ring even said «трат нет». A finished trip opened from «Траты» leads
  back to «Траты» (`?from=money-spendings`, Р-12).
- **Every write of «Деньги» goes through its own queue** (`stores/spendingQueue`), by the rules
  of the trip's (MOL-24): storage is the queue, one at a time under `navigator.locks`, held by a
  lost connection, a 5xx, a portal, a `401` or a code the API did not say, sent only once the
  server has named the owner; any other refusal is set aside as «Не принята». Categories go
  through it too (owner's decision В-4), so «Такси» made at the till goes before the spending that
  names it. The three queues share `stores/queueing.ts` — the lock, the key of a kept write, what
  holds, the doubling pause (В-6).
- **The writes of one spending fold while they wait — only while nobody has begun to send them**:
  an amendment of one not yet sent rewrites its record; two amendments are one `PUT` over the
  revision the first was made on. **A write a send has begun on is marked on the shelf**
  (`attempted`), by whichever window sends it, and is never folded into again: its answer may
  have been lost after the server took it, and «not sent» and «no answer» are one thing to a
  queue (adversarial А, Б, В). A change made after it goes behind it, over the next revision.
  **Nothing is tried while the browser knows there is no connection**, so a write made at the till
  stays unmarked and foldable, and an answer that came and is not the API's — a portal — takes the
  mark off, since that request never arrived (round 2). The price, named (review Ф-1): a browser
  wrongly sure it is offline — some VPNs and WebViews — sends no spendings until `online` comes;
  the trip's queue and the ratings still try. A refusal that comes after the person removed the
  spending is dropped rather than shown — there is nothing left to fix (round 3, Р1). **A refused record or amendment takes the
  amendments behind it** into its refusal: they were made over a revision it would have made, and
  sent on they went over another device's amendment in silence (round 2, Н1, Н3). **Removing a
  spending nobody has begun to send takes it out of the queue**, and «Вернуть» puts it back; once
  a send of its record has begun, the removal goes to the server and 404 on it is done; «Вернуть»
  then takes the removal back while it waits, or asks the server to restore, never writing the
  spending anew. **A record the server already holds with other fields is this phone's own**, so a
  409 on a record goes on as an amendment over revision 1. **Every fold carries the account and
  «списано»** (MOL-123, Р-4): left out of an amendment the server keeps the account it had (Р-26
  MOL-115), so a fold that dropped them sent the spending back onto its old account; and once the
  owner has an account the sheets send it always, «без счёта» as an explicit `null`.
- **A spending in the queue is a row, never a figure** (requirements Р-3; the handoff asked
  otherwise and this rule wins): «Отправляем…» at the top of its day, «Правка отправляется» on an
  amended row whose figures stay the server's, a removed row hidden — unless «Вернуть» stands
  behind its removal in the queue (round 2, Н2) — and «Ещё не учтено: N»
  on the card — not for a record the month already shows (adversarial Л). A day only the phone
  knows of has no total; a row only the phone knows of shows what was last typed, since there are
  no figures of the server's to keep (review Т-4). The month is read again from the start
  whenever the queue has an answer — which also puts a spending moved to another day where it
  belongs (MOL-73, Е3) — keeping as many pages as were open.
- **The two figures the card derives are the model's**, `percentChange` and `shareOf`: a ratio
  of two sums the server gave, rounded as a person rounds. **«Включая 11 $ (≈ 4 290 ֏)» names no
  rate** (Р-2): `foreign` sums a currency over the month, and every spending in it had its own
  day's rate. The sheet converts while typing by `convertAcross` — MOL-24's exception — and only
  between the two currencies the running month's rate joins; a third says «Посчитаем по курсу дня
  траты» (Р-5).
- **Removal asks nothing; `UndoStrip` gives ten seconds** over the strip «Добавить трату», and
  stands still while a finger or the person's focus is on it — not the focus it puts on «Вернуть» itself, or
  the count would never run for a touch. **It stands whatever the screen becomes under it**: the
  only spending removed turns the month into a newcomer's, and the strip went with the button it
  shared a block with (adversarial Г). The server keeps the removal ten minutes; the strip is what
  the screen offers.
- **A date is shown in words over its native field** (`AppField`, `display`): «Сегодня, 27 сентября»
  is drawn, the field stays underneath to open the system picker and to be read by its own value,
  and Chrome's own calendar is kept unseen in its place — stretched over the field, it caught the
  sheet's «Сохранить». The spending just saved is scrolled
  into view on «Траты» once its row is there; a finished trip opened from there slides in as a push.
- **The sheet says «saved» after it has closed** (adversarial И): the move to the spending's month
  made while it was open was undone by the step back that closes it. It checks the day — a cleared
  picker or a day before 2000 would fall over in the queue's codec — and that the category is one of
  the chips shown, since one the server called unknown stands on none (adversarial Д, Ж).
- **A day is printed as a calendar day, never as a moment** (`calendarDay` in `days.ts`, review
  Т-1): `yerevanMidnight(day)` is the evening before anywhere west of UTC+4, and every date of the
  screen came out a day early on a phone in Moscow. The frontend's tests run in UTC on every
  machine (`TZ` in its vitest config), where such a slip shows.
- **«Сегодня» is the phone's day, on the phone and on the server** (MOL-121, owner's decisions В-3
  and «делаем все в 121»). On the phone it is `localDay`: the day a sheet offers and allows, «Сегодня
  · …» over the journal, the month «Деньги» opens on and the head of an exchange's or an income's card
  («Сегодня», «Вчера», `dayWords` — day against day, never a moment; the button and the rate keep the
  date, В-1), asked again when the app comes back into view (`useLocalDay`, adversarial Н). At 23:30
  in Moscow it is still the 28th for the person holding the phone, whatever the hour in Yerevan.
  **The server hears it on every request** (`TODAY_HEADER`, set by the client's `today`) and counts
  every «today» of money by it — the wallet and what a sheet asks «сколько было до» by (`ownMoney`,
  adversarial О), a trip's own and official rate at its start, the running month (its rate, what is
  frozen, «Остаток»), the charts, the balances and the day of a check (adversarial М, И). The hook
  holds it to the days that are today somewhere now (`todayFrom`: `earliestDay…latestDay`) and takes
  Yerevan's where none is named — the bot, a page older than the header. **Beside it the phone
  names its zone** (`ZONE_HEADER`, an IANA name, `isTimeZone`): a moment the server stamped itself
  is a day in it — the end of the day an exchange counts purchases from (`spentFrom`), the day the
  currency of conversion changed (`sinceDay`) — summer time included (`dayIn`, `midnightIn`); by
  Yerevan's, a purchase before a Moscow exchange at 23:30 was taken off its money twice, and a
  salary right after a change of the currency was «the old reckoning» (adversarial round 4 У, Ч).
  The zone of the request, not of the record: a person who flew since writing is judged where they
  are now. **A write is refused as «in
  the future» only past `latestDay`**: a queued write may leave a day later, and its day is judged
  against the latest day on Earth, never against the request's today. **A trip keeps the phone's day
  of its taps** (`started_on`, `finished_on`, adversarial К): the queue sends a start and a finish
  when it can, so the day comes in the body, worked out from the moment of the tap by the phone's
  calendar; «Деньги» file the trip under the day «Завершить» was tapped, beside the spendings that
  phone dated, and an account under the day «Начать» was — not more than a day before the server's
  (Ж1). A trip from an old queue has neither and keeps the server's day of the moment. The sheet of a
  spending lets an amendment keep its own day when it is ahead of the phone's — a spending typed on a
  phone further east (adversarial Л). End-to-end runs the browser in `Asia/Yerevan`, a phone in
  Armenia; the component tests run in UTC and hold the phone's day where it is not Yerevan's.
- **The categories are the owner's, not a month's**, so the newest month kept names them for a
  month not read yet: «Добавить трату» stands while the month loads, when it failed and offline on
  the first of a month (review Т-5, Т-6) — and does not, where no category is known at all. The row
  «Категории» stands before anything is spent too (Т-7). This month on the phone (MOL-121) is looked
  at again whenever the app comes back into view (adversarial З).
- **«Пусто» is read off the answer** (Р-6): the running month empty, no income, nothing the month
  before and nothing waiting. The server does not say «no history», and an empty August after a
  full July is «В этом месяце трат нет», not a newcomer.
- **The month is in the address and moves by `replace`**; there is no lower bound, since the
  server names no first month (Р-1). The last three first pages read are kept per owner
  (`molvia.money`), so offline is a strip over them. A next page asked for while the month is read
  again from the start is asked again from the fresh answer (adversarial Е).
- **A finished trip opened from «Деньги» leads back there** (owner's decision В-3):
  `?from=money` — `?from=money-spendings` since its row is on «Траты» (MOL-159) — and the route
  lists which `from` it takes (`meta.from`): an address must not make any screen the parent of any
  other. The chevron names the screen it came from — «‹ Траты» since MOL-159 — and steps back onto
  the same month (`backTarget` compares the path, not the query); opened cold, that screen is laid
  underneath with its own parents — «Траты» of the running month over «Деньги».
- **One's own category is made from the chips** («+ Своя», a sheet over the sheet, chosen as soon
  as it exists) **and kept on «Деньги → Категории»** (В-1): «Убрать» asks nothing, since it erases
  nothing, and «Вернуть» stands right under it. **A category that landed stays on the chips until the
  server's list names it** (`arrived`, found by e2e in MOL-123): it leaves the queue on its answer and
  the list is read again only after, and in between «Сохранить трату» said «Выберите категорию» over
  the one just made and chosen. A name equal to a preset in the language of the
  screen, or to a live one of one's own, is refused there. The colours are tokens — thirteen
  presets and a palette of eight for one's own, none red, olive, ochre or terracotta, each at
  least 3:1 on `--surface`.
- **«Куда ушли» is a ring** (MOL-156, owner's decision В-2, handoff MOL-157 01): the month's
  `slices` — `donutSlices` over `byCategory` on the server, six categories and the rest one
  «Остальные» (seven are all seven), each with its level in thousandths of the ring, shared out by
  the largest remainder so the levels add up to exactly `CHART_LEVEL` and the ring closes. The three
  largest are named beside it with the model's `shareOf`, the rest counted («Ещё N») — **only the
  sectors the ring draws**: one of no level, a bus ride beside the rent, is on no ring (adversarial
  Б). **The whole card is one way into «Графики → Месяц» of the same month** (MOL-158, handoff
  MOL-157 06), however old: the full ring of that month is there, with every category on its
  legend. Before MOL-158 it opened the period's bars on the ring's largest category (review 3 of
  MOL-156); the month tab is that question answered on the month itself. **An empty month keeps
  the card**, with no ring — still the way into «Графики», where the year is (handoff 01,
  adversarial Г). Its «В этом месяце трат нет» is said
  by the card itself since the journal went to «Траты» (MOL-159) — **unless a spending of the month
  still waits on the phone**: «нет трат» over «Ещё не учтено: 1» said two things. A category the month
  does not name is left out, never drawn as a second «Остальные» (review 7). **`slices` defaults to empty so that a month kept on the phone before the
  ring still reads through the strict codec** (review 6): lost, every month kept went with it
  offline. **The phone does not work the ring out for it** (review 9, owner's decision «а»): that
  would be a second exception to «the phone adds nothing up», for three months and one read. **A
  card with no ring says why, in the ring's place** (adversarial round 2, Е, Ж): categories and no
  sectors — a month kept before the ring, an answer of a server older than it — «Доли появятся,
  когда месяц обновится»; nothing a rate counted — «Доли появятся, когда у трат будет курс»; an
  empty month says nothing there. The price, named: offline, a month kept before the update has no
  ring until it is read again. Accounts are MOL-115's.

## «Графики» (MOL-74)

**The months of «Деньги» side by side** (`GET /money/charts?period=6|12`, `/money/charts`): spending
by month, what came in and went out, a category over time, the rate of the pair by week and the
exchanges against the central bank. Owner's decisions В-1…В-4 of 29.09.2026, requirements and plan
in `.scratch/tasks/{requirements,plans}/MOL-74.md`.

- **A bar is the month of «Деньги», never a second count** (requirements 4): every month of the
  period goes through `countMonth` — the function `GET /money/months/:month` counts one by — with
  the same rate of the month (`monthRate`), so reading the charts freezes a closed month exactly as
  opening it does (Р-4), a change of a past exchange lets it go for both, and the salary moves by
  `budgetMonthOf` in both. An integration test holds every bar equal to its month. The rows of the
  whole period are read once (`monthRows`, Р-3); the month before the first is counted for «к
  августу» alone, as on «Деньгах». **A write landing while the months freeze lets them go after**
  (`settleThaws`, adversarial Ж, Ж2): the exchanges and incomes are read once, by `dayRates`, and the
  months frozen one by one after, so one written in between found nothing frozen to let go and the
  month froze without it for good. Once the read has frozen, it holds the receipts and the rule of
  the rate against **the very rows the rates came from** (`DayRates.basis`) and lets the months go
  from the day of anything that changed — a snapshot of its own missed a removal and a «Вернуть» both
  inside the read, the row the same before and after. Run in `finally`, so a read that fails after
  freezing still settles. `GET /money/months/:month` does the same for a closed month; the race was
  MOL-73's, the charts widened it.
- **«Разница», not «Остаток»** (owner's decision В-2): the third figure of «Пришло и ушло» is what
  came in less what went out in the month, signed; «Остаток» is the money on the accounts
  (MOL-134) and one word must not mean two things on neighbouring screens. The price, named: the
  month of the move is deep below zero, since the roubles that bought the dollars were exchanges.
- **An average is of the closed months from the first with anything in it** (Р-5, Р-15): a person
  who started in August is not averaged over empty months, and the running month, half spent, is
  in no average. With no closed month of data there is no average. **A month with anything «не
  посчитано» has no «Разница» and is not in its average** (adversarial d9 В): a salary in dollars on
  a day with no dollar made the month «−25 000 ₽» and the average negative. **Its spending is
  averaged unless the spending itself is short** (review С-8, d9 round 2 В2): an income changes
  nothing spent. **A category's average leaves out only a month short in that category**
  (`uncountedIn`, d9 round 3 В3): a coffee in dollars with no rate dropped the month's complete
  «Продукты» from their «в среднем». A category spent nowhere in the period has no average, not
  «в среднем 0 ֏». The
  screen says under «Пришло и ушло» what did not convert, and «Ушло» with no rate of the month is a
  dashed empty bar, never a bar of nothing spent — **while nothing spent is «ушло 0» with or without
  a rate** (`moneyMonth`, review С-7), on «Деньгах» too: a newcomer's empty months with no rate were
  the tallest bars of the card.
- **Nothing the charts carry can fail the answer** (adversarial d9 А): a category's sum over the
  period, which may be more than money holds, orders the series and is never sent; a change past 2⁵³
  per cent — 0,01 ֏ then 10¹⁴ ֏ — is left unsaid. A month «Деньги» can show, the charts can show.
- **Every height is the server's** (`CHART_LEVEL`, thousandths of the tallest the card shows): the
  phone divides nothing, it turns a level into a percent of the card.
- **The exchanges are grouped by exchanger** (owner's decision В-1): «Где и заметка» read as
  `nameIdentity` reads a name, no note is «Без места»; the percent of a group is weighed by the
  money (Р-7) — the sheet's mean of percents let ten dollars with friends weigh what eight hundred at
  the airport did. The reads of the cache for the weeks and the exchanges go eight at a time, as «Обмен денег»'s
  (`RATE_READS_AT_ONCE`), and the card of exchanges before the line, never beside it (review С-11):
  53 weeks at once would take the whole pool, and two batches at once took sixteen of its ten. **Measured by the one function
  «Обмен денег» measures by** (`comparisonOf`), **but
  only by a rate fresh for the exchange's day** (adversarial Е): `comparisonOf` takes the bank's latest
  however old, and a cache stopped five weeks ago summed an exchange by a rate the same answer's line
  called «no rate». «Обмен денег» still sets each exchange beside the latest it has, printed with it —
  the price, named: an exchange of a week of silence is compared there and named here. And
  **summed in the spending currency** (Р-6): a difference in another currency — dollars from roubles
  — by the central bank of that day, since nobody named a price for it; without a comparison or
  such a rate the exchange is named («Без сравнения с ЦБ РА: N»), never summed. Twelve months
  whatever the period (handoff 03); nothing measured — no card. **Since MOL-159 the card is «Обмен
  денег»'s, against the market** (MOL-152, `money-rates.md`); `exchanges` of `GET /money/charts`
  stays, against the central bank, for the installed phones that read it, until MOL-160 changes that
  answer (Р-9).
- **The rate of the pair is the central bank's at the end of each week** (owner's decision В-4,
  Р-14): `rates.official` of every Sunday of the period and of today, fresh for its day or a gap —
  a gap is drawn as a break, never as zero. One side for the whole line, the one the newest rate
  reads at least one on (MOL-81); the person's exchanges of the pair, either way, are dots on their
  week. No pair — one currency for both — no card. The price, named: a week whose rate came from a
  fallback provider is not marked; the card says «ЦБ РА» of the whole line.
- **The geometry is d3-shape's, the components are ours, and there is no charting library**
  (MOL-156, owner's decision В-1, in place of Р-1 of MOL-74 «drawn by hand»). Measured by a build
  of one probe — a ring, twelve bars, a line: `d3-shape` added 3 KB gzip against a whole app of 267;
  chart.js 54 on a canvas that reads no token and gives a screen reader nothing, unovis 64 with 184
  packages behind it and a ring that kept its colour when the scheme changed, vue-data-ui 200
  turning every colour into hex, ECharts 185, ApexCharts 395 on a licence that charges a product
  used by other people. Every library brought its own touch, tooltips and accessibility, which
  the rules below already settle, and its own scales, which the server counts. The arcs and the
  curves are the one thing hard to write by hand, and d3-shape draws them from the server's levels.
  `BarChart` is HTML and tokens, `DonutRing` is d3-shape's arcs with a gap between sectors (none
  on one too narrow for it), `RateLine` is SVG whose
  strokes keep their width when stretched (`vector-effect`), a dot is a zero-length round-capped
  line so it is never an ellipse. The reading stands above the bars, never under the finger; the
  whole area is the target (`touch-action: pan-y` leaves the page its scroll), a mouse passing over
  chooses nothing. **The bars are radios and the weeks a native range**, so arrows move the choice
  and each says its month or week with its figure — **which is why the reading is not a live
  region**: the control already says it, and a drag would chatter.
- **A finger chooses on lifting, or once it goes sideways** (`useChartPointer`, review): chosen on
  touching, every scroll that started on a chart changed the reading under the thumb; a mouse or a pen
  chooses on press. **A new answer of the same period keeps the bar chosen** — the sources of the
  watch are compared one by one, since a getter of an array is a new array on every answer.
- **The category is in the address and moves by `replace`** — the period was too, until MOL-158
  made «Год» twelve months and `?period=` a way into it; the category chosen is kept for as long as
  the app is open, for a way in that names none, and the first one is the largest of the period
  (Р-8), not the handoff's «Кафе». **A category in the address comes first** — a link that names one
  leaves the one chosen before behind (MOL-156, owner's decision on adversarial round 2, Д); since
  MOL-158 the ring of «Куда ушли» opens «Месяц» and names none. **Every live category of the owner
  is offered**, spent in the period or not (adversarial А, d9 Г): a category sent from an older month
  was swapped for the largest, in silence, with its own id still in the address. One
  the answer still lacks — a removed category, a stale link — is named: «Этой категории на графиках
  нет — показаны …». Only
  the person's choice or the address is remembered. **Only the latest read is kept on the phone**
  (`molvia.charts`, adversarial Б, d9 Д): an earlier one answering late put the charts without the
  spending just written under a later hour; one whose later read is still on its way or failed is
  the freshest there is, and is kept (d9 round 2 Е2) — under the strip when that later read failed,
  since it is older than a write the phone knows landed (review С-10). Offline is a yellow strip with that hour; the four states
  are `ScreenSkeleton` and `ScreenState`, the empty one with no button (Р-9) — and the rate and the
  exchanges stand under it, since they do not wait for spending (adversarial В).

## «Графики → Месяц» (MOL-158)

**«Месяц · Год» on top, and under «Месяц» the month** (owner's decisions В-1, В-6 of MOL-155, handoff
MOL-157 03 and 06): `?mode=year` and `?month=` in the address, by `replace`; no `mode` is the month,
no `month` today's on this phone. A bookmark of MOL-74's `?period=` opens the year (`beforeEnter`).
**«Год» shows the cards of MOL-74 over twelve months until MOL-160** (owner's decision В-1 of
MOL-158): the period goes, `GET /money/charts?period=` stays as it was — the year reads it, and so
does an installed phone of the old version. Requirements and plan in
`.scratch/tasks/{requirements,plans}/MOL-158.md`.

- **The month is the month of «Деньги»** (`GET /money/months/:month/charts`): the same rows through
  `countMonth`, the same rate of the month by `monthRate`, frozen by this read as by opening it and
  settled after (`settleThaws`); an integration test holds the total, «≈», what was not counted and
  the sectors equal to `GET /money/months/:month`. **The months of the usual are counted with no rate
  of their own and never frozen by this read** (Р-3): the usual needs only their sums in the
  spending currency, which every spending already holds by the rate of its own day — as «the month
  before» of «Деньги» is counted. A new route, not a `mode` of the old one (Р-1): a month is a
  resource, and a field added to the month of «Деньги» would have failed the strict codec of every
  installed phone.
- **The usual month is the mean of the closed months before the one shown** (Р-5, Р-15 of MOL-74),
  from the first with anything in it, **at most twelve back** (`USUAL_MONTHS`, owner's decision В-2)
  — a year: every season is in it, and a new rent is forgotten within it — **and only from three**
  (`USUAL_MIN_CLOSED`, owner's decision В-2 of the review of MOL-157): one or two are an odd month
  dressed as a habit. **The three are calendar months** (Р-4), a half first month included — a month
  short in anything spent leaves the usual line, a month short in a category leaves that category's
  usual, as on MOL-74's charts, and neither moves the threshold, so the month it names is a date that
  holds. The price, named: in such a month the usual is of two. **The salary is moved in the usual
  months as in the month shown** (adversarial Е): counted without the shift, a salary of the 26th
  made its month one «with anything in it» that «Деньги» and «Год» call empty, and opened the
  comparison a month early.
- **Below three the answer names the first month that has a comparison** (`comparedFrom`, the first
  with data plus three) **and the months closed before the one shown** (`closed`), and the phone says
  «Сравнение — с октября · до сентября закрыты июль и август» — true of a past month as of the running
  one (adversarial Г): «появится после сентября, сейчас закрыты июль и август», said of a closed
  September on the 1st of October, promised a date already gone and named what was closed before it,
  not now. The cards stay and say so (handoff 3g), never hidden. A month past `9999-12` is no month
  to name, so it is null — no 500 of the answer's own codec (adversarial Ж). With a usual and no line
  — every closed month short — the pace says why, never that it comes (adversarial И).
- **The offer to a newcomer is for one with nothing at all** (`firstMonth`, the first month spent or
  come in, of the whole history; adversarial К): a month before the first with data is a grey ring of
  nothing, and its first month with a comparison is counted from that first month. A trip counts only with money — a
  receipt's sum or a price, `tripMoneyRows`, as «Деньги» file it (adversarial round 2, Н3): a trip of
  ratings alone made a person with nothing on «Деньгах» no newcomer. **A first month already past is
  named by no one** (Н4): with data a year and more back and none since, «с апреля» was April two
  years ago.
- **The running month is compared to the same day, a closed one to the whole** (owner's decision В-3
  of the review): on the 12th, 20 000 ֏ of groceries against a usual whole month of 60 000 was
  «−67 %», when by the 12th the usual is what was spent by the 12th. **The day is today, or the last
  day spent on when it is later** (Р-6): a rent dated the 15th is in the ring's total, and a line or a
  comparison stopping at today left it out. A closed month shorter than the day is read whole —
  February has no 31st (Р-10).
- **«Против обычного» is the five categories furthest from their usual, by the difference in the
  spending currency** (handoff 08, not in percent): a tie by the order of the chips. Spent and never
  usual is «новая» (`change` null), usual and not spent is «−100 %» with its mark in place — **unless
  the category was put away** (Р-5): «−100 %» of what the person removed is noise. **A sum not whole
  is compared with nothing** (adversarial Д): a category short in the month shown — a spending no
  rate counted — and one short in every usual month are no row, the rule a usual month is held to,
  both ways; the ring above names what was not counted. One scale for the
  card, its widest sum or usual. More is not worse: the change is an arrow and a number in the colour
  of the text, never red or green.
- **«Темп месяца» is the running total by day against the usual's** — for day d the mean of the
  closed months' totals to d — one scale for both lines. The usual's point is a ring and the month's a
  dot, the usual dashed and the month solid: told apart by more than colour. **The day is a native
  range**, as the weeks of the rate are, not a radio for each of thirty-one days (handoff 03 asked for
  radios); it says the day and both sums. The day on arrival is today in a running month, else the
  last (Р-7) — **worked out for every answer, and «running» by the phone's calendar** (adversarial
  round 2, Н1, Н2): taken as a choice, the day of an answer kept from yesterday stood over today's,
  and a September kept from when it ran opened on the 1st on the 1st of October. **Every word of «идёт», «на сегодня» and «сегодня» reads the same
  calendar** (review 3): an answer kept on the 30th, opened offline on the 1st, said «Сентябрь · идёт»
  over a pace already on the 30th.
- **The ring's sectors carry what they are in the income currency and who is in «Остальные»** (Р-2):
  «25 % · ≈ 15 821 ₽» is a conversion, the server's; the share is the model's `shareOf`. **A second
  tap lets a sector go** (review Р-4 of MOL-157); the chosen one is thicker inwards, the others
  dimmed, its row on `--surface-2`. **The centre is no live region** (review Р-6): the radio chosen
  says it. A tap on the ring finds the sector by its angle — the levels the server gave, turned into
  a turn — **and only on the band it is drawn as** (adversarial Б): the hole is the centre's words,
  the corners of the box are not the ring.
- **The sector and the day are the screen's, never the address's** (Р-9, handoff 06): a new answer of
  the same month keeps them — the sector while the ring still has it, the day while the line still
  reaches it (adversarial А, З): a sector gone into «Остальные» dimmed the whole ring with nothing
  chosen, and a spending dated tomorrow threw the day back to today. Another month lets both go.
  **The month of the address is never one still to come** (adversarial В), as on «Деньгах». **The last three months read are kept
  per owner** (`molvia.chartmonths`, Р-8) through the one memory the year uses (`useKeptAnswer`): only
  the latest read, offline or error decided after the failure, a yellow strip under the switchers.
