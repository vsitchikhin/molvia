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
  - 'backend/src/metrics*.ts'
  - 'backend/tests/metrics*.ts'
  - 'deploy/grafana/**'
  - 'deploy/victoria/**'
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
  `ownerNoticeSchema` reads them — a union by `kind`, the feedback of MOL-148 two branches of it
  (`feedback`, `feedback_continued`). **A notice about a message names it by `feedback_id`** and goes
  with it (`feedback.md`); a notice about a failure cannot carry one — a check holds both — so the
  failures still belong to nobody. The
  bot claims them every minute (`POST /internal/owner/claim`), the API marks them handed in the same
  statement and skips rows another claim holds: **a failure's at most once**, as the reminders are
  (MOL-101) — a bot that dies between the claim and the message loses it, and the count stays in
  the table. **A message's until the bot says it went** (MOL-148, adversarial В1): the table holds
  nothing else of it, so the bot names the messages it sent (`POST /internal/owner/sent`), and one
  not named is handed again `OWNER_NOTICE_RESEND_MS` (ten minutes) after the first time, **each pause
  twice the one before**, at most `OWNER_NOTICE_TRIES` (eight) times — some 21 hours (round 2, Г2): a
  hand counts whether the bot tried the notice or not, a 429 or a stop giving up the rest of a run,
  so the tries are spread over a day rather than spent in an hour. **A notice Telegram refuses for
  what it is** (a 400) is the bot's failure, `owner:send` — the owner hears that something did not go.
  **The named prices:** the word lost after a send that went, the owner reads it twice; Telegram away
  longer than a day, the message is the table's alone again. **A stored notice the contract no longer
  reads is a message lost, so it is a failure of the API's** (MOL-148): `OwnerNoticeUnreadable`, code
  `OWNER_NOTICE_UNREADABLE`, placed as the request it came in, `POST /internal/owner/claim`, while the
  claim still answers `200` with the rest. So a notice's payload changes only so the stored ones still
  read — a field added is optional, a bound only widens — or the notices waiting at a rollout go.
  Whom to write is `OWNER_TELEGRAM_ID` in the API's environment, never in the bot and never in a
  row. Without it nothing is queued at all: every working copy and end-to-end keep their failures in
  their table. In production the line is required, as `BOT_PULSE_URL` is: a forgotten one would
  leave every failure silent.
- **A notice about a failure not taken within a day is dropped** (Р-7): after a day without the bot
  the owner would get a heap, and `make failures` has the count. A notice about a message is not: it
  is what the owner waits for, and the table holds nothing else of it. A handed notice is kept 30 days,
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
  frame, send it the first time only, so the count is of pages that met it. **A failure is the same
  on the phone as in the API's fingerprint**, its build included (adversarial Д1): a report with no
  frame kept from an old build no longer stands for the new build's. **Kept until our API has
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
  (review №9): four writes run at once, and an outage of the database held a place a report. So
  are the notices a failed transaction took: the budget is spent inside it. **The held ones are
  counted after the commit** (adversarial Е1, Ж1): counted inside, the minute timer told «скрыто» of a
  write still in flight that then failed, and taking it back off later ate another's. **The
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

## The metrics (MOL-145)

The watch of MOL-142 says whether everything is down, the failures say what broke; neither said
whether the API is slower than yesterday, how much memory is left — there is no swap, so the end of
it is the OOM-killer on the API or Postgres — or when the disk fills, and the watch passes a site that
fails every second request by design. MOL-149 decided the shape (В-3: VictoriaMetrics, Grafana and
exporters on our own machine, behind an SSH tunnel, nothing leaving it); the owner's decisions of this
task are В-1…В-5 in `.scratch/tasks/requirements/MOL-145.md`.

- **A label is never what a request named** (Р-1): the method and the route's template, by the same
  `routeOf` the failure's place is taken by, `HEAD` as `GET`; a request no route answered is
  `*`/`unmatched`, one series a class of status — a path carries uuids and, decoded, a person's text,
  and a series for each would be both a leak and a flood. Status is a class, `2xx`…`5xx`; the time is
  a histogram by route alone. Written by hand in Prometheus's text format, no library.
