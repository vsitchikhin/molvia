---
paths:
  - 'packages/model/src/values/{rates,money,market-rates}.ts'
  - 'packages/model/src/{entities,contracts}/{exchange,income}.ts'
  - 'packages/model/src/entities/exchange-rate-chart.ts'
  - 'packages/model/tests/{values,entities,contracts}/{rates,money,market-rates,exchange,exchange-rate-chart,income}.test.ts'
  - 'backend/src/rates/**'
  - 'backend/src/db/{rates,market-rates,exchanges,incomes}-repository.ts'
  - 'backend/src/usecases/{exchanges,incomes,refresh-official-rates,refresh-market-rates,choose-trip-rate,money-rates,start-trip}*.ts'
  - 'backend/src/routes/{exchanges,incomes}.ts'
  - 'backend/tests/{rates,market-rates,exchanges,incomes}*.ts'
  - 'backend/drizzle/*{rate,exchange,income}*.sql'
  - 'frontend/src/views/{ExchangeView,IncomesView}*'
  - 'frontend/src/components/{Exchange*,Income*,TripRate*,OperationCard*,OperationSkeleton*,MarketRates*}'
  - 'frontend/src/composables/{useExchanges,useExchangeWords,useIncomes}*'
  - 'e2e/{exchange,incomes}.spec.ts'
---

# Money: the official rate, the person's own rate, exchanges, incomes

The detail behind the rate, exchange and income lines of `CLAUDE.md`.

## How the official rate reaches a trip

**How the official rate reaches a trip (MOL-39).** A trip snapshots it when it starts, from a
cache in the database — **starting a record never goes to the network** (the old «Начать поход»): a trip at the shelf does
not wait for a central bank. The API refreshes the cache itself, hourly, and at boot unless
the cache was written less than an hour ago — in development, unless it holds anything at all:
`make dev` restarts on every save
(`RATES_REFRESH`, on by default, off in end-to-end runs). The cache holds what the banks
publish — **one currency against the dram per day**, never a pair; the pair is built at the
snapshot, and an inverse or a cross is rounded there to the snapshot's six digits.

- **The CBA speaks SOAP only** — the GET form answers «Runtime Error» — and dates its rate by
  the day in Yerevan, with nothing on weekends: a Sunday trip takes Friday's rate, with Friday's
  date. The date always travels with the rate; «≈» without one is worse than an old number.
- **Two open sources stand in for it: the Bank of Russia, then open.er-api.com.** «The CBA is
  silent» has two faces and both count: five failures in a row, **or** an answer whose rate is
  over **seven days** old — a service stuck on its last date looks healthy. Every refresh still
  asks the CBA first; an open source as stale as the CBA sends the refresh on to the next one. A
  trip takes a fallback only when it is fresher than a CBA rate over a week old — a shorter bound
  would mark every weekend — and such a snapshot says `source: 'fallback'`. When nothing is
  fresher, the trip keeps the CBA rate with its date and `rateStale: true`: the screen says the
  bank has published nothing since. A pair is never built from two providers.
