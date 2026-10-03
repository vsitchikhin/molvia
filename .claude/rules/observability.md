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
  else — so there is no key to `actors`, erasure and the copy have nothing to reach, and the privacy
  page has nothing to say. A test holds every column of the table by name and the absence of any
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
  frame before the cut (adversarial А6). **The named price** (adversarial review 5): the
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
- **The jobs of the API's timers are failures too** (В-1): the seven cleanups, the vectors of the
  catalogue, the rating reminders and the rates' refresh, as `job:<name>`. The cleanups' runner hands
  the error on — before, they logged «cleanup failed» without it. **A source of rates that does not
  answer is not a failure**: it is logged inside as a warning and has its fallbacks; what escapes
  the refresh is ours.
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
  and says how many went with it; **a stop sends the rest without the pauses** (adversarial А4) —
  they are marked handed, and a rollout, every stop, is when there is a batch.
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