- **A request whose client left first is counted, as `aborted`** (adversarial А1), with the time it ran
  until then: Fastify's `onResponse` never comes for a socket the client closed, so the answers nobody
  waited for — the phone gives up after 15 s, the bot after 5 — were missing from exactly the p95
  they make. Counted once, by the response's `close` before it finished; not a 5xx — a failure after
  the client left is in `failures` all the same.
- **The event loop is measured by a timer of our own, over a sliding minute** (adversarial А2, А2b, А3):
  a tick every 100 ms writes how late it came, and a render reads the minute behind it, resetting
  nothing. **A block of seconds is one late tick**, so it is the minute's max and never its p99, which
  six hundred ticks on time keep low: the dashboard shows the max (review №13). Node's `monitorEventLoopDelay` was reset by every reader — a scrape VictoriaMetrics gave up
  on during a long block was still served once the loop freed and took the block with it, as did a
  `curl` by hand — a block starting right after a reset was never recorded, and an idle loop read its
  timer's resolution, 20 ms, as delay.
- **`/metrics` is on a port of its own, never the API's** (В-1): `METRICS_PORT`, 9464 in production,
  unset in a copy and in end-to-end, where nothing listens. Caddy proxies only the API's port, so no
  spelling of a path reaches it — closing `/api/metrics` in the Caddyfile would have rested on Caddy and
  the router reading a path alike, and the router decodes `%6D`.
- **What sees the whole machine or the database has no way out** (Р-7, Р-8): VictoriaMetrics,
  node_exporter, cAdvisor and postgres_exporter are on `metrics`, an `internal` network; Postgres and
  the API join it beside their own. cAdvisor reads Docker's socket — root on the machine — and
  postgres_exporter logs in as the database's own user (В-5): neither can send anything anywhere.
  node_exporter is not on the host's network, which would be a port outside, so the machine's network
  counters are not there. **Grafana is in `metrics` and in `alerts` of its own**, for Telegram and the
  pulse — not in `default` (review №4), beside Caddy, the API, the bot and the receipt reader, which
  asks nobody who calls — and its one port is on the loopback for the tunnel. cAdvisor has
  `CAP_SYSLOG` and nothing more (review №1): the OOM-killer is read from the kernel's log, which
  `kernel.dmesg_restrict=1` of Debian and Ubuntu keeps from anything without it — every OOM counted 0
  in silence, «Could not configure a source for OOM detection» in its log alone.
- **Grafana calls nobody home** (Р-6): usage reports, update checks, the news, gravatar, plugin keys
  and the five plugins it would install at every start, snapshots and feedback links are switched off —
  a test holds each setting. No sign-up, no anonymous view. **The admin's password is
  `GRAFANA_ADMIN_PASSWORD` at every start** (adversarial А6): Grafana reads it only when it creates its
  database, so `start.sh` resets it before Grafana runs — a password changed after a leak changed
  nothing, and the old one kept opening it. Through stdin, never the arguments every user of the
  machine reads in `ps` (review №14), whatever it begins with; **a password the reset refuses stops
  Grafana** (round 2, Б2) — `-…` read as a flag, one too short — rather than leave the old one open:
  the pulse goes quiet and healthchecks.io says so.
- **What runs is what the repository says** (В-2, Р-10): the scrape config is baked into
  `molvia-victoria`, the dashboard, the alarms and their contact point into `molvia-grafana`, both built
  by the release with the others; the dashboard is read-only — a panel changed in the interface cannot
  be saved, and a change is a merge. **Every threshold is in `rules.json`**, JSON so a test reads it without a
  parser, and the test holds them at Р-6 of MOL-149. **Every figure the dashboard and the alarms read is
  one the API writes or an exporter's list names** — a name renamed turns a test red, never a panel
  quietly empty — and the API's process figures are read by `job="api"`, since the exporters write the
  same names. **A rule removed or renamed goes with `deleteRules` of its uid in the same merge**
  (adversarial А6): provisioning never deletes one by itself, and the old rule would keep alarming from
  `grafana_data` with nothing in the repository to find it by. A test holds it: every uid ever shipped
  (`SHIPPED_RULES`) is in the groups or in `deleteRules`, and a new one joins the list. A dashboard's file removed takes the
  dashboard with it (`disableDeletion: false`).
