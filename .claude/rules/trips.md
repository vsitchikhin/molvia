---
paths:
  - 'packages/model/src/{entities,contracts}/{trip,expense,place,settings,actor}.ts'
  - 'packages/model/src/values/{geo,place-identity}.ts'
  - 'packages/model/tests/{entities,contracts,values}/{trip,expense,place,actor,place-identity}.test.ts'
  - 'backend/src/db/{trips,expenses,places,settings}-repository.ts'
  - 'backend/src/usecases/{start-trip,current-trip,trip-*,trips*,remove-trip,recent-places,save-settings,choose-trip-rate}*.ts'
  - 'backend/src/routes/{trips,places,settings}.ts'
  - 'backend/tests/{trip*,place*,settings*}.ts'
  - 'backend/drizzle/*trip*.sql'
  - 'frontend/src/views/{TripView,TripHistoryView,FinishedTripView,SettingsView}*'
  - 'frontend/src/components/{Trip*,tripRow*,StartTripSheet*,ItemDetailsSheet*,SettingsFields*}'
  - 'frontend/src/composables/{useCurrentTrip,useSelectedTrip,useFinishedTrip,useTripContext,useTripHistory,useTripRows,useItemDetails,useSettings}*'
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
  no timer, and a check over that trip says «пересчитаем» until the person answers on «Поход». **The price, named:** removing a trip dated before a check that
  came out even moves the balance with no reason the check can name, as a removed spending does.

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

## «Поход» without a trip (MOL-77)

MOL-77 gave «Поход» without a trip a face — the first screen a new person meets. **No circle over an
action anywhere on it**: the empty state's «+» read as a button and was the thing the owner tapped,
so `ScreenState` draws an empty state without a circle when it is given no icon, and «Поход начат»
has none. **«Начать поход» stands in the strip above the tab bar** in every state without a trip,
loading included — a start goes through the queue, and an open trip the server then names is asked
about as before. A newcomer gets «Что брать и где» and the cycle «у двери → у полки → дома «Оценки»
→ «Что брать»», whose last two steps change tab; a person with a history gets «N покупок ждут
оценки» and their last three trips (`TripHistoryRow`, shared with the history). **The introduction
is only for a history known to be empty**: every write to a trip persists the history cache, so an
empty stored page proves nothing, and the store keeps whether the server's last answer was empty
(`answeredEmpty`) — «empty», not «answered», since the flag and a page a full shelf kept can outlive
each other, and an answer with trips takes it off every shelf (round 2, Ж1) — **under a key of its
own, never as a field of the cache**: the cache codec is strict, and a window still on the previous
version read an unknown field as no cache and wrote its empty one over a finish made with no signal
(adversarial Е). A change to a phone-side cache is read by both versions, as a field added to the
contract is. An answer the list moved under — another window wrote the cache, a finish was taken
back — is asked for again after a doubling pause, since another window may be sending its whole
queue, rather than taken for a success (А, Ж2). Today's error, and purchases waiting for a verdict,
outweigh an empty answer remembered from an earlier launch (Г); an error or no connection with
nothing remembered is a quiet card of its own, never «newcomer» — MOL-56's «no answer is not the
answer „no“». With the server down there is one «Повторить», the red block's, and it asks for the
history too (Д). The price, named: offline with an empty answer remembered, the introduction stands
— Safari and the installed app keep separate shelves. «Ждут оценки» names places, not trips: a card
carries the place and the moment the server took the purchase, and a purchase made with no signal
arrives with the queue hours later, so no gap tells one trip from two (round 2, З1). **And it names
them, never counts them**: a card carries the name without the city, so «Ереван Сити» of Gyumri and
of Yerevan are one name — a number would claim what the phone does not know (round 3, И2). The name
alone is what every card and row already shows. A retry of the history ends with the screen that
asked (И1).
