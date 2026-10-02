---
paths:
  - 'packages/model/src/{entities,contracts}/{trip,expense,place,settings,actor}.ts'
  - 'packages/model/src/values/{geo,place-identity}.ts'
  - 'packages/model/tests/{entities,contracts,values}/{trip,expense,place,actor,place-identity}.test.ts'
  - 'backend/src/db/{trips,expenses,places,settings}-repository.ts'
  - 'backend/src/db/trip-money.ts'
  - 'backend/src/usecases/{start-trip,current-trip,trip-*,trips*,remove-trip,recent-places,save-settings,choose-trip-rate}*.ts'
  - 'backend/src/routes/{trips,places,settings}.ts'
  - 'backend/tests/{trip*,place*,settings*}.ts'
  - 'backend/drizzle/*trip*.sql'
  - 'frontend/src/views/{TripView,PurchasesView,FinishedTripView,SettingsView}*'
  - 'frontend/src/components/{Trip*,tripRow*,StartTripSheet*,ItemDetailsSheet*,SettingsFields*,PurchaseRow*,ManualEntryButton*,Receipt*,receipt*}'
  - 'frontend/src/composables/{useCurrentTrip,useSelectedTrip,useFinishedTrip,useTripContext,useTripHistory,useTripRows,useTripReceipt,useItemDetails,useSettings,usePendingFrom}*'
  - 'frontend/src/stores/{trip,tripQueue,tripHistory,queueing,recentPlaces,settingsMemory,storage}*'
  - 'e2e/{trip,trip-history,settings,item-details}.spec.ts'
---

# Trips, the queue on the device, the settings

The detail behind the trip lines of `CLAUDE.md`.

## The queue on the device

