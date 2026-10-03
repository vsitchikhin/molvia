---
paths:
  - 'packages/model/src/support/failure.ts'
  - 'packages/model/src/contracts/failure.ts'
  - 'backend/src/failure-reporter.ts'
  - 'backend/src/failures*.ts'
  - 'backend/src/usecases/{record-failure,owner-notices}*.ts'
  - 'backend/src/db/{failures,owner-notices}-repository.ts'
  - 'backend/src/login-cleanup.ts'
  - 'backend/src/server.ts'
  - 'bot/src/assemble.ts'
  - 'backend/tests/failures*.ts'
  - 'bot/src/{failure,owner}*.ts'
  - 'bin/failures.sh'
  - 'backend/src/routes/client-errors.ts'
  - 'backend/tests/client-errors*.ts'
  - 'frontend/src/failures*.ts'
  - 'frontend/src/scanner/{barcodeReader,barcodeWorker,protocol}.ts'
  - 'e2e/client-errors*.ts'
---

# Failures of the API and the bot, and the owner's channel (MOL-143)

The epic is MOL-140: with 0.2 strangers come, and somebody whose screen broke does not write — they
leave, and gate 0.2 fails for the wrong reason. Before this task a failure of the API was a line in
journald nobody read, and a merge is a deploy (MOL-90). MOL-149 decided the big things on
02.10.2026: our own table and our own bot, not Sentry or GlitchTip (neither writes to Telegram, and
the clean-up «by kind» was already ours), and a failure belongs to nobody (Р-8). The owner's
decisions of this task are В-1…В-5 in `.scratch/tasks/requirements/MOL-143.md`.

- **A failure belongs to nobody** (Р-8 of MOL-149). `failures` has no actor, no Telegram id, no
  address, no session, no query, no body and no message — `describeFailure` and the place, nothing
  else — so there is no key to `actors`, and erasure and the copy have nothing to reach; the privacy
  page says only what a phone sends (MOL-144), and `platform` was that decision. A test holds every column of the table by name and the absence of any
  foreign key, and another puts a person's review into a driver's message and finds it nowhere.
  **A new column is a decision about privacy, not a field.**
- **`describeFailure` is one rule, in the domain** (Р-1): the API, the bot and — with MOL-144 — the
  phone describe a failure the same way: the name, the driver's code, up to eight frames cut below
  the stack's header. It moved to `packages/model` because the bot cannot import the API;
  `describeMigrationFailure` stays in the API, since it reads drizzle's wrapper.
  **The head is `name: message`, or `name [code]: message`** — Node's own errors put their code
  there (`RangeError [ERR_OUT_OF_RANGE]`), and without that form they lost every frame (adversarial
  А5). Only bare `node` writes it so: vitest's own `prepareStackTrace` does not, so the test writes
  the stack by hand. Whatever the form, the head is cut whole, never judged by its shape.
- **A row is a fingerprint** (Р-2): sha256 of the source, the kind, the code, the top frame
  **without its line and column**, and the place. The API ships as one bundled file, so a frame's
  position moves with every build; kept, every rollout would have made every failure new. The frames
  themselves are kept whole, for the owner to read, cut to 300 — the fingerprint is taken from the
  frame before the cut (adversarial А6). **So a report carries longer frames than are kept**
  (`FAILURE_WIRE_FRAME_MAX`, 1000, adversarial Б2): cut by the bot to 300 first, a frame reached the
  API as `…index.js:48213:`, and the position was in the fingerprint again. The phone (MOL-144)
  sends by the same schema. **The named price** (adversarial review 5): the
  file is always `dist/index.js`, so the top frame is the function's name and nothing more — two
  different throws in two anonymous callbacks of one route are one fingerprint, the second silent
  until the count crosses a threshold, its frames written over the first's. Accepted: a fingerprint
  wide enough to tell them apart would also tell apart one defect reached by two callers.
- **A failure is an answer of 500 or more** (Р-3). A `DomainError`, a body or a path refused — the
  caller's — is not, and is logged as before. **The place is the method and the route's template,
  never the address**: a path carries uuids and, decoded, a person's text; with no route matched
  there is no place at all. `HEAD`, which Fastify answers for every `GET` itself, is placed as the
  `GET` (adversarial А7): one defect, one place.
