---
paths:
  - 'packages/model/src/contracts/feedback.ts'
  - 'packages/model/tests/contracts/feedback.test.ts'
  - 'backend/src/routes/feedback.ts'
  - 'backend/src/usecases/send-feedback*.ts'
  - 'backend/src/db/feedback-repository.ts'
  - 'backend/tests/feedback.integration.test.ts'
  - 'frontend/src/components/FeedbackSheet.vue'
  - 'frontend/src/stores/feedback*.ts'
  - 'frontend/src/platform.ts'
  - 'e2e/feedback.spec.ts'
---

# Feedback: «Написать разработчику»

The detail behind the feedback lines of `CLAUDE.md`. The epic is MOL-141, its decisions MOL-150
(В-1…В-6, Р-1…Р-17 in `.scratch/tasks/requirements/MOL-150.md`); the message, its sheet and its two
ways in are MOL-147, the bot's half — the owner's notice, the reply, a thread continued — MOL-148.

## What a message is

- **A message to the one person who builds the app, never a review.** `verdicts.review` is a part of a
  rating; this is not about an item. It feeds no aggregate, no «Что брать» and no event, and the word
  «отзыв» is not used for it anywhere in the interface: it is taken.
- **The kind is the person's to choose** — `bug`, `idea`, `other` — and nothing chooses it for them
  (MOL-146): the schema has no default. Only the error screen opens the sheet on «Сломалось»,
  because there the person said so by tapping «Сообщить о проблеме».
- **The text is `visibleText(2000)`** — the one rule of the domain for what draws, as a review's is.

## What goes with the text

- **Only what is named, and the person sees it before sending** (MOL-150, Р-5, Р-7): the build of
  the page (the first `X-Molvia-Version` the page met, `pwaUpdate`), the screen as a route's name
  without its query or parameters, the app's language, the platform, and from an error screen the
  code. Never the content of a screen, a draft, the queue or the User-Agent. The build of the API is
  stamped by the API at the write — never the phone's word for it. **The price of «the first build
  met»** (review №2): a page brought up from the cache after a rollout meets the new API first and
  names its build, not the old code it runs. A version built into the page would close it — a change
  of the release, proposed apart.
- **The code is the last refusal of the API before the error was shown** (В-1 «а», review №1): taken
  as of the moment `ScreenState` drew the error, not of the tap — a person reads a while before
  writing. **The seam keeps the last refusals, not one** (adversarial Н1, Н4): asked as of a moment
  past, one slot answered nothing once anything failed after it — «Повторить» failing again, a queue
  sending — and the screen's own code was lost. **A dropped connection is kept too, with no code**
  (round 3, Ф2): a screen that broke on one has no code of its own, and another call's refusal a
  minute older must not stand in for it. **Only what came back from the server is a refusal** (adversarial В3): a dropped
  connection or a request never answered has no code of the API's — the client's `error.internal`
  for it would send the developer to a log with nothing in it, so a reply is told by its status — and
  the sheet's own refusals are not remembered, or «too many today» would become a screen's reason.
- **The platform is a line the domain can check**, `feedbackPlatformSchema`: a system from a short
  list, its major version when the platform shows one, `app` or `browser` — `ios 18 app`. Any other
  shape is refused, so the phone cannot attach more than the sheet says it does (MOL-147, Р-4).
  **A version frozen is left out rather than sent wrong**: since iOS 26 an iPhone says `OS 18_6`
  whatever it runs, so without Safari's `Version/` an `OS` of 18 and later goes with no number
  (adversarial В6). Every route's name and every code of the registry fit the body's rules, and
  tests hold both: one that did not would leave the sheet unable to send from that very screen.
- **The language goes in the body** (Р-8): the API knows no app language otherwise, and the owner's
  reply and its frame in the bot are written in it (MOL-148, the bot keeps no language, MOL-101 Р-7).

## The write

- **The API is the only way in**: `POST /feedback` in the guarded scope, the session's owner the
  author — the body has no author field, so nobody else can be named.
