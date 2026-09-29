---
paths:
  - 'backend/src/{cookie,secret,login-*,device-name}*.ts'
  - 'backend/src/db/{sessions,login-requests,actors,telegram-lock,auth-unit-of-work}*.ts'
  - 'backend/src/usecases/{authenticate,sign-in,start-login,complete-login,bot-login,sessions,create-actor}*.ts'
  - 'backend/src/routes/{auth,internal-auth,sessions,dev-login,actor,actors}.ts'
  - 'backend/tests/{login,session,sessions,identity,idor,actors,devices}*.ts'
  - 'backend/drizzle/*{telegram,sessions,actors,login}*.sql'
  - 'packages/model/src/{entities,contracts}/{auth,session,actor}.ts'
  - 'packages/model/tests/{entities,contracts}/{auth,session,actor}.test.ts'
  - 'packages/client/src/**'
  - 'frontend/src/views/{LoginView,DevicesView,SettingsSignOut}*'
  - 'frontend/src/components/{SignOutSheet,SessionEndSheet,IdentityNotice}*'
  - 'frontend/src/stores/{identity,login,actor,signOut}*'
  - 'frontend/src/composables/useSessions*'
  - 'frontend/src/{api,main}*.ts'
  - 'frontend/src/App.vue'
  - 'e2e/{login,login-screen,devices,actor,session}*.ts'
---

# Identity, sessions, the way in and the way out

The detail behind the identity and session lines of `CLAUDE.md`. The bot's half of the login
is in `bot.md`.

## Sessions, the login request and the cookie

- **Identity is proved by a session; `actors.id` proves only ownership (MOL-52, MOL-53).** The
  two were one thing until now, and everything awkward about 0.1 followed from it: `created_by`
  hidden from a catalogue card, a header that must not be logged, `no-store` on every reply
  carrying an identifier. What a person comes back by is `actors.telegram_user_id` — unique,
  so one Telegram account is one owner — and what a request proves itself with is a session
  token. **The token exists in the database only as a `sha256` in hex**, and the repository
  is what holds that: it takes raw tokens and hashes them itself, so no caller has a method
  that could store one. **Revoking a session is deleting its row**, not marking it — which is
  the opposite of a withdrawn verdict above, and for a reason worth keeping straight: a
  verdict is data with a reader (the gate counts it), a session is a key, and a discarded key
  has no readers. Deletion also makes «revoked», «expired» and «never existed» one answer for
  free, where a flag would need every later query to remember it.
- **A login is a five-minute, one-use request (MOL-54).** The link carries a public code;
  `__Host-molvia_login` carries an independent secret, stored only as a hash. The bot confirms
  the code with a Telegram id, but only the browser holding the secret can collect a session.
  **Whose Telegram confirms is not checked against anything** (adversarial А1, owner's decision
  23.09.2026): someone who sees the link within its five minutes can confirm it with their own
  account, and the browser that started it silently collects _that_ account — its purchases
  then land there — and anyone holding the code can decline it. Accepted while the code goes
  from the browser straight into Telegram on the same device; a QR or a login from another
  device reopens the question. The term is the database clock's alone: the row takes both of
  its times from `clock_timestamp()` and the cookie's `Max-Age` is the lifetime itself, so an
  API clock off Postgres neither refuses a start nor shortens the cookie.
  Collection locks the row before checking the current database clock, then consumes it,
  finds or creates the owner and writes the session in one transaction. A concurrent first
  login uses `ON CONFLICT DO NOTHING` and a new read, not a caught unique violation inside an
  already-aborted transaction. Nothing updates the existing owner's settings.
  **The cookie is sent after commit, only once.** A lost response means checking `/actors/me`
  and starting again if it never arrived, not replaying the token. One pending request per
  browser cookie store; a new start replaces its secret. Polls never clear that cookie, since
  an old response could erase a newer request. Safari and an installed PWA have separate stores.
  Start and GET poll require `X-Molvia-Login: 1`, reject foreign fetch metadata and expose no
  CORS; HEAD cannot consume. This GET is the deliberate exception to the usual read-only rule.
  All auth replies are `no-store`, including refusals and what Fastify answers itself under
  those paths — no route, a path that does not decode. The bot uses a separate `BOT_API_SECRET`,
  never the Telegram token; Caddy additionally blocks its internal paths from outside.
  **Thirty starts in a rolling minute, across the database**, including consumed requests:
  the quota is serialized with an advisory lock. Its shared denial-of-service price is accepted.
  Expired requests are removed at start, at boot and every minute; no login writes `events`.