- **One path writes the log and the table** (`failureReporter`): every failure the log hears of is
  in the table, by the same summary. **The answer does not wait for the table** (Р-4): a recording
  that fails — the database down, which may be the very failure — is one more line of the log,
  `failure not recorded`, never a second failure and never a retry. **A burst is gathered, never
  dropped** (adversarial А1–А3): occurrences of one fingerprint wait in memory and go as one write
  of their count, a fingerprint has one write in flight at most and all of them together four
  (`RECORDINGS_AT_ONCE`) — so a failure that is the database itself never queues a write a request
  on the pool the live ones need, three hundred in a minute are counted three hundred, and a new
  failure in the middle of a burst takes the next free turn. A cap of four that dropped the rest
  counted 100 at once as 4 and lost a new fingerprint behind them. **The bot's reports go through
  the same gate** and are answered at once; past it they had taken the whole pool. Past 200
  fingerprints waiting a failure is the log's alone; what waits when the process stops is lost. The
  tests wait on `failureRecorded`, never on a timer.
- **The jobs of the API's timers are failures too** (В-1): the cleanups, the vectors of the
  catalogue, the rating reminders, the rates' refresh and the receipts' queue and its readings
  (MOL-125), as `job:<name>`. A receipt reader that does not answer is availability, logged as a
  warning, not a failure. The cleanups' runner
  hands the error on — before, they logged «cleanup failed» without it. **A source of rates that
  does not answer is not a failure**: it is logged inside as a warning and has its fallbacks; what
  escapes the refresh is ours.
- **The bot reports only its defects** (Р-5), by `POST /internal/failures` behind its secret: a
  throw in a handler, a message Telegram refuses as malformed (`TELEGRAM_400`), an answer of the API
  the contract does not read. Not the network, not Telegram's 403, 429 or 5xx, not the API's own
  answers — those are availability, which MOL-142 watches, or the API's own failure, which it
  records itself. **The place is the kind of update and the prefix of its button or command**
  (`handlerOf`: `callback:rate`, `command:delete`, `message`, `my_chat_member`) — never the
  button's data, the text or the sender. **Only the bot's own commands and button prefixes are
  names** (`start`, `delete`; `login`, `erase`, `rate`, `remind`), anything else is `other`: a word
  typed after `/` or a forged button is anybody's text, and as a place it would reach the table and
  the owner's message, a new fingerprint a word (adversarial review 2). **A handler that catches its
  own error reports it too** — the API's answer the contract does not read, from a press of the
  scale, a login, an erasure, the switch, either claim (`remind:claim`, `owner:claim`); before the
  review only `bot.catch` and `remind:send` did. The bot has no build of its own and is rolled out
  from the API's commit, so the API stamps its build.
- **The owner hears of a fingerprint the first time in a build** (В-2) — after a rollout a failure
  still alive says so once more, which is «the fix did not help» — **and when it reaches 10, 100 and
  1000 there** (В-5): «it happened» and then «it keeps happening» — the first and at most three
  more a fingerprint a build, and silence while nothing new happens and nothing grows. A threshold
  is **crossed**, not equalled: a burst written as one count of 147 takes 3 to 150 past both 10 and
  100, and the owner hears the larger. **There is no daily
  summary** (the owner, В-4/В-5): it said «was there anything», which the first message already
  says, and «how much» is wanted when it grows, not at a fixed hour. The count in a build is a
  column that starts over when the build changes, moved by the same upsert that takes the row's
  lock, so each threshold is crossed by exactly one write.
- **The owner's channel is one** (Р-9 of MOL-149): `owner_notices`, a kind and its fields as
  `ownerNoticeSchema` reads them — a union by `kind` the feedback of MOL-148 joins as a branch. The
  bot claims them every minute (`POST /internal/owner/claim`), the API marks them handed in the same
  statement and skips rows another claim holds: **at most once**, as the reminders are (MOL-101) —
  a bot that dies between the claim and the message loses it, and the count stays in the table.
  Whom to write is `OWNER_TELEGRAM_ID` in the API's environment, never in the bot and never in a
  row. Without it nothing is queued at all: every working copy and end-to-end keep their failures in
  their table. In production the line is required, as `BOT_PULSE_URL` is: a forgotten one would
  leave every failure silent.