- **A repeat is the same message** (MOL-150, Р-4): the phone names the content by `clientKey`, a uuid
  unique per person. The same key with the same content answers `200` with the number written before
  and writes nothing — a double tap or a lost answer sends the owner nothing twice. **The phone takes
  a new key when the kind or the text changes** (MOL-147, Р-2): with a key per draft, an edit after a
  lost answer would come back «the same message» and be lost in silence. So the same key with another
  content is a defect of the caller — `409`, as an income's.
- **At most `FEEDBACK_DAY_LIMIT` (10) in a rolling day per person** (Р-3), counted in the database
  under an advisory lock of the author, the count and the insert one step — a burst stops exactly at
  the limit. A repeat is checked before the count and is not counted. Past it,
  `error.feedback_rate_limited`, `429`; the sheet keeps the text.
- **The number is the server's**, an identity counting up — the `#fb42` the owner sees. The screen
  does not show it (Р-13).

## Threads, replies, the term

- **A thread is its first message and what follows** (В-1): `thread_id` is empty on the first and
  names it on a continuation, of the same person — a composite key holds that — and `in_reply_to`
  names the owner's reply a continuation answers. Continuations and replies are written by the bot's
  half (MOL-148); a continuation from Telegram has no screen, platform or page build. **The database
  holds the thread, not the writer** (MOL-148, adversarial В5 of MOL-147): `thread_id` names a first
  message of the same person and never a continuation — else `purgeStale` grouped a fresh word under
  the wrong head and took the thread with it — by a key on the generated `head` / `thread_head`, since
  a key cannot compare with a constant; `in_reply_to` names a reply to the same person — else erasing
  one person cascaded into another's row — by `(in_reply_to, actor_id)`, so a reply carries its
  message's `actor_id`; and a continuation, and only a continuation, answers a reply. The migration
  came with the writer, `0042`, before the first row of either.
- **The owner's replies are kept** (`feedback_replies`, Р-1) so the copy is whole and a continuation
  shows the owner what is answered; they go with their message by the cascade.
- **A thread lives a year from its last message, the person's or the owner's** (В-4): `purgeStale`
  on the minute timer removes a first message whose thread is all older than
  `FEEDBACK_KEPT_YEARS`, and the cascade takes the continuations and replies along. And it goes with
  the person (`privacy.md`): `feedback` is in `ACTOR_REFERENCES` and `ERASED_TABLES`, the copy has a
  section with the replies nested, `client_key` left out as the phone's key against a repeat.
- **What `/privacy` says** — «Сообщения разработчику»: what is kept and attached, that only the owner
  reads, that a copy of the notice stays in the owner's Telegram without a name or an id even after
  erasure (В-3), and the year. A change here is a change there.
- **The owner's notice is not in MOL-147** (Р-7): when it was planned there was no channel to the
  owner. MOL-143 has built it since — `owner_notices`, claimed by the bot (`observability.md`) — and
  MOL-148 joins it as a kind of its own, with the reply. Until then a message waits in the table.

## The sheet and its two ways in