- **A jump is flagged, not refused (owner's decision).** A rate more than a quarter away from the
  lower median of its recent rates is stored with `jump`. Recent means: the central bank's own last
  five; an open source's own from the last week if it has three, and otherwise the central bank's
  — it is asked only when the bank is silent, so its own history is an old episode or nothing,
  exactly when a trip takes it. **Fewer than three earlier rates, no judgement:** with two the
  median is their mean, one ×100 day made the next right day a jump and offered itself as
  «previous». The trip remembers the jump and shows it always; beside the snapshot it keeps the
  rate before the jump when there is one no older than a week, and the person chooses — the jumped
  rate, that one, or their own for this trip, `personal` (`PUT /trips/:tripId/rate-choice`). The
  snapshot is never rewritten — only the choice moves.
- **Strict or nothing:** an answer missing a currency, carrying a zero or a negative, dated by a
  day that is not one — `0001-01-01`, `1970-01-01`, the 31st of February — or past tomorrow —
  `9999-12-31` — is not written at all. A stale rate with its date beats a mixed one.
- **An empty cache gives a trip no rate, for good** — the snapshot is written once and never
  filled in later (owner's decision, 19.09.2026).
- **A failure is a line in the log, never the error whole (MOL-153).** A feed throws a `FeedError`
  for everything it can tell, and that is logged as said — it speaks of a public address, never of
  a person: a request with no answer in the words of its `cause` (`reach` — a host not found, a
  `redirect count exceeded`, an expired certificate, a timeout), a page in place of JSON as
  `not JSON`. Anything else, a failed write above all, is logged by its kind through
  `describeFailure`: pino writes an `err` whole, and a `DrizzleQueryError` carries the query and
  its parameters. The cause a deploy needs (MOL-39, С-2: a block by geography against a dead DNS)
  is in those words; a code alone was not enough — a redirect loop has none (adversarial Б).
- **The cache has the central bank's history since 2022 (MOL-137, owner's decision В-5).** Before
  it, everything dated more than a week before the first hourly refresh — an income in dollars, a
  month, an account, the losses on exchanges, the whole import of MOL-71 — had no official rate at
  all, since every reader but a trip's takes only a rate fresh for its day. Once a day the refresh
  asks `ExchangeRatesByDateRangeByISO` for everything from `OFFICIAL_HISTORY_FROM` — one answer, a
  fifth of a second for two years, measured — and writes **only the days the cache lacks**: a kept
  day stays as it is, jump mark included, since trips took from it. A new day is judged for a jump
  as it would have been had it come on its day, against the central bank's five before it, kept
  and new together (`missingDays`). The answer is read as strictly as the latest is: a day missing
  one of the currencies refuses the whole archive — measured on 30.09.2026, the whole of it since
  2022 reads (3 588 rows, 0,8 s). A failure is a line in the log, by its kind unless it is the
  feed's own words, and it is asked again in six hours (`HISTORY_RETRY_MS`), not every hour: a
  refused archive stays refused, and it is half a megabyte — a day past tomorrow in it refuses it
  the same way (review П-4); a hole a failed week leaves closes
  itself within a day.

## The person's own rate, from exchanges

**The person's own rate comes from exchanges, never from a number typed in (MOL-40).** The plan's
decisions of MOL-41 (22.09.2026) replaced «enter your rate once and edit it» with the operation a
person actually performs: «gave 20 000 ₽, got 95 000 ֏, on this day» — `exchanges`, named by the
device, private always. The rate is what the two amounts say and is not stored beside them.

- **The wallet is the average cost of what is held, and spending does not move it** — it takes
  money and its cost away in one proportion. Only a new exchange does, and the weight of the old
  money in it is exactly how much was left at that moment: `heldBefore`, optional, asked once the
  received currency already came in by an exchange — never of the currency of conversion, which
  always costs one. Unknown, the wallet takes that exchange's rate and says so
  (`basis: 'last'`) rather than counting the remainder as zero in silence; before the first there
  is money of no known cost, so the first exchange never asks. Not derived from purchases: a price
  is optional and spending outside a trip is not written, so a sum of expenses would be a wrong
  weight presented as a right one — it is offered only as a hint, «по записанным тратам».
- **Every currency has a cost in the currency of conversion, and one rule moves them all (MOL-42).**
  Receiving money costs what was given for it, at the cost of that; giving money away moves
  nothing, as spending does not. So roubles → dollars → drams carries the price of the dollars
  into the drams, an exchange back into the currency of conversion leaves the wallet where it was,
  and dollars getting dearer later do not re-price drams already bought. The owner's own journal
  is why this is 0.1: two thirds of their drams came through dollars, and the pair alone did not
  see them. The screen lists the price of every currency a chain went through («89,04 ₽/$») so
  the drams' rate can be checked by eye. Stored per currency, never per account: a dollar on a card
  and one in a pocket cost the same (MOL-43 decides accounts, not costs).
- **Money of no known cost is valued at the official rate of the exchange's day, and says so**
  (В-1): dollars brought from home, whose price in roubles nobody wrote down. What the person
  named counts as named, what they did not comes from a source — never as zero — and the wallet
  carries `estimated` for as long as that part is in the mix. The official rate is taken by the
  rule a comparison uses (a jumped rate gives way to the one before it); none in the cache for
  that day, and the cost is unknown until an exchange starts it afresh — the trip then takes the
  bank. Only a rate fresh for that day counts, by the week a trip allows — the rule for a trip falls
  back to the freshest it has and says `rateStale`, and here nothing would say it (Ж3). The cache
  is read once per day of the list, eight days at a time, and serves both. A wallet missing above
  a list of exchanges says which exchange its cost was lost on (`walletUnknown`), never «no
  exchanges yet».
- **A change of the currency of conversion works forwards** (В-2, the owner's comment over the
  option they ticked): «what I exchanged before is not re-counted». `actors.income_currency_since`
  is the day of the last change — the settings' own `UPDATE` sets it on every change, and a repeat
  of the form does not move it — and **before it no price is ever taken from the bank**: an
  exchange counts when what was given already has a price in the new currency without one — the
  new currency itself (dollars to drams, for someone who now counts in dollars), or a currency
  priced by the links counted so far (euros → dollars → drams, for someone who chose euros later).
  Roubles to drams belonged to the old reckoning and are not re-valued; the drams they brought have
  no price in the new currency, so the link makes their cost unknown rather than vanishing — a
  vanished link let the next dollar exchange weigh rouble drams at the price of dollar ones (review
  round 3, М1). The rows cannot tell a chosen currency from the default `RUB` every account starts
  with, and this rule does not need them to: attempts that cut by the day alone took the whole
  dollar history of anyone who once changed leftover roubles (Ж2, Л1). Which exchanges gave their
  currency a price only the whole walk knows, so the server says it per row (`priced`) and the
  sheet asks «сколько было до обмена» when the latest exchange into that currency on or before the
  chosen day is priced — the currency _has_ a price then, not merely had one once (round 4, Н2) —
  and when this exchange will give one: paid in the currency of conversion, in a currency with a
  price that day, or on or after the day of the change in anything the bank can price (round 5,
  О1). The flags are the server's; the one case the phone cannot see is a week of the bank's
  silence, when it still asks in vain. A wallet lost to the old reckoning says so in its own words
  (`walletUnknown.reason: 'oldReckoning'`), since «no bank rate that day» would be untrue (Н1). Earlier exchanges stay in
  the list as they were. A trip started offline with the old currency in its `context`
  is not cut — the cut is about the current one.
- **Exact to eighteen digits, rounded to six once.** `walletRate` keeps ratios of integers through
  the chain, each link brought to 10¹⁸ (the exception under «Money and quantity rules»), and rounds
  to the snapshot's six digits at the end, the way a cross rate is rounded. The screen walks the
  chain once (`ownRates`) for the wallet, the prices and the reason a wallet is missing.
- **A trip takes it at the start, like the official one, and never again** (В-4): with
  `actors.rate_preference = 'personal'` — the default — and a known cost of the spending currency
  dated no later than today in Yerevan — by an exchange of the pair, a chain, or an income alone
  (MOL-66) — the snapshot is `source: 'personal'` with no provider and no jump; otherwise MOL-39's
  branch as it was. Nothing is required of the person: without exchanges and incomes the two
  preferences are the same answer. An exchange or an income made while a trip is open moves the
  next one.
- **Every exchange is set beside the central bank of its own day**, by the same `pickOfficialRate`
  a trip started that day would use — «на 8 754 ֏ больше» or «меньше», never «комиссия»: a good
  exchanger beats the bank, and the difference says nothing about why.
- **An amendment keeps the version before it** (MOL-42, В-3): the rate of a past exchange is a
  fact, so `PUT /exchanges/:id` writes the old version into `exchange_revisions` and the new one in
  place, `created_at` untouched so the exchange keeps its place in its day. It names the version it
  was made over (`revision`): the exchange already as sent is a repeat, 200 and no new version; a
  version another device moved on from is 409, as the settings form is; removed or someone else's
  is 404, and a conflict keeps the sheet open with what was typed, over the version held now —
  which the sheet itself shows, remainder included, since the list that has it is under the sheet
  (round 2, Л4; round 3, М2). A
  remainder the exchange has is shown in the sheet whatever a new exchange would ask: an amendment
  replaces the exchange whole, so a field not shown was a field cleared. The row is a button named
  by its words — an `aria-label` silenced the rate and the comparison. The row says «исправлен», the sheet shows the versions — which is what explains a trip
  that took a rate the exchanges no longer say. The history goes with its exchange: a removal made
  final and erasure take it by cascade. «Где и заметка» is one private line, part of a repeat.
- **Removing is still there, for an exchange that should not exist.** Trips already started keep
  what they took. **The bin asks first, with the amounts and the day, and «Вернуть» stays offered after**
  (owner's decision В-5). A removal marks the row (`deleted_at`) and hides it from every reader;
  «Вернуть» (`POST /exchanges/:id/restore`) clears the mark, so the exchange keeps its
  `created_at` — written anew it took the moment of the tap, which moved both the order of its day
  and the hint. **A removal is final after ten minutes** (`EXCHANGE_UNDO_MINUTES`, owner's decision
  В-7): the server's minute timer deletes older marks of everyone, and the owner's next request of
  the screen deletes theirs sooner — the moment the screen stops offering them back. The screen
  withdraws the offer on an answer, never on a tap: a write lost on the way, or refused before it
  reached that point, leaves the removal undoable, and «Вернуть» stays. Both
  «Вернуть» and a removal are safe to send again after a lost answer: an exchange already back
  answers 200, and a removal never makes final the row it is marking. A «Вернуть» that comes too
  late is told so, and the list is read again — not «check the connection», which sent people to
  enter the exchange a second time.
- **A repeat is the same exchange, or it is a conflict** (В-6). The same name with the same
  amounts, day and remainder answers 200; with anything else, 409 — that is a correction sent
  after an answer that never came, and answering it «saved» left the typo in the wallet. The
  screen then shows what was written and says to tap it and amend it.
- **An exchange no rate in the band says is refused where it is written** (`error.invalid_rate`),
  never accepted and dropped from the wallet later: a zero too many once made the wallet vanish, the
  trip take the bank in silence and the screen say there were no exchanges above a list of two.
- **The hint counts what was spent after the exchange, in trips still open then** — a purchase
  added to a finished trip was paid with the money held before. «After» is the moment the exchange
  was written when that was on its own day, and the end of its day for one written later: counting
  from the record threw away everything bought between the exchange and its entry. Without a remainder named
  at the last exchange it speaks of that exchange's money only. A day's official rate that jumped
  is never an exchange's measure: the rate before the jump is, or no comparison at all.

## The market, from the central bank's statistics (MOL-137)

**The official rate is the middle of the market, and nobody changes at it** — for the rouble it sits
by the banks' selling side: on 29.09.2026 the bank's rate was 4,3187 while banks bought cash roubles
from people at 4,110. Set beside it alone, every exchange of roubles read «less than the central
bank», a good one too. The central bank also publishes what banks and exchange offices actually
gave their clients — weighted averages of a day's deals, official statistics and not a scraped
aggregator (rate.am stays rejected). **The market is only what an exchange is set beside, never a
rate anything counts by**: a trip, a month, the wallet and an account take the official or the own
rate exactly as before.

- **Three files, each read on its own** (`backend/src/rates/cba-market.ts`), in the hour of the
  official refresh and after it: `FX_bybranch_ENG.xlsx` — people in banks, cash and non-cash, one
  day only, overwritten daily, dated D and published the morning of D+1, so the table keeps it or
  nobody does; `FOREX ENG_Daily.xlsx` — banks with every client, people and companies, every working
  day since January 2022, the row of D the same day; `FOREX ENG.xlsx`, sheet 6.18 — exchange
  offices, one week at a time about ten days late, each row dated by its own text, the reporting
  period above the table not trusted (on 30.09 it named 20–27 September over rows of 14–20). An
  empty row is passed over, never read as the end of the table: a blank line between two days made
  the rest of the week vanish in silence (adversarial review, round 3, Г). The directory's index
  answers 401: the names are written in the code.
- **A file is downloaded only if it changed — by its `HEAD`, not by `If-None-Match`.** The bank's
  server ignores the conditional headers and answers 200 with the whole file (measured 30.09.2026,
  adversarial review Б): asked by its tag, the daily history came a megabyte and an exceljs parse
  every hour. Its `HEAD` names the same `ETag` and `Last-Modified` with no body, and the file is
  asked for only when they moved. The version is kept only once the file is written — a refused
  file is asked afresh the next hour. **The ceiling of twenty megabytes is held before the body is
  in memory** (review В): a length past it on the `HEAD` or the answer refuses at once, and a body
  with no length is read in chunks and cut off at the ceiling.
- **Strict or nothing, as the official feeds** (Р-7): a header cell not where it was, the sheet
  renamed, a rate zero, missing or a text, a day that is not one, a day after today, days out of
  order, a currency twice or missing from a day, a row with a currency or a rate and no day — and
  **a figure over a factor of two from the official rate of its day** (`isMarketPlausible`,
  `MARKET_BAND_FACTOR`) — refuse the whole file. **Fifteen percent was the first bound, and the
  central bank's own file refuted it** (adversarial review А): on 3 March 2022 banks sold roubles
  27.5 % above the official rate, and with the history since 2022 in the cache — written by the same
  hour, just before the market — the daily file was refused every hour for good, and non-cash never
  had its stand-in (В-2). A market in a crisis stays within a factor of two; what the bound is for
  does not — a volume or a sum in drams read for a rate is thousands of times away, a rate per ten
  or a hundred units ten or a hundred. **What no band catches, this one or fifteen percent, is the
  column next door** (review П-7): the euro read for the dollar is 13 % off, a side or cash for
  non-cash one or two — those are held by the header cell over every rate column (`expect`), and the
  band must never be narrowed on the hope of catching them. The measure is a rate the bank did not
  jump on (review А′): held against a comma in the wrong place, the right file of that day was
  refused, and a day of people in banks has no archive. A day the official history does not reach is
  vouched for by the header alone. The two files meet in a test of their own
  (`market-history.integration.test.ts`) — nothing smaller shows it. Logged as the feed's own words,
  which name a cell of a public file; anything else by its kind (`describeFailure`).
- **Read through exceljs** (owner's decision В-7, against the narrow reader recommended): the price
  is 2,2 MB of bundle, some 185 packages and two moderate advisories through `uuid`, and a load of
  one to five seconds — asynchronous, the longest block of the event loop measured at 126 ms. The
  ESM bundle's `createRequire` banner is what lets its `require('crypto')` run. A sheet is read into
  its cells once (`readSheet`), and every reader works over those (`sheetOf`), so a test changes a
  cell of a recorded file instead of writing a workbook back — each write took seconds. A merged cell
  reads as its first cell everywhere it covers: the files merge a currency down its block, so the row
  of people is found by the currency **and** the branch, never by the currency alone.
- **`market_rates` is a mirror of the files**, apart from `official_rates`: «channel + currency +
  side + day», drams per unit at six digits, rewritten by its file. No owner, so neither erasure nor
  the copy touches it.
- **The side is the bank's, in the files' words** (Р-1): `bankBuys` is where the person sells.
  `marketSideOf` is the one place an exchange becomes a side: given a currency for drams, the bank
  bought it; given drams for a currency, the bank sold it. **A pair without the dram has no market**
  (В-4): the files know every currency against the dram only, and roubles into dollars may have been
  changed in Russia, where the Armenian market says nothing.
- **An exchange is set beside the best figure of its day for the person** (owner's decision В-1, the
  comment over the option ticked): the highest when the bank bought, the lowest when it sold, among
  the channels a person can name — bank in cash, bank non-cash, exchange office — each by its row of
  that day or the latest within the week (Р-2, the official rule); **the exchange offices by their
  row of that very day only**: they publish every day, and the week before is exactly what their
  late file holds — taken as the day's, it became the best over the banks' same-day figures and hid
  «still to come» (review, major 1). **And beside its own channel, when the person named it and it
  is not the best.** The channel is optional («Как меняли», `exchanges.channel`, null is «not
  said»), a fact of the exchange: part of a repeat, kept in the versions, amended like the note;
  left out by a screen older than it, kept by an amendment and matching anything in a repeat, as an
  account is. A new exchange starts from the channel of the latest-dated one. The sheet names the
  channel in the versions and in «Сейчас записано»: changed alone, it read as «nothing changed»
  (review, major 2, as М2 for the remainder). A channel-only amendment is an amendment like the
  note's — a version and a thaw from its day — a named price.
- **Non-cash before its collection is all bank clients; nothing else stands in** (В-2): that row runs
  within a tenth of a percent of people's non-cash, and two and a half percent off their cash for the
  rouble — standing in for cash, it would make every cash exchange of roubles look worse than it was.
- **Exchange offices still to come are said, not guessed** (В-3): until the file reaches the day,
  the best is among the banks and the card says the offices will come; when they do, the line is
  counted again by itself. Past the file's reach a day simply has no row. Before the file was ever
  read, only a day within three weeks of today waits (`EXCHANGERS_LAG_DAYS`): the file never carries
  old weeks, and «will come» over an exchange of 2022 was untrue (review, minor 8).
- **«Курсы по данным ЦБ РА»** on the screen (В-1): per currency the official rate of today and each
  channel's latest figures to sell and to buy, each dated by its own day — non-cash over a week old
  gives way to all bank clients fresh today (`marketQuotesToday`). The official rate there is the
  central bank's own or none: the block's words name it, and an open source standing in would be
  named the central bank (review П-3). The best is marked among the figures of the latest day still
  fresh today — an exchange office of last week is shown, not starred beside today's banks, as a card
  sets it only beside its own day (review П-5). The server marks it; the phone compares nothing.
- **On the card the market comes first and the central bank under it, a step quieter** (Р-5).
- **«Обмены против рынка» sums each exchange as its card measures it** (MOL-152, folded into MOL-159,
  owner's decisions В-1 «в», В-2 «а», В-3 «а»): the twelve months to today by place, worst first, at
  the top of «Обмен денег» — the card that stood on «Графики» against the official rate, where every
  rouble exchange read as a loss. **Against its own channel when the person named it, else the best
  of its day** (`market.own ?? market.best`, В-3): a place is compared with the market of its kind,
  cash with cash, as the handoff and MOL-161 have it. **One comparison per exchange** (Р-15): the sum
  is made of the `market` the list already carries (`marketLossesOf`), so the card and the sum never
  disagree and the market is not read twice. The difference is in the received currency and comes
  into the spending one by the official rate of that day (`officialAcross`, the one «Деньги» count
  by); **with no market — a pair without the dram, a day with no figure — or no such rate, the
  exchange is named under «Без сравнения», never set beside the central bank instead** (handoff 05),
  in words that name no single cause — «рынка или курса того дня нет» (Р-13, adversarial Д): the
  bank never quotes a pair without the dram, and a market of the day with no fresh official rate to
  bring the difference into drams is the other way an exchange goes uncounted. An exchange of a day the
  exchange offices' file has not reached is measured among the banks, and the sum moves by itself
  when the file comes (Р-14), as the card does. **`losses` comes with `GET /exchanges` and with every
  write's answer** (В-2): a written exchange is in the sum at once; defaulted (`null`) for a server
  before it. No «≈ ₽» under the sum (review Р-7 of MOL-157): past differences at today's rate would
  creep with the rate.
- **«Курс рубля за 12 месяцев» stands under it, and its line is all bank clients** (MOL-161, handoff
  MOL-157 05, owner's decisions В-1, В-2 of 02.10.2026): the market at the end of every week of the
  same window as «Обмены против рынка» — Sundays and today, each week the latest row fresh for it by
  `OFFICIAL_RATE_FRESH_DAYS`, a week with none a gap, never a zero. **Only `banksAll` has a year of
  history** — people's cash and non-cash are collected from 30.09.2026, the exchange offices come a
  week at a time with no archive — so the legend names it («Рынок · все клиенты банков», Р-3): for
  the rouble it runs some 2.6 % above cash, and unnamed it read as the market the person changed at.
  **A point is the person's exchange on its own day, measured as its card measures it** — `market.own
?? market.best` of the list — **its percent made of the very drams of «Обмены против рынка»**
  (`marketMeasuresOf`, Р-4, adversarial В): counted apart from the money received, 100 ₽ bought for
  437,91 ֏ read «−0,67 %» on the point and «−0,66 %» on its place, rounded at different places;
  with no comparison there, none on the point — **and the mark from it ends at that
  market, never at the line** (В-1): roubles sold for cash at 4,15 when banks bought cash at 4,110 and
  all clients near 4,22 are «+0,97 %», and a mark to the line said the opposite. The line is the
  background, where the market went; with no market of the day a point has no mark and says so,
  and with a market and no central bank rate to bring the difference into the spending currency it
  has its mark, no percent, and says it is the rate that is missing (adversarial К).
  **The line is on the side of the pair's latest exchange in the window** (В-2), the others of the
  pair not drawn: the bank's selling rate is another line, and a purchase of roubles set on the line
  of their sale looked a windfall. **The pairs are the currencies changed against the dram in the
  window**, the currency of conversion first; with none, the currency of conversion alone, a line with
  no points, unless it is the dram; a pair with no figure in any week is left out, and with none left
  there is no card (`rateChart: null`). **Every height, position, percent and tick is the server's**
  (`rateChart`, `exchange-rate-chart.ts`): three ticks a step of 1, 2, 3 or 5 × 10ⁿ apart within the
  scale, multiples of that power — «4,30 · 4,60 · 4,90» — or one when none fit two digits; the phone
  names the months. **The scale is the figures, and no narrower than a hundredth of their middle**
  (`rateScale`, adversarial Г2): a flat year with an exchange 0,07 % off it drew those 0,07 % the
  whole height of the card; a year of the market spans ten percent and more and is drawn as it is.
  **A week with a figure between two gaps is a dot of the line** (adversarial Д), never left out. It
  comes with `GET /exchanges` and every write's answer, as `losses` does, and is defaulted for a
  server before it. The finger chooses as on every chart of the section (`useChartPointer`), **by
  what is drawn, in pixels** (adversarial Л, М, Н, review 6): **the dot under the finger is chosen**
  — the nearest within `FINGER_PX`; measured in thousandths, the left half of a Monday's dot lay
  nearer the end of the week before, which was chosen with the dot under the finger. **A tap on the
  dot already chosen turns to the next of the dots drawn over the same spot** — whose ring covers the
  touch (`RING_PX`): one day and one rate, or two days and nearly one (adversarial И). Turned from the
  one chosen rather than the one touched, a tap on the middle of three dots 7 px apart went to the
  first (Н). **A slide follows the finger** (`tap`), kept only by a dot drawn right on the one under
  it. **With no dot under the finger, the nearest by x alone** — a week with no exchange by its end,
  an exchange by its day (review 1), never by height: let into the height, a week was chosen two
  ahead on a line of 6 px weeks, and a gap could not be chosen at all (review 4, adversarial Ж). The
  latest exchange by default, two of one day in the order they were made, never by their ids
  (review 2). **A hidden radio for each week with no exchange and for each exchange** (Р-6): one per
  week left the second exchange of a week out of reach of the keys. The scale is never stretched to a
  tick (review 3): stretched to a tick rounded off a flat line, the line was pressed to the top. A
  market that would have given nothing has no mark.

## Incomes

**An income is money that came in with nothing given for it (MOL-66)** — the actual day, amount,
currency and a source from the owner's own closed list (`incomes`, В-3); nothing expected is ever
written. Private exactly as an exchange is, and written by an exchange's rules: a name from the
device, a repeat is 200 and anything else under that name 409; an amendment in place with its
version kept in `income_revisions`; a removal offered back for ten minutes. One money model, one
set of rules — the task's own «as for exchanges in MOL-40» predates MOL-42's history.

- **It is a link of the same walk** (В-1). In the currency of conversion it moves nothing — that
  currency costs one. In any other its price in the currency of conversion was never named, so by
  the rule of every unknown cost it is **the official rate of its own day**, fresh and judged for a
  jump as money of no known cost is, and the wallet says «часть — по курсу ЦБ РА». It is never
  valued at what the money already held cost — that is a price of other money. What was held
  before it weighs it as for an exchange (`heldBefore`, asked where it will count); unknown, the
  wallet takes the income alone and says «по последнему поступлению» (`basis: 'income'`). No fresh
  rate, or a day before the currency of conversion changed, and the cost is unknown with the income
  named as the reason (`walletUnknown.given: null`). **Incomes alone make a wallet**, so «Обмен
  денег» is empty only when its card has nothing to say — no exchange, no wallet, no reason for one
  missing, no price of another currency: drawn empty over drams that came in, it said «trips take the
  central bank» while they took the income's rate, and hid the switch back (adversarial Д1).
- **Money bought with the currency of conversion is an exchange, not an income** (Р-6): dollars
  brought from home with their rouble price on the owner's sheet are «251 000 ₽ → 2 900 $», and
  written so they carry that price instead of the bank's. The sheet says it under any other
  currency.
- **Both screens are one walk** (`ownMoney`): «Обмен денег» and «Доходы» read the exchanges, the
  incomes and the cache once, and the sheets ask «сколько было до» by one list, `receipts`, of every
  exchange and income with whether it gave its currency a price. The hint starts from the latest
  money in, whichever kind, and says which (`from`).
- **«Доходы» is a journal by month with what came in per currency, never converted** (В-2). The
  sum is the model's (`incomeMonths`); one no money can hold is left out rather than thrown — the
  screen failing whole would take away the one way to remove the income that made it. «Пришло /
  потрачено» is not in 0.1: a purchase need not have a price, so «потрачено» would always be short.

## Which side a rate is printed on

- **A rate is printed on the side whose number is at least one** — «89,04 ₽/$», never «0,011232
  $/₽» (MOL-81): the one rule is `formatRate`, and it turns a rate kept under one over on output,
  never in storage. Six digits of a small number are too few to turn over — 1 / 0,011232 is 89,03
  where the exchange said 89,04 — so a figure with an exact source (an exchange's amounts, the
  wallet's chain, the cache's rates against the dram) comes from the server already on its side,
  and only a trip's snapshot, which a trip converts by as it is, is turned over from its six digits.
  **The prices, named** (adversarial Б, Д): a pair kept under one — roubles into dollars — prints a
  trip's rate from its six digits and the wallet it was taken from exactly, so «Обмен денег» may say
  86,02 ₽/$ where the trip says 86,01; and a page on the old code reads the prices of a chain by
  `rate.base` until the app takes the new version (MOL-46), naming a turned price by the wrong
  currency for that while. **The bank's rate on an exchange's card is printed on the side of the
  exchange's own** (`formatRateBeside`, adversarial Г): near parity the two fall on either side of
  one, and each on its own side read «1,01 $/€» over «1,01 €/$». **The sheet of a jump has one side
  for everything in it** — the side of the rate before the jump, or of the jumped when there is none
  (review Т-9): the options, the line «… вместо …» and the field «1 $ =» alike, and the body names
  the currency of the field (`per`); the server turns the number to the snapshot's side, rounded
  once (adversarial А). Taken from the rate the trip counted by, the field asked on the side of the
  jumped rate after a jump of the comma across one — 4,30 ֏/₽ to 0,43 — and the owner's «4,30» went
  in as drams per rouble. **The price, named** (adversarial А″): the own rate is kept on the
  snapshot's side at six digits, so for a pair far under one — drams into dollars — «386,44» typed
  comes back «386,40».