- **What became of every login is counted as it happens, into `login_days` (MOL-68).** Nothing is
  left to count afterwards: «Это не я» and a collected session only put a request out, and the
  minute timer deletes it. So each step adds one inside its own transaction — the start, the
  **first** «Войти» (the same account again is a lost answer repeated, MOL-55's О-2), «Это не я»,
  the collection, and the cleanup, which counts in the statement that deletes what ran out with no
  outcome, confirmed or not: never reached the bot, or never came back from it. A rolled-back step
  is a rolled-back count, and a refusal by the quota counts too, thrown only after the commit.
  **The row is the day the login began**, in Yerevan, read off the request's own row, so a day
  reads as a funnel of its own; a refusal has no request and counts on its own day. The count is
  **the last statement of its step**, and the cleanup writes its days in order: the row of a day
  is what every login of that day touches, and taken last it is held while waiting for nothing —
  except in a collection, where `signIn` writes the owner and the session after it; no cycle, since
  the account's lock is already the collection's (review А4), but a step that locks after its
  count must be checked against it. Logins in flight when the count began were counted by the
  migration. **No id, no Telegram id, no code, no device** — not a person's row, so erasure has
  nothing here, and «no login writes `events`» still holds.
  **A repeat is the device's word** (owner's decision В-1): `POST /auth/login?again=1` when the
  login record holds `tried`, the moment of this device's last start, **less than a day ago** — so
  «Начать заново», or a return after the link ran out, is the same person rather than a loss and a
  newcomer. Not the cookie of the request: it dies with the five minutes, exactly when the commonest
  repeat happens. **Set when the server took a start, or may have** — an answer lost on its way back
  left the request and its count behind (review Д); a refusal of the API's own, a captive portal's
  page and a start with no connection made none. **Taken away by any session collected here**,
  whosever: the attempt ended in it — an owner claimed before comes in with no question (review А1),
  and after a stranger's session «Это не я» begins anew (review Г3) — by «Да, это я», and by «Выйти»
  with the claim. **The day's term** (review Е): without one, a person who gave up in October and
  came back in December was «again» in December — in, and begun nowhere — while October's loss
  stood alone; with it each window holds its own. The price is named: Safari and an installed PWA
  are two devices, an old PWA sends no mark, and a forged mark spoils only our own count — as do
  starts forged by hand, since the start's guard is a header `curl` sends as easily as a browser.
- **The token rides in a cookie, and `backend/src/cookie.ts` is the only module that touches
  one (MOL-53).** `__Host-molvia_session`, with `HttpOnly` so an XSS cannot carry the account
  away and so ITP's seven-day cap — which applies to what a _script_ writes — never reaches it;
  `Secure` always, with no branch for the environment, because a branch saying «here it is not
  needed» eventually reaches production; `SameSite=Lax`, with the special-header guard above
  for the login GET; `Strict` would additionally refuse the one navigation the epic is
  built around — the person coming back from the bot; `Path=/` with no `Domain`, because the
  browser sees `/api/…` and both Caddy and the Vite proxy strip that prefix; `Max-Age` rather
  than `Expires`, so the clock of the device does not decide. The **`__Host-` prefix** is the
  browser holding the last three of those for us, and it buys the half the server cannot: nothing
  else on this host may set a cookie of that name at a deeper path. **Setting it and saying
  `no-store` are one act** — that is how «a cookie is never handed out by a reply that can be
  cached» holds without anyone remembering it, and a test asserts that no second module writes
  `set-cookie`. The one price, named: over plain http on the LAN (`PWA_EXPOSE=1 make dev`)
  `Secure` means no session — the same place the camera already needs `make certs`.