- **A notice about a failure not taken within a day is dropped** (Р-7): after a day without the bot
  the owner would get a heap, and `make failures` has the count. A handed notice is kept 30 days,
  and so is a failure after it last happened — both by the minute runner of the cleanups.
- **The messages are Russian, keys of the bot's dictionary** (`owner.failure.*`), plain text: a
  frame or a route is shown as it is, and no markup can break on it. A 429 ends the minute's run
  and says how many went with it. **A stop sends the rest at the same pace** (adversarial А4, Б3) —
  they are marked handed, and a rollout, every stop, is when there is a batch — while
  `OWNER_STOP_BUDGET_MS` (20 s of the bot's 30 of `stop_grace_period`) lasts, then gives up the rest
  and says how many. Without the pauses nineteen messages went in a hundred milliseconds into one
  chat, where Telegram allows about one a second. **The stop's deadline cuts what is under way**:
  a send hung when it runs out is cut — it carries the deadline as its signal and is raced against
  it, since a socket that never answered held the stop past compose's thirty seconds and the kill
  said nothing (adversarial В1) — and so is a claim still waiting on the API (review №16): what the
  API marked meanwhile goes with the process either way, and the log says so.
- **`make failures`** (`dist/failures.js` in the API's image, as `gates`): the latest fingerprints,
  read only, the first six characters of each beside it — the message names a fingerprint by them.
- **The API runs without `--enable-source-maps`** (В-6, measured): Node parses the whole map of
  the 5.8 MB bundle at the first stack and keeps it, +70…80 MB of heap for good (34 → 104–114 MB);
  the bot's would cost 5 MB. So the table and the message keep the bundle's frames — the function's
  name is the source's (`keepNames`) — and `make failures` reads the API's frames of the running
  build back to the source through the map in the image, with Node's own `SourceMap`
  (`bundleDecoder`); a line the map has no entry for is left as it is, never given the nearest one.
  Another build's frames would be read through the wrong map, and the bot's map is in the bot's
  image: both are printed as they are.

## The phone's failures (MOL-144)

What breaks on a phone is what neither end-to-end nor development shows — the first day of 0.1
(MOL-79), the sheet on iOS (MOL-80), the keyboard (MOL-135) — and before this task it left a line in
that phone's own console and nothing else. MOL-149 decided the shape (В-2: our own `POST
/client-errors` into the same table, nothing of a third party in the PWA; Р-7: the maps beside the
build); the owner's decisions of this task are В-1…В-4 in `.scratch/tasks/requirements/MOL-144.md`.

- **Taken with no session, and a cookie that came is never read** (Р-8 of MOL-149): the login screen
  breaks before there is one, and a failure belongs to nobody. The source is `phone`; the place is
  `<catcher>:<screen>` — Vue's handler, the window's `error` and `unhandledrejection`, a screen's own
  catch, the scanner, the worker's registration, a step of the start, times a route's name (`login`
  behind the door, `start` before the app is mounted, since the door's store must not be raised by a
  failure). **The catchers stand before any module of the app is evaluated** (adversarial А4, Б3):
  `catchers.ts` is the first import of `main.ts`, and modules are evaluated in the order they are
  imported, so a module of the app that throws as it loads is heard. A step of the start that throws
  is reported as `start` and thrown on — the first route that did not settle too (Б2), and the app is
  mounted all the same — and one error object is one report whoever hears it. **The price, named:**
  what throws before `catchers.ts` runs — the bundle failing to parse, the few modules it imports
  (the client, the model, storage) — reaches nobody.
- **What leaves is the kind and the frames, never the message** (`describePhoneFailure`), nor a
  field, a draft, the queue, storage or an answer of the API: the screen, the build and the platform
  are the app's own words. **WebKit and Gecko write the stack without a header** — frames alone,
  `fn@url:1:2` — and the rule that cuts V8's header gave an iPhone no frame at all; their stack never
  holds the message, so it is read line by line, **only while the message is nowhere in it**.
  **Every engine's frame is brought to one shape on the phone** (`phoneFrame`, Р-1):
  `at <function> (<path>:<line>:<column>)`, the function kept only while it is an identifier, the
  path only of **a script of the app's own origin** (`PHONE_SCRIPT_PATH`: the build's `/assets/`,
  a file at the root, the development server's `/src/`, `/@fs/`, `/node_modules/`) with its query
  and hash cut, anything else `?`. **A page's own address is not a script** (adversarial А2): an
  inline `<script>` — one an extension put into the page included — is named by its document, and
  `/purchases/<trip>` is a person's trip and no code of ours. The API's schema takes the same shape
  and nothing else, so no word of text and no address passes.
- **Whether it is the phone's own is one rule** (`phoneDefect`, Р-4, owner's В-3): an API's word —
  a refusal or its 500 — the API recorded itself; no answer is the weather; a page not of the API's —
  a portal, a proxy's 502 — is not ours. **A `2xx` the contract could not read is**, but only the
  API's, and only whole (`ApiError.offContract`): the reply named the API's build (`fromApi`,
  `X-Molvia-Version`) — the transport marks a portal's `200` page and the API's unreadable answer
  alike, as answered, and the first rule, found by end-to-end, let not one such failure through —
  and its body read as JSON: one cut off after its headers, Safari's «Load failed» of an app put away
  mid-answer, is the weather (adversarial А1). **Every catch
  where a screen chooses «error»** calls `reportFailure` first — twenty-nine of them, and a test of
  the sources holds every branch to it (review №5) — a branch whose failure was reported elsewhere,
  a child's load or a catch up the chain, says so in a comment the test counts: the error stops in
  those catches and never reached Vue's handler, so a throw inside a screen's load was the one class
  nobody could see. **A report never throws** — it stands first in those catches.
- **What the window hears goes only with a frame of the app's own code** (Р-2): an extension, a
  script of Telegram's browser, `Script error.` of another origin. What the app's own catchers hear
  is the app's wherever it was thrown, and goes with no frame too — a registration's `DOMException`
  has none.
- **One failure once a page** (Р-5): a retry that shows the same error, a loop that throws every
  frame, send it the first time only, so the count is of pages that met it. **Kept until our API has
  answered** (Р-7): `molvia.failures` on the shared shelf, twenty at most, one a failure; sent at once,
  at start and on `online`, **one window at a time** (`navigator.locks`, adversarial А3: two windows
  hearing `online` each sent the shared buffer whole). **The API's answer lets them go** — taken, or
  refused for good — **but not «too many»**, which says «later» (review №2: a stream of somebody
  else's cost a real phone its report), and **nothing that is not the API's**: a proxy's `502` during a
  rollout, the very window an old page meets a new server in, and a portal's page keep them (review
  №3). Nobody's, so «Выйти» leaves it. Sending reports nothing about itself and is no reason a screen
  broke (`lastRefusal`, Р-8).
- **The page's build is the name of its own script** (В-1): `index-BTCsHrpw`, a hash of its content,
  which changes exactly when the phone's code does. The page has no other version; the first one the
  API named (`pwaUpdate.build()`) is the new build for the old code from the cache after a rollout —
  the very window a failure of the old code matters in — and a git version built in would make every
  merge a new app on every phone. **So a phone's fingerprint lives within a build** (Р-10), and the
  build is in it (review №1): the code is minified and the top frame's file is the build's anyway, and
  a failure with no frame of the build — a registration's, the scanner worker's file whose hash does
  not move with `index` — shared one row between an old page and a new one during a rollout and was
  «new in this build» at every turn. The owner hears of it once a build as of any other, and only the
  count across builds is lost.
- **The platform is a column and its system is in the fingerprint** (В-2): `platformLine`'s one line,
  never the User-Agent, the last one seen; «only on iOS» is seen at once, and the API's and the bot's
  fingerprints did not move — the system is added only where there is one.
- **The limit is the process's** (Р-6): sixty reports a minute from an address — three buffers: one
  was too few for a mobile operator's address, which thousands of phones share (adversarial А6) — and
  two hundred from everybody, the whole body refused past it with `429`, which the phone keeps its
  buffer through. The address is the one Caddy names last in `X-Forwarded-For`, believed only from
  inside, **an IPv6 one by its `/48`** (review №2, adversarial Б4, В2: one home connection has 2^64 in
  its `/64`, a flat's router is given a `/56`, and a free tunnel a whole `/48`), the limit's key and
  nothing else — in no log, in no table. **The channel can be silenced, not flooded** — the price,
  named: someone sending from many addresses takes the minute's two hundred, and the real phones'
  reports wait for the next start or `online`.
- **The owner hears of the phone three times an hour from one sender and twenty from everybody**
  (`phoneNoticeBudget`, review №1, adversarial Б1): the endpoint is open and a build is the phone's
  word, so a report with a new build each time was «new in this build» each time — twenty messages a
  minute; and a cap shared by everybody alone was spent by ten invented reports at the start of an
  hour, and the real failure after a rollout was told to nobody. The sender is the limit's key, the
  network, in memory alone. **What is held back is counted, never queued, and told by the minute
  timer at most once an hour, past the cap** (`failure_muted`, «🔕 Скрыто уведомлений о сбоях
  телефона: M», review №7, round 3 В2) — not with the next failure, which may never come, and not when
  the cap has room, which seven networks keeping it full never leave; it also says how many new
  fingerprints the hour's rows had no room for, and sends to `make failures` only for the held ones —
  the unwritten are in no table (review №10). **The price, named:** seven networks — seven IPv4
  addresses, seven `/48` — silence the names of the phone's new failures for an hour; the table keeps
  them and the owner hears «скрыто M» every hour. Never silenced would take another bot: the phone's
  failures one message a minute, with no cap. A restart starts the hour over and forgets what was
  held — and a rollout is a restart. **The API's and the bot's go first** (adversarial А5): the
  claim hands them out before the phone's, and the reporter writes them first and keeps fifty of its
  two hundred places at most for the phone's — a stream of invented failures while the database was
  slow filled the queue, and the API's own was the log's alone. **The price, named:** past four in
  flight and fifty waiting, a burst of different new failures of phones is dropped with a warning —
  a real burst that wide is the app broken everywhere, and the first fifty say it.
- **The phone adds at most sixty new rows an hour from one sender and a thousand from everybody**
  (`phoneRowBudget`, review №6, №8): a fingerprint is all the phone's words, so every invented report
  could be a new row — two hundred a minute, kept thirty days and copied every night, a disk's worth.
  Past the budget a known fingerprint still counts and a new one is not written, with a warning, and
  the hour's summary says how many. A hundred shared by everybody alone was spent by two addresses in
  two minutes, and every real new failure after a rollout was written nowhere for the hour
  (adversarial В1); ten a sender were too few for a mobile operator's address, which thousands of
  phones share — one failure of a rollout is a dozen fingerprints, its screens times its systems
  (Г1). A place is taken before the write and given back if the row was there or the write failed
  (review №9): four writes run at once, and an outage of the database held a place a report. **The
  prices, named:** seventeen networks fill the hour, some 720 000 rows in thirty days at most; and the
  sender is an address, so one subscriber of an operator sending sixty invented reports an hour takes
  the new rows of every phone behind the same address — telling phones apart would need a mark of the
  device, which is tracking. The nightly copy keeps the table: what is in it is bounded.
- **The scanner's worker carries no model** (`barcodes.md`), so its failure travels to the page as
  the error's name, message and stack and is described there by the one rule (Р-11) — the message
  never leaves the phone; a throw it did not catch is `WorkerError` at its file, line and column.
- **The maps lie beside the build** (`build.sourcemap`, not precached, fetched by a browser only with
  its tools open) — the repository is public. `make failures` reads a phone's frame through the map
  of its own file from the site (`phoneDecoder`, `APP_BASE_URL` of the API's environment): the name
  is a hash of the content, so a map found is that file's own; a build the site no longer serves is
  printed as it is, and so is one a site does not answer for within ten seconds (review №4).
- **Not here:** failures inside the service worker itself — it has nobody to send them; a message to
  the developer carrying a failure's fingerprint (MOL-147 sends the API's last code instead).