- **A restart is a reset of the same container's CPU counter** (Р-4): a rollout makes a new container,
  a new series, and starts nothing over. Two measured traps on the way: cAdvisor reads a container's
  start once and never again, so a restart kept its old start time; and VictoriaMetrics' `changes()`
  counts a series' first sample, so «the start changed» was every container of every rollout.
  `resets()` was seen to catch the one container killed, and only it.
- **The alarms speak when the figures stop** (Р-5): every rule is Alerting on no data and on an error
  of the query — VictoriaMetrics down — and «Метрики молчат» is any target not answering five minutes.
  The rules that need traffic (5xx, p95, restarts) end in `or on() vector(0)`, so a quiet night is not
  «no data».
- **The alarms themselves have a pulse** (adversarial А5): Grafana is the one that sends, and nothing
  watched it. «Тревоги живы» fires while Grafana counts, VictoriaMetrics answers and reads Grafana's own
  figures, **and no alarm failed on its way to Telegram within the hour with none delivered beside it**
  (round 2, Б1, review №15: a revoked token, a bot blocked or never given `/start`, Telegram unreachable
  — every alarm undelivered and the pulse green). Grafana counts its deliveries by integration
  (`grafana_alerting_notifications_total`, `…_failed_total`), VictoriaMetrics scrapes them, and the
  pulse is read against them — a delivery broken is the pulse stopping within the hour of the first
  alarm that did not go, a delivery that went again clears it. **The price:** a token revoked while
  nothing fires is unseen until something does; after changing it, the contact point's Test. No data
  and errors are OK — the pulse stopping. It goes to a webhook
  alone — `ALERTS_PULSE_URL`, the healthchecks.io check `molvia-alerts`, every five minutes, never a
  resolved message, which would say «alive» the moment it stopped. Its silence is healthchecks.io's own
  Telegram, as for the machine (MOL-142). The line is required: Grafana refuses a webhook with no URL.
  **One rule for the owner's id** in the API and in `start.sh`: digits and nothing else
  (`ownerTelegramIdSchema`) — read by `z.coerce`, `+123` or ` 123` ran the API and stopped Grafana.
- **The alarms read a person's requests** (adversarial А7, review №5): the share of 5xx, its
  denominator, p95 and the twenty requests each needs leave out `unmatched`, `/health` and
  `/internal/*` — a scanner's 404s, the watch, the bot's polls every minute — which diluted a person's
  500s and slow answers under both thresholds and filled half the twenty by themselves. **The price:** a
  5xx only the bot meets is not in the share; the failure is in `failures`, and the owner hears of it
  there. **p95 also leaves out the photo of a receipt** (Р-3): Fastify's time runs from the headers to
  the answer, so `PUT /receipts/:receiptId/parts/:part` is the phone's network. The test holds every
  selector and that the route still exists.
- **The alarms' own bot, never the product's** (В-3): `ALERTS_BOT_TOKEN` lives only in Grafana, a
  container that goes to the internet, and the login's token never does. Whom it writes is
  `OWNER_TELEGRAM_ID`, put into the contact point as text by `deploy/grafana/start.sh` — Grafana 13.0
  makes a number of a value from the environment that looks like one, and its Telegram refused to start
  (grafana/alerting #558, fixed after 13.0.2); in the repository and the public image there is no id.
- **Postgres is read by its built-in collectors** (В-4): connections by state against
  `max_connections`, the size, deadlocks, the oldest open transaction — never a query's text. «How many
  run longer than a second» would take the deprecated `queries.yaml` and a file on the machine; the
  count of active ones and the age of the oldest are what is shown, a snapshot every fifteen seconds —
  a stuck query stays on the chart, a short burst between two looks does not.
- **Not here:** the bot's figures (its pulse is MOL-142's, its memory cAdvisor's), logs (Р-5 of
  MOL-149), anything about a person, a screen or an action — the product's events are the log of
  MOL-31 alone — and a copy of the metrics: thirty days, lost with the machine.