- **What a secret may look like is one rule, in `backend/src/secret.ts`** — RFC 6265's
  `cookie-octet`, because the only thing a session token or a login request's secret ever travels
  in is a cookie. It was two rules once, and they drifted by four characters: a token holding
  `"`, `,`, `;` or `\` was written and read perfectly well and then cost a 500 the day its term
  came due, or — for `;`, the header's own separator — a row no request could ever open. A test
  walks every printable code point and holds the rule and the cookie to the same answer, as
  `text.ts` does for `INVISIBLE`. Narrowing does **not** bring back MOL-52's Р4: `+`, `/` and `=`
  all pass, so plain base64 is still a token.
- **More than one cookie of that name is refused, and a refusal then clears nothing.** A browser
  sends the more specific path first, so anything able to set a cookie on this host — a sibling
  app on another port in development, where the port is not part of «site» — could put its own
  session in front of the real one and be answered as. «Which of these is ours» has no honest
  answer; and clearing would delete ours at `Path=/` while leaving theirs, turning an attempt at
  fixation into a lockout. Only a lone cookie that was refused is put out.
- **The term slides, and one write a day moves it (MOL-53).** 180 days from the last use
  (`SESSION_LIFETIME_DAYS`), and both `last_seen_at` and `expires_at` move together, at most
  once in `SESSION_TOUCH_AFTER_HOURS` — a term extended without moving `last_seen_at` would put
  a date in MOL-57's device list that means nothing. The condition lives inside the `UPDATE`'s
  `WHERE`, not only in the caller, so two requests arriving together write once; the caller
  checks it too, off the row it already holds, because an `UPDATE` on **every** request would
  bloat the one table every request touches. The cookie is re-set by the same write, or the
  browser would drop a session the server still holds.
- **Four refusals, one answer.** No cookie, a token nobody was issued, a token of a revoked
  session, a token of an expired one: `401` with `error.no_actor`, identical byte for byte.
  Nothing arranges that — they fail one `WHERE` in the repository, and a value this server could
  not have minted is refused before Postgres sees it, so «malformed» cannot become a third,
  distinguishable answer. Our own refusal also puts the cookie out (`Max-Age=0`) when one was
  sent, which a 401 from Caddy or a shop's captive portal never can, because it never reaches
  this code.

## The way in, and what stands behind it (MOL-56)

The login is the first screen a person without a session sees, and every other screen is behind
it. The whole of it is three things the API and the bot cannot do: start the request, survive
the round trip through Telegram, and ask whose account this turned out to be.

- **It is a gate, not a route.** `App.vue` draws it instead of the router's view, so the address
  is all along the one the person was going to: a link from the bot to `/advice` opens «Что
  брать» the moment they are in. A `/login` entry would have to be written into the rules of
  «back» (MOL-17) and would need to remember, separately from the address bar, where the person
  was headed. The one price is the tab's title, which the screen sets and puts back.
- **The door has one definition** — `login.closed`, which `App.vue` only reads — and it turns on
  what is actually known. A session the server named and the person claimed opens it; «no
  session» is an answer too and shuts it, whatever the device remembers. **Where nothing has
  been answered yet** — the launch, offline, a server that did not reply — **the drawer decides**:
  with an owner on the device the app is shown, drawing its own skeletons the way it did before
  this screen existed, and without one there is nothing to show at all, no drawers and no cached
  answers. That last part is the same argument as Q5's, and it is deliberately not written in
  terms of `navigator.onLine`: a shop's captive portal reports `true`, and the rule walked
  straight past it (adversarial А5). Holding the door shut for the whole of the loading was
  tried and is worse than it looks — every launch with a live session flashed «Вход», and what
  caught it was an end-to-end test rather than an eye. **The screen keeps all four of its own
  states behind the door**: an unanswered question with no connection is «нет связи», not a
  skeleton that loads nothing (А2).
- **One tap is one request, and nothing starts a login by itself.** The quota is thirty starts a
  minute **across the whole database**, so an app that started one every time the screen appeared
  would close the door for everybody. «Открыть Telegram» reopens the same link; only «Начать
  заново» asks for another, because a new start replaces the secret in `__Host-molvia_login` and
  makes the previous request uncollectable.
- **The device remembers the request and never the secret.** `{id, url}` under `molvia.login`,
  because iOS unloads the PWA while the person is in Telegram and the confirmation they gave
  would otherwise have nowhere to arrive. The secret stays in the `HttpOnly` cookie; putting it
  on the device would be MOL-8's mistake again. What comes back off the shelf is checked before
  it is opened — `https` and `t.me`, the same shape `loginStartedCodec` holds on the way in.
  **The key is shared between windows and the request inside it is not**: a window removes or
  rewrites only the request it started, because one whose link had died used to `forget` over a
  neighbour's live one — and a neighbour iOS had unloaded came back to «Войти через Telegram»
  with a confirmation on its way to nobody (adversarial А3). Starting a login still replaces what
  is stored: a new start replaces the secret, so whatever was there is dead anyway.
- **«Истекло» is the server's word** (`error.login_unavailable`), never `expiresAt` minus the
  device's clock: a phone whose clock has run away would otherwise be unable to sign in at all.
  There is no countdown on the screen; the text says the link lives five minutes.
- **«Повторить» repeats whatever did not work.** The screen's error state covers two failures at
  once — the login would not start, and the server would not say who we are — and a button that
  always began a login took a person who needed only an answer into Telegram instead, with a
  fresh request against a quota shared by everybody (adversarial Б2).
- **The poll fires on the three ways a person comes back**: a three-second timer, the app
  returning into view — on iOS a frozen PWA gets nothing else — and `online`. A hidden tab polls
  nothing. Every refusal but a dead link keeps the request: the next poll is seconds away, and a
  hiccup must not throw away a confirmation the person is about to give.
- **Whose account this is, is asked before anyone is let in** (MOL-55's round 3). Whoever sees
  the link within its five minutes can confirm it with their own Telegram, and the browser that
  started the login collects _that_ session; the bot's «Это не я» rescues nobody once the screen
  is polling. So the screen stops: it names what the wire carries — the city, the currencies and
  the day the account appeared, «сегодня» for a fresh one — and waits.
- **What the device writes down is the owner the person approved, never «somebody is
  unconfirmed»**, and the difference is the whole of the second review (adversarial А1 и А4).
  A flag saying «ask about this one» is set only when the script sees the answer that collected
  a session — and the browser stores the cookie from that answer's _headers_ whether the script
  lives to read it or not: a restart, or a «Начать заново» a moment earlier, left a session with
  no flag beside it and the door opened on an account nobody had been asked about. The same flag
  was cleared by anything that looked signed-out, and `error.no_actor` is the truth about the
  moment a request **left**: one still in flight from before the login wiped the question, and
  the next `me()` walked in. Written the other way round — `claimed` — the question cannot be
  missed: whoever the server says we are is compared with whoever the person approved, and
  anything else is a question, however the session arrived.
- **A refusal is not a conclusion; the app asks again.** `error.no_actor` from any call sends the
  identity to `verify()`, which asks `me()` once and believes only that: a refusal earned before
  a login landed is discarded by a revision counter, and a server that cannot be reached says
  nothing at all rather than signing anybody out. It steps aside while a question is already in
  flight, or a cold start with no session would ask twice and `verify` would ask itself forever.
- **Another window's login is this window's business.** Two windows share one cookie jar, so a
  session collected in one is the session the other carries; a window that was already open
  would otherwise keep showing the app — and, worse, the question itself — as the owner it
  believed in a minute ago. A write to `molvia.login` shuts the door here and re-asks `me()`,
  and the card is drawn only from the answer.
- The price of the question is named and accepted (owner's decision, 24.09.2026): one extra tap
  on a login into an account this device has not approved before, and one's own first account is
  indistinguishable from a stranger's fresh one — which is the case with nothing yet to take.
  Telling them apart needs the confirming Telegram's name on the wire, and that is a task of its
  own. «Это не я» ends the stranger's session on the server first (MOL-57, `POST /auth/logout`) —
  this browser's session only, the stranger's other devices are theirs — and nothing is claimed,
  so a reload or a relaunch asks again instead of walking in. A way out that fails does not hold
  the way in: the new login replaces the cookie anyway, and the row left behind has no key.
- **Showing the app and writing into it are different rights** (adversarial Б1). The door may
  open on the drawer's name while the first `me()` is still in flight — that is what keeps a
  launch with a live session from flashing «Вход» — but a drawer says nothing about the cookie,
  and in the one case where the two disagree (a session that arrived without the script seeing
  it) a rating held back on a `401` went out into a stranger's account at the first
  `onMounted(send)`. So **the queue and the drafts send only once the server has said who we
  are**, and while another window's login is still being caught up with: the rule sits in
  `flush()` of both, and **only** there — `App.vue` gives the occasion and no second opinion. A gate there as well looked harmless and took away the queue's own
  «the server is silent, try again later»: that timer is set by `flush`, and `flush` was never
  reached (adversarial Г1). The occasion is every settling of the identity, «error» included,
  which is what starts the doubling retry — and the retry asks about the identity first, waiting
  for that answer, because `start()` sets «loading» synchronously and a `flush` in the same tick
  saw no error left to schedule the next attempt from. Nothing is lost by waiting — a queue waits for
  the network anyway, and the answer is one round trip — **but the screen is told**, in the same
  words a failed attempt would have used: silence there left «Отправляем оценку…» standing
  forever at a shelf with no signal, which is the product's main scenario (adversarial В1).
  What is **not** held is everything else: a screen's first fetch goes out in parallel with
  `me()` on purpose, and so does a write a person makes with their own hands in a sheet — the
  rating, the amendment, «Предложить товар». In that same rare window those may reach a session
  the person has not claimed, or draw its figures for a moment before the door shuts. Holding
  them would mean serialising every screen behind the identity and paying a round trip on every
  ordinary launch, to close a case that needs a session to have arrived unseen.
- **What the screen says while it waits is «нет связи», and that is an exception to MOL-19's
  rule rather than its new edition.** There, offline or error is decided by `navigator.onLine`
  read after the failure; here nothing was even attempted, and behind a shop's captive portal
  `onLine` is `true` while «Повторить» would call the same held-back send and change nothing.
  Silence was worse: it left «Отправляем оценку…» standing forever at a shelf (adversarial В1).
- **A `401` anywhere is the login screen**, through one seam in `frontend/src/api.ts` wired in
  `main.ts`. Before it, `error.no_actor` was read by three callers out of a dozen and a half and
  every other screen said «что-то пошло не так» about an account that was simply not there.
  Telling `error.no_actor` from a bare `401` stays where it was, in `packages/client`: a proxy, a
  gateway and a shop's captive portal all answer `401` without knowing what an actor is.
- **Nothing on the device is thrown away by any of this** — by a `401`, that is; «Выйти» is the
  one exception, below. `molvia.actor` stays — it is the name
  of a drawer, not a credential (MOL-53) — so the trip queue, the recent items and the verdict
  drafts wait where they are, and Telegram brings the same owner back. The task's own line about
  deleting it was written before MOL-53 and is answered by it (owner's decision, 24.09.2026).
- **Offline with nobody on the device is the screen's own offline state**, not a notice over an
  empty app: there are no drawers to open and no cached answers to show. Offline **with** an
  owner opens the app, because a PWA at a shelf with no signal is the main scenario there is.
- **The development seam is a button, and only in a development build.** It signed the app in by
  itself until now, which made the screen this epic exists for invisible in every working copy
  and unreachable to the end-to-end suite; `signedIn()` in `e2e/session.ts` now presses it, in
  either language, and waits for the door rather than for the tap. Its failure stays on the login
  screen instead of opening the app with a notice. It shows no «whose account» step: that exists
  for a confirmation given elsewhere, and here the person signs themselves in with no Telegram
  in it at all.

## The way out, and what it takes with it (MOL-57)

The epic's last task: end this device's session, and end another one — the old phone, the laptop
somebody else owns. **Revoking is deleting the row** (MOL-52), so ended, expired and never-issued
stay one answer, and the device that was put out learns it on its next request: `401`, its cookie
put out, the login screen through the seam of MOL-56. Nothing reaches it sooner, and nothing can.

- **Three routes, and each keeps a rule it already had.** `GET /sessions` lists the owner's live
  sessions, **the current one first by the `ORDER BY`** — past `SESSIONS_LIMIT` a caller sorting
  what it was given would cut off the very row in the person's hand — and `total` beside them.
  `DELETE /sessions/:id` puts ownership in the `WHERE`: someone else's, a missing one, an expired
  one and a malformed id are one `404`. **The current session may be ended there too**, and then
  the cookie goes with it — the last session leaves the same way as any. `POST /auth/logout` sits
  with the login's routes, not in the guarded scope: a way out must work for a session already
  gone, so a repeat after a lost answer is the same `204`, and it never says whether a session
  was behind the token. The login's guards apply (`X-Molvia-Login`, fetch metadata, no body), and
  two cookies of the name are refused with nothing cleared — MOL-53's rule, for MOL-53's reason.
- **`withActor` hands the session's id to the request** (`request.sessionId`), from the same read
  that found the owner. It is what «this device» is, and what `DELETE` compares with to know it
  ended its own session — by the id as Postgres spells it, since a path is taken in either case.
- **Expired sessions are deleted by the minute timer** (owner's decision Q4), `skip locked` as the
  login's cleanup is: nothing read them, and a device name kept for good contradicted the privacy
  page's «180 days from the last use».
- **«Выйти» erases this device's drawer — after the server's `204`, never on the tap** (owner's
  decision Q1). This is the exception to «a `401` erases nothing» above, and it is not a
  contradiction: that rule exists because «no session» is also an expired one, with a purchase
  from a shelf with no signal still in the queue. Here the person says it, and the server has
  confirmed it. Without the erasure the drawer would open the app offline — MOL-56's rule for a
  launch with an owner on the device — and show the next person at that laptop the last one's
  trips. `forgetOwner` takes every `molvia.*.<owner>` key and `molvia.actor` from both shelves,
  **by the suffix and not by a list**, so a store added later is swept without anyone remembering
  to; `identity.test.ts` pins which keys exist, so a key that breaks the shape is a decision. The
  login record loses only this owner's approval — a login another window has in progress stays.
  **The owner is let go in this window first** (`release`: `id` to `null`, the revision moved), so
  a rating answering after the erasure finds nobody to file itself under and a `me()` that left
  before it cannot write the drawer's name back (adversarial Б1, self-review С-2); then the drawer
  goes under the trip queue's lock, and the page is loaded afresh at `/`. **Offline there is no
  way out at all** — the cookie is `HttpOnly`, the page cannot put it out, and a session left
  alive is what the person came to end — and the sheet says so **before a tap**: the button is
  inactive and nothing is sent or written down (round 3, Е1). A tap known to be offline used to
  leave an intent behind, and a person who changed their mind at the shelf met the login screen
  at the next launch.
- **A lost `204` is settled by the server's next answer, and by nothing else** (adversarial Б2,
  round 2 Д1, Д3). The intent, `molvia.leaving`, is written before the request leaves: if the
  server deleted the session and the answer never came, the first `401` closed the door on the
  settings and the erasure never happened. The server's «nobody» now finishes it; its «this very
  owner» means the request did not land, and the intent goes. **The identity keeps the server's
  word apart from its own state** (`heard`, `nobody`): a launch with no connection and the intent
  on the device shows the login screen — the door's `signed-out` — but that is the device's
  conclusion, and erasing on it threw away a purchase from the shelf while the session lived on.
  Closing the sheet after a failure does not withdraw the intent — the outcome is unknown — it
  asks the server; so does a return of the connection or of the app while the intent waits. The
  listener is a store of its own (`stores/signOut`), created with the app. **An answer that came,
  and not from our API, is not unknown** (round 4, Ж1): a captive portal's page or a stranger's
  `4xx` (`answered === false`, anything but `error.internal`) means the request never reached the
  server, and the intent goes at once — kept, a portal at the till locked the app further into the
  shop. **The way out succeeds on `204` and on nothing else**: a portal answers a redirected
  request with `200` and a page of its own, which read as «no body», and the phone erased a drawer
  for a session the server never heard about. **Somebody else signing in settles the intent too**
  (self-review Р3-2): the cookie of the owner who left is gone, so their drawer is erased there and
  then and the person now signed in is left as they are — `forgetOwner` removes the drawer's name
  and the intent only when they name the owner being erased. **The price, named:**
  a connection lost while the request was on its way leaves the outcome unknown, and a launch with
  no connection then shows the login screen until the server can be asked — the drawer of someone
  who may have left is not opened on a guess.
- **What would be lost is counted aloud** (owner's decision Q2) — everything the erasure takes
  that the server does not hold: the trip queue and the purchases it refused, every rating draft,
  saved or still being typed, and an unsaved settings form (adversarial Б3). The app is asked to
  send first when the sheet opens. Both «Выйти» and «Завершить» ask before acting, because
  neither can be undone — there is no «Вернуть» for a deleted key.
- **Another window lets the owner go by the drawer's disappearing, and erases its own shelves**
  (adversarial А1). `sessionStorage` belongs to one tab, so the window where «Выйти» was pressed
  cannot clear its neighbours' — and `read` falls back to it, so a neighbour's reload opened the
  app of the person who left. It asks no `me()`: the window that erased did so after the `204`.
  **A tab that slept through the event checks at every start** (round 2, Д2): a drawer on its own
  shelf with not one key of the owner on a shared shelf that works was erased elsewhere — a tab
  the browser unloaded, or one closed and reopened, gets its `sessionStorage` back without the
  event. The drawer's name counts **by its value** (round 4, Ж2): once somebody else signed in, the
  shared shelf names them. A shared shelf that refuses a probe write says nothing: then this tab's
  shelf is the only one, legitimately (Safari's private mode). The premise was checked (self-review
  Р3-1): Safari's seven-day cap clears `SessionStorage` together with `LocalStorage`, so ITP does
  not leave a drawer on one shelf; clearing the shared one by hand still does, and then the tab's
  copy goes too — a named limit, because a marker naming who left would keep their id on the device. A tab that wakes with its memory — frozen by the
  browser, or restored from the back-forward cache — checks on `visibilitychange` and `pageshow`
  too, because `recover` starts nothing from `ready`.
- **«Это не я» and the login's poll take turns** (adversarial Г1). The way out's `Max-Age=0` is
  addressed to the cookie's name, not to a token, so a poll that collected this person's own
  session and answered first had it put out of the jar. `refuse` waits for a poll already on its
  way — and if that one brought the person's own session, there is nobody to put out and no
  login to begin — and holds the next poll until the way out has answered. The server still
  clears by name, as the task asks: the race is closed where the requests are made.
- **«Устройства» keeps nothing on the phone and reads the list again on every return** — to the
  tab, or `online` — not only after a failure (adversarial В2): a list kept in memory for hours is
  the copy it refuses to keep on the disk. A device ended leaves the list at once, not with the
  next read (В1), and a list that could not be read again is not shown at all — the screen says
  «нет связи» or offers «Повторить» instead (round 2, Д4). There is no empty state: a live session is always in its own list. «Были» is a
  day, never a time — `last_seen_at` moves once a day — the current row says none, and a date of
  another year carries the year. An unknown device gets its own sentences rather than its label
  put into somebody else's case.
- **Where they live** (owner's decision Q3, brief of MOL-41): «Устройства ›» and «Выйти» are one
  group, «Аккаунт», on the settings screen, outside the form's states — the way into the account
  does not depend on whether its settings loaded. The current row in «Устройства» has no button:
  one place for one action.
- **Named limits.** A device that was put out keeps what it stored until someone clears it — the
  server does not reach a phone (MOL-58), and the list says so. Without Web Locks the erasure is
  not serialised with another window's send. The development seam now names its sessions by
  `User-Agent`, so a working copy's list is not a column of «unknown device».