Drawn by handoff `design_handoff_mol_147`, variant А (the owner's В-16 «а» in MOL-118); checked
against the code in `.scratch/tasks/status/MOL-118/v2-feedback.md` (С-1…С-12).

- **One sheet for the app, `FeedbackSheet` in `App.vue`, opened through its store**
  (`feedbackSheet.open`) — so an error screen anywhere opens it without a sheet of its own. Only
  inside the app: the login screen has nobody to write.
- **The kind is a `SegmentedControl` with nothing chosen** from the settings; from an error screen
  «Сломалось» is chosen, since the link said so. The text may be typed first — the button then asks
  for the kind. Two steps (variant Б) were drawn and not taken: a step inside one sheet needs an
  entry of its own in the history, the most fragile place of the kit, for three short words.
- **Two ways in.** «Написать разработчику» in «Настройки», group «О приложении» between the account
  and «Ваши данные» — not «Связь», which in this app is the network. And «Сообщить о проблеме»
  drawn by `ScreenState` itself, last and `ghost` under «Повторить» (and «Обновить»): **only for an
  error of the whole screen** — an `inline` error is a section that failed while the screen works
  (сверка С-1), — only while somebody is known (`actor.state === 'ready'`), and never inside a
  `<dialog>`, since a sheet over a sheet the history does not hold (Р-5). No screen knows of it.
- **What goes with the text is read from the body, not composed beside it** (Р-7, С-5, С-6): the
  build as the server named it, whole — a short form shown and a long one sent would be a lie; the
  title of the screen the sheet was opened over; the platform from `platformLine()` in words
  (`feedback.systems.*`, a version only where there is one); the code only from an error screen.
  **The screen and the code are the opening's, the kind and the text the draft's** (Р-6): begun on
  an error, finished from the settings, it goes without the code, and the line says so first.
- **The draft is the device's, under the person** (`molvia.feedback-draft.<id>`), from the first
  letter until it is sent: no queue (MOL-150, В-2), so closing the sheet or losing the connection
  must lose nothing. **Its key is the content's** (Р-2): a new `clientKey` with every change of the
  kind or the text, kept beside them, so a retry after a lost answer — a reload too — is the same
  message. A draft is forgotten only if it is still the one that was sent.
- **Once it has left, what went with it stays with the key** (adversarial В1, В2): the server holds
  a repeat to the whole message, so the draft keeps the screen, the code, the build, the language
  and the platform the first send carried, and the sheet shows and sends them again until the kind
  or the text changes — reopened from another screen, after another refusal or a new build, a lost
  answer would otherwise meet `409` and leave the owner two messages. Before the first send, and
  after any edit, they are the opening's (Р-6). **The day's limit lets them go** (adversarial Н2,
  round 4 П3): a repeat is looked for before the count, so a `429` says no message is held under the
  key, and tomorrow's message from the settings must not carry today's error screen. Nothing else
  says it — a `401` or a `400` is refused before the write and knows nothing of an earlier send
  whose answer was lost; a `409` takes a new key. **A `201` whose body did not read is sent** (round
  3, Ф1; round 4, П1): cut off on its way or shaped by a newer server, the message is written. Only
  `201`, as the login trusts it (`mayHaveStarted`): a portal's own `200` page taken for «sent»
  erased a message that never left, and a `200` is a repeat, safe to send again. **The draft is read
  again before a send** (round 5, Т1): another window of the app may have sent it under the same key
  meanwhile, its answer lost, and what went with it then goes again. **A message sent leaves its key
  beside the draft** — the last few, so a new draft begun in the window that sent does not wipe it
  (round 6, У1; review 6): a sheet still open in another window holds the same text under that key,
  and says «sent» rather than send it again with its own opening. **An error screen chooses
  «Сломалось» for its opening only** (В4): closed untouched, the draft keeps the kind the person
  chose.
- **The button says why it waits**, inactive and focusable, in the order a person can put it right:
  the kind, the text, the day's limit, the connection; then «Отправить», «Отправляем…» (pressed once
  however often), «Повторить» after a failure, «Готово» once sent. **The limit lives while the sheet
  is open**: the server's day is rolling and the phone cannot know when it frees, so the next opening
  asks again (С-8). **A `409` takes a new key before «Повторить»** (С-9): the same key would meet it
  for ever, and it is a defect of the phone, never the person's.
- **The answer is said inside the sheet** — the app's live region is outside the modal dialog
  (С-10) — **through a region there from the opening** (review №3): «sent» and «the day's limit»
  drawn with a role of their own were often not read at all; a failure is an alert, read when
  inserted. No number (Р-13). Closing it puts the focus back on the way in.
- **The count of what is left is read with the field, and said only at its marks** (review №4): the
  coming of the count, 100, 20 and the end — two hundred announcements over the echo of the typing
  drown it. **What is said is what is truly left**, as a mark is passed on the way down — a paste past
  two marks says «50», not «100» — going up is silent, and the words go after the app region's time
  (review №8, adversarial Н3).
- **Kept for the kit, not copied here** (С-2): the pinned footer, a filled segment, an inactive
  button without transparency and `StatusStrip` are the kit's tasks (MOL-170); the offline strip is a
  line of the sheet in the meantime. The header is not pinned and the field has one height (С-3,
  С-4): over the keyboard the sheet behaves as every other.