- **Every write to a trip goes through the queue on the device (MOL-24),** online or not — one
  path, so the sheet never waits on the network. A write is kept first and sent after, one at a
  time, in order, at start, on `online`, when the app comes back into view and, after a 5xx with
  the connection up, again with a doubling pause; there is no background sync on iOS. A repeat is
  safe because the device names every row — **while the row exists**: a remove is a hard delete,
  and an add sent again after it writes the row anew. So **storage is the queue, not a copy of
  it**: the installed app and a tab from the bot share it, every window reads it before each
  change and send, takes out only the write it sent (by the write's own key), and one window
  sends at a time (`navigator.locks`). **Without Web Locks** (Safari before 15.4, old WebViews)
  two windows can send the same head at once, and a removed row can come back — narrowed, not
  closed, as the identity's own fallback says of itself. What must hold is written to every shelf
  or kept in memory, and a shelf that refused the write keeps only the part of its past still
  true — the writes still waiting, never those sent since (removing needs no quota, and the part
  fits into the room it frees). Left whole, its past is read at the next launch and a removed
  purchase is sent again and comes back; emptied, it loses the purchases made with no signal.
  While a shelf refuses, what came after lives in memory only, and a PWA killed before it sends
  loses that — there is nowhere left to keep it. No connection, a 5xx, an answer off the contract (a shop's
  captive portal) and a 401 hold the queue, and so does a code the API did not say itself
  (`ApiError.answered === false` — a portal's 404 page). `error.trip_context_required` holds it
  too, and holds it **without a timer**: nothing changes until the person names the city and the
  currencies of a trip the old app started (MOL-65). Any other refusal is set aside in
  `rejected` and never retried — sent again it would be refused again and hold everything behind
  it. The last known trip is remembered per identity for the same reason: the app opened at the
  shelf with no signal still knows where a purchase goes — but **the memory is for when the
  server cannot be asked, not instead of asking**: the sheet asks every time it opens, and a
  trip answered finished stops being the current one.

## Removing a trip

- **A start and a finish carry the phone's day of their tap** (MOL-121): `startedOn` and `finishedOn`,
  **taken at the tap** and kept with the write (`tapDay`, `finishDay` of a «Вернуть»), since worked
  out when sent a start tapped at 23:30 in Yerevan and sent after a flight east was the next day
  (adversarial round 4 Ф). A write queued by an earlier build has none and gets it from the moment
  it keeps (`startedAt`, `finishedOnDeviceAt`); the kept days sit beside the bodies, which an
  earlier build reads strictly. **A server that refuses the day** — an API rolled back to a build
  before MOL-121 — gets the write again without it (`refusedDay`, adversarial round 4 Х): the day
  is the one thing lost, never the start or the finish. The server keeps the first, as it keeps
  the first moment, and **drops a day it cannot believe rather than refuse it** — before 2000 or past
  the latest on Earth, or no calendar day at all (`isDeviceDay`): the body takes any short string,
  since a clock at 1970 — a dead battery — sends 1970's day beside its moment, one in year 1 or past
  9999 a day no calendar check passes, and a refused start or finish is set aside for good (Р-33,
  adversarial rounds 2 П and 3 С). The phone sends nothing the wire cannot carry — a moment past
  9999, a day of five digits — and the history on the phone keeps such a trip in memory rather than
  fail the write it came with. **A trip's rate is snapshotted on the day it is dated by** — the tap
  of «Начать», within a day of the server's (Ж1), else the request's today (review Т-7): a start
  the queue sent after midnight takes the wallet of the evening it was tapped in.
- **A removed trip is marked, by the money rule (MOL-76).** `DELETE /trips/:id` sets
  `trips.deleted_at`; «Вернуть» (`POST /trips/:id/restore`) is there for ten minutes
  (`TRIP_UNDO_MINUTES`), and then the minute timer deletes the trip with its purchases. A trip is
  money — a line of «Деньги» and an operation of an account — and it has a reason of its own: **a
  repeat is safe only while the row exists**, and a start sent again from the queue would have
  written a hard-deleted trip anew. Marked, that repeat is `409 error.conflict`; past the ten
  minutes the same name is a new trip, as a spending's is. **Every reader filters the mark** except
  erasure, the timer and «удалить или убрать» of an account (like a marked spending): the current,
  selected and history trips, «one open», the purchases, «Оценки», «Что брать» — other people's
  aggregates too — the month of «Деньги», the accounts, the hint of an exchange and the recent
  places; one integration test asks all of them about one trip before, during and after. An open
  trip brought back while another is open is `409 error.trip_open`. On the phone removal and
  «Вернуть» are writes of the trip's queue (`delete`, `restore`): the trip's waiting writes are taken
  out and handed back by «Вернуть», the removal is sent **always** — 404 is done — and a trip whose
  removal waits is shown nowhere. **The removal stands where the trip's first write stood, and
  «Вернуть» puts the trip back in the removal's place** (adversarial А3, А4): the order of the queue
  is the order the trips lived in — one trip's `finish` lets the next one's `start` through — and put
  at the end, a removal left the server holding the trip open under the next start, and «Вернуть»
  made yesterday's trip the one going on. A «Вернуть» the server refuses leaves the trip's writes on
  the phone, stepped over and counted as a refused start's are (А2) — one predicate, `orphaned`, for
  the queue, the screen's «not sent yet» and the history. **«Вернуть» is offered only while it can
  put the trip back where it was**: a new start withdraws it, and so does another trip's start
  landing on the server over a removed trip the server never had — brought back, its start would
  meet that trip open (round 2, Б3). The store keeps the same rule as the screen. **A trip comes
  back with its own «Завершить»** (`POST /trips/:id/restore` with `finish`, round 3, В1): finished on
  the phone with no signal and removed before that finish left, it is open on the server, and brought
  back open under the next trip it was refused as a second open trip the person never held — then
  gone with its purchases ten minutes later. Brought back finished in one statement, no moment holds
  two open trips; the `finish` behind it moves nothing, as finishing twice never does. **The
  removals and «Вернуть» are mirrored under keys of their own** (`molvia.trip-marks`,
  `molvia.trip-marks-rejected`, round 4, Г1), each with the write it stood before: a window still on
  the previous version reads the shared queue, drops the kinds it does not know and writes the queue
  back without them, and the version that knows them puts them back in their place (MOL-77's rule —
  a phone-side cache is read by both versions). The price, named: while it sends, the older window
  does not see the removal, and a start of the next trip it sends first meets the removed trip open.
  **The account of a trip is a write of its own** (`payment`, `PUT /trips/:id/payment`, MOL-123 Р-3),
  from the summary in «Деньги»: behind the trip's start, whole each time, 404 done. A new one goes
  last and takes the place of none — the earlier one still waiting leaves — because the server takes
  «списано» off at any change of the trip's money (Р-32 MOL-115) and one typed after a price change
  must reach it after that change (adversarial К). It is mirrored under `molvia.trip-payments(-rejected)`,
  as the marks are, since the version before it knows the marks and writes their mirror back; every
  mirrored write keeps the key it stood after as well as before, so a write behind it given a new key
  by an older window does not send it to the head (adversarial Л). **The price, named** (review 30):
  a `payment` waits behind a start held for an answer — another trip open, a missing context — with
  no timer; a check does not wait for it — it counts without it and says the trip waits for an
  answer in «Покупки» (adversarial round 3, Н4). **The price, named:** removing a trip dated before a check that
  came out even moves the balance with no reason the check can name, as a removed spending does.

## «Сумма по чеку» — a trip's money whole (MOL-78)

**The receipt's sum is a field of the trip, never a price** (owner's decisions В-1…В-4 of 30.09.2026).
One sum in one currency (`trips.receipt_minor`, `receipt_currency`), typed whole, and **when there is
one it is the trip's money in every currency** — a purchase priced in dollars under a receipt in drams
is inside the receipt, and adding the two would count it twice. The prices stay as they are and
**nothing is worked out of the sum**: a price per unit is an observation for «где дешевле», and one
made up by spreading a receipt over the purchases would poison the aggregates of 0.3. A card in
another currency than the receipt's is «списано со счёта», not a second sum (В-3).

- **One rule, five readers.** `tripMoney` in the domain — the receipt's sum, else the sums of prices
  per currency — and `tripMoneyRows` in `src/db`, the one SQL fragment «Записаны», the month of
  «Деньги» and the accounts read — the month hands it only the trips of its days, since a join does
  not reach inside its union (review 3); the hint of «сколько было до обмена» counts the receipt by
  `receipt_first_at`, when this sum was first typed, as a purchase by the moment it was written — a
  typo fixed after the exchange moves neither (review 2) — and the purchases of such a trip not at
  all.
  `trip-receipt.integration.test.ts` holds all five saying one thing before, with and after a sum —
  a sixth reader of a trip's money goes through the rule, never through `expenses` alone.
- **What the prices say beside it is the server's** (`prices`, `gap`, `receiptGap`): what the
  purchases without a price came to, or by how much the prices miss the receipt — more than it is a
  line of warning, never a refusal (the receipt's discount, or a price typed wrong). Two currencies do
  not subtract, and then nothing is said.
- **A change of the sum is a change of the trip's money**: it takes «списано» off (Р-32 MOL-115) and
  moves `receipt_set_at`, taken off included — what a check's window is measured by; the same sum
  again is a repeat from the queue and moves neither. **Under a sum a price is not the trip's money**
  (review 1): a price typed at home into a trip already paid for, a purchase added with one or a
  priced one removed leaves «списано» where it is — the money is the receipt, and taking it off moved
  the account by money that never moved. `payTrip` decides whether «списано» applies by the currencies of the trip's money — the
  receipt's alone when there is one.
- **Through the queue, whole** (`receipt`, `PUT /trips/:id/receipt`, `null` to take it off): last, and
  the earlier one still waiting leaves, as the account of a trip does — a price changed before it and
  an account chosen after it reach the server in the order they were made. Mirrored under
  `molvia.trip-receipts(-rejected)`: the previous build knows the marks and the payments and would
  write both mirrors back without it. 404 is done. **In the queue it is a line, never a figure**
  («Сумма по чеку … · отправляется»): the total stays the server's until the answer.
- **Offered only on a record with purchases** (В-1): money with no purchases is a spending, and
  «Закончить» on an empty record offers «Записать тратой в «Деньгах»» — the record goes with
  «Вернуть», «Деньги» open the sheet of a spending on its shop and day in «Продукты»
  (`stores/spendingHandoff`), a shop's name cut to the 80 characters «Где» holds (review В). The
  server does not refuse a sum on a trip without purchases: one whose purchases were all removed
  after it keeps its money, and nothing is said under it about prices it does not have (review 5).
- **Over a finished record read from the phone's cache the sum is not offered** (review 4): that
  cache does not keep `receipt`, `prices`, `gap` yet — the previous build reads it strictly — so its
  total may be a receipt with nothing saying so, and «+ Сумма по чеку» there opened an empty sheet over
  a sum that is there. **Decided by the object, not by the request** (`tripHistory.answered`, review
  Е): the store remembers which trips came as the server's answer, and another window writing the
  shelf puts a read-back trip on the screen with no request of this window's — a flag of «the server
  has answered» said it was still the answer. **And the answer is not given up for a poorer copy**
  (review Е2): another window writing the same trip to the shelf, saying nothing more than the answer
  on screen — the fields the shelf does not keep left out — leaves the answer there with its sum; a
  copy that says more (another purchase, another total) is fresher and taken as it is. The server is
  not asked from the listener: two windows on one trip would ask each other in a circle; coming back
  into view asks anyway. Offered again once the server answers; the fields go into the cache with the
  next release.
- **«Закончить» asks «Сколько вышло по чеку?» only while some purchase has no price and no sum is
  there yet** (В-4): with every price in, the total is already known. Empty is fine; a sum that is
  not money is said at the field and nothing is sent. «Закончить и начать новую» asks nothing — the
  sum can be typed later on the finished record.
- **The receipt of MOL-126 lands in this same field** — «Итог чека» is the trip's receipt's sum; there
  is no second one.

## The settings, and the geography a trip names (MOL-65)

MOL-65 gave the person their four fields and a fourth tab: Armenia, Гюмри or Ереван, the currency
purchases are written in and the one they are converted into. `PUT /actors/me/settings` compares
the four it was handed **inside the `UPDATE`**, so two devices cannot both overwrite one form,
and an exact repeat after a lost answer is successful because the target matches as well. The
form is settled **choice by choice**: one nobody here touched follows whatever the account holds
now, and «conflict» means both devices changed the same one — sending the whole stale form took
the other device's move back silently, with nothing on the screen to say which field was about to
go. **A trip names its own geography** (`context`): the settings as the phone knew them when it
started, which offline may be older than the row, so a move made elsewhere neither renames the
shop nor changes the currency of a trip already begun. A start from the old queue carries none,
and so does one naming a geography nothing may be written under — **one answer,
`error.trip_context_required`, because it is one question for the person**; the queue **holds it
without a retry** until they name the city and the currencies, because nothing else knows where
that trip was. A 400 there would have been the end of that trip: the queue sets a start it cannot
send aside, and the purchases behind it go too. **What a trip may name is the rule the settings
refuse by** — `geographyAllowed`: one's own current city, or AM with one of `SETTINGS_CITIES`.
`places` is a table everyone shares, and «the country is fixed as Armenia» must not be held by
the form alone. The city is read by the fold
`places.ensure` stores it under, never by the exact spelling, or a shop written «гюмри» once
falls out of its own owner's prices. **The form's draft belongs to the account and not to the
window**: it is kept under the owner's key on the device, as verdict drafts are, because the
system closes an installed app by itself — and «изменения останутся только пока приложение
открыто» is then what it says, a shelf that refused, rather than a permanent condition nobody
is told about. It is written to both shelves and **read from this window's own one first**, so
a new launch takes the last draft written while two windows open at once keep the forms they
are typing into. «Что брать» answers with the geography it counted by, and
the phone compares it with its own: a different city is a list to load again, and an answer the
settings will not move to is taken as it is — the screen used to stay on a skeleton for good.

## «Покупки», the record typed by hand, and the newcomer's home (MOL-77, MOL-128)

**«Поход» became «Покупки», and «Что брать» became home** (MOL-128, the owner's decision on the
receipts epic: at the shelf a person reads, at home they write). The word «поход» left the whole
dictionary: open — «запись», finished — «покупки»; the code keeps its `trip*` names. «Покупки»
(`/purchases`) is one list by what asks to be done: the record still being written first, then
«N покупок ждут оценки», then «Записаны» — each row with the server's count and sums (`itemCount`,
`total` of the history, В-4), `null` from an older server and from the phone's cache, which keeps
neither yet: a window on the previous build reads the cache with a strict codec (`ENTRY_NOT_CACHED_YET`,
as `NOT_CACHED_YET` for a trip view). **The record typed by hand is a screen under it**
(`/purchases/manual`, the old `TripView`), named by its place, and **with no record open it goes
up to «Покупки»** — finished here or on another device, removed, or reached by an old address —
never under an open sheet. «Записать покупки» (`ManualEntryButton`) stands in the strip of
«Покупки» and of the newcomer's «Что брать»: with no record open it asks «Где вы?» and opens the
record once the sheet is away; with one open it asks «Продолжить» or «Закончить и начать новую» —
the rule «one open at a time» unchanged. **«Закончить и начать новую» puts the open record away only
with the new start** (review Р-2), in the queue before it: finished at once, a «Где вы?» dismissed
left no record at all — and an empty one is removed with «Вернуть» rather than finished into a row
of nothing (MOL-76, В-2). **«Empty» is the server's answer, asked at the choice** (review Р-21): the
phone's memory may predate purchases added on another device, and «Что брать» never asks for the
record; until the answer comes, or with none, the record is finished — a finished empty record is a
row of nothing, a removed full one loses its purchases once «Вернуть» is over. A record started here
and not yet sent has nothing elsewhere and needs no answer. **A purchase the server refused is a
purchase** (adversarial М): it waits on «Покупки» to be put right, a removal would take it along, so
a record holding one is finished. **Every sheet over the record asks it to leave once it is away** — the
purchase's, the queue's notices' (review Р-7): the record may end under any of them. With receipts (MOL-127) it becomes «Записать вручную».

**What the queue says about any record is said on both screens** (`TripNotices`): purchases the
server refused, a record already open elsewhere, purchases not sent for a record that is over, a
city to name. «Поход» said them in every phase, its home without a trip included; with the record
a nested screen, «Покупки» without one would have said none of it. «N ещё не отправлено» waits
until the record going on is known — before that its own waiting purchases would be counted
(review Р-18).

**No circle over an action anywhere** (MOL-77): the empty state's «+» read as a button and was the
thing the owner tapped, so `ScreenState` draws an empty state without a circle when it is given no
icon. **«Покупки» is empty only for a history known to be empty**: every write to a record persists
the history cache, so an empty stored page proves nothing, and the store keeps whether the server's
last answer was empty (`answeredEmpty`) — «empty», not «answered», since the flag and a page a full
shelf kept can outlive each other, and an answer with trips takes it off every shelf (round 2, Ж1) —
**under a key of its own, never as a field of the cache**: the cache codec is strict, and a window
still on the previous version read an unknown field as no cache and wrote its empty one over a
finish made with no signal (adversarial Е). A change to a phone-side cache is read by both versions,
as a field added to the contract is. An answer the list moved under — another window wrote the
cache, a finish was taken back — is asked for again after a doubling pause, since another window may
be sending its whole queue, rather than taken for a success (А, Ж2), and what is left after that is
an error that blames nobody. Purchases waiting for a verdict, and a record open, outweigh an empty
answer. A retry of the history ends with the screen that asked (И1).

**The newcomer's home is «Что брать»** (`AdviceHomeNew`, handoff `02`): «Запишите первые
покупки», or «Осталось оценить» once purchases wait for a verdict, the cycle of three steps whose
first two change tab, the line about money and trust, and «Записать покупки» below. **Only for a
list known to be empty** — the answer of `GET /advice` now or remembered, with no rows; no answer and
no memory is offline or a failure, never a newcomer — MOL-56's «no answer is not the answer „no“».
The memory of `useAdvice` is that knowledge, so no flag of its own is kept; `answeredEmpty` stays
«Покупки»'s. «Ждут оценки» names places, not trips: a card carries the place and the moment the
server took the purchase, and a purchase made with no signal arrives with the queue hours later, so
no gap tells one trip from two (round 2, З1). **And it names them, never counts them** (round 3,
И2): a number would claim more than the line needs to say. **A place is its name and, where that
name stands in two cities, its city** (MOL-120, owner's decisions В-1, В-2): «Из «Ереван Сити» в
Гюмри и «Ереван Сити» в Ереване»; a name of one city reads alone, its city noise. The card of
«Оценки» takes the same city from the queue — a card alone cannot know there is another shop of its
name — so a card's city goes once the other card is rated. The rule is the domain's
`cityWhereNameRepeats`, names and cities folded as the index over `places` folds them; **a card with
no city** — a server before MOL-120, a card the phone kept from one — **leaves the whole queue named
as before**, since it may be either shop: no city printed, and the names kept apart as written, not
folded — «Ереван Сити» and «ЕРЕВАН СИТИ» may be the shops of two cities, and folded they read as one
(adversarial А1). **The case is looked up by the city of the settings a spelling folds to**
(`settingsCityOf`, А2): a place keeps its city as first written, and «гюмри» is «в Гюмри», never
«(гюмри)». **A draft of a verdict keeps the city beside its card, never inside** (А4): the version
before reads the card strictly, and a rollback dropped a verdict saved with no signal. The queue the
phone remembers and the memory of «Что брать» keep the city inside the answer — **the price, named**:
a rollback of MOL-120 forgets those two, which are caches, and the next answer brings them back.
The handoff's «Из чека «SAS»» is not used: the queue of verdicts does not know a source (MOL-124,
П-9).
