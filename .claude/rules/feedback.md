---
paths:
  - 'packages/model/src/contracts/feedback.ts'
  - 'packages/model/tests/contracts/feedback.test.ts'
  - 'backend/src/routes/feedback.ts'
  - 'backend/src/usecases/send-feedback*.ts'
  - 'backend/src/usecases/feedback-from-bot*.ts'
  - 'backend/tests/feedback-bot.integration.test.ts'
  - 'backend/src/db/feedback-repository.ts'
  - 'backend/tests/feedback.integration.test.ts'
  - 'frontend/src/components/FeedbackSheet.vue'
  - 'frontend/src/stores/feedback*.ts'
  - 'frontend/src/platform.ts'
  - 'frontend/src/feedbackPicture*.ts'
  - 'backend/src/feedback/**'
  - 'bot/src/owner.ts'
  - 'e2e/feedback.spec.ts'
---

# Feedback: «Написать разработчику»

The detail behind the feedback lines of `CLAUDE.md`. The epic is MOL-141, its decisions MOL-150
(В-1…В-6, Р-1…Р-17 in `.scratch/tasks/requirements/MOL-150.md`); the message, its sheet and its two
ways in are MOL-147, the bot's half — the owner's notice, the reply, a thread continued — MOL-148,
a screenshot with it MOL-167 (В-1…В-5, Р-1…Р-13 in `.scratch/tasks/requirements/MOL-167.md`).

## What a message is

- **A message to the one person who builds the app, never a review.** `verdicts.review` is a part of a
  rating; this is not about an item. It feeds no aggregate, no «Что брать» and no event, and the word
  «отзыв» is not used for it anywhere in the interface: it is taken.
- **The kind is the person's to choose** — `bug`, `idea`, `other` — and nothing chooses it for them
  (MOL-146): the schema has no default. Only the error screen opens the sheet on «Сломалось»,
  because there the person said so by tapping «Сообщить о проблеме».
- **The text is `visibleText(2000)`** — the one rule of the domain for what draws, as a review's is.
- **Words, a picture, or both** (MOL-167, В-3): «Сломалось» with a screenshot, its screen and its code
  often says it all, and «пришлите скрин» in the bot is answered by a photo with no caption. A text
  sent must still have something visible; a message with neither is refused — `text` absent from the
  body, `''` in the row, and `feedback_says_something` holds it in the base.

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

## A screenshot (MOL-167)

- **Only what the person attaches, and only from the gallery** (MOL-150, В-6): a screen shows other
  people's prices and one's own spendings — exactly what the epic forbade to attach in silence — so a
  picture goes only by the person's own act, and they see it before sending. No snapshot of the page is
  taken programmatically: a library and an inexact picture. At most `FEEDBACK_PICTURES_MAX` (3, В-2).
- **The phone draws every picture anew** (`pictureFromFile`, Р-1): the orientation applied while
  decoding, the longest side to `FEEDBACK_PICTURE_SIDE`, a JPEG at 0.85, then 0.7, then smaller, until it
  fits `FEEDBACK_PICTURE_BYTES_MAX`. **A canvas writes only its own** (review 3): WebKit an EXIF of
  the colour space and the sides and an APP13, Chromium an ICC profile — nothing of the file chosen,
  never where it was taken; the API cuts those too. What the sheet shows is the drawing, never the
  file chosen. The drawing's path — the orientation, the canvas, the JPEG — is held on WebKit too, by a
  probe in `sheet.spec.ts`: WebKit keeps no session on the test's loopback, so the sheet itself is held
  on Chromium only (review 2).
- **The API does not take the phone's word** (`pictureOf`, Р-2): a JPEG by its frame, sides
  100…4 000 and no more than twenty times as long as wide (Telegram's limit for a photo), and **nothing
  but the picture** (`withoutMetadata`, review 1, adversarial А2): every segment is walked — between
  the scans of a progressive JPEG too, the entropy-coded data skipped by its stuffed bytes and restarts —
  every APP segment but a plain JFIF without its thumbnail and Adobe's twelve bytes of colour transform
  (review 9: cut, a JPEG saved as RGB or CMYK comes out in the wrong colours), and every comment, is cut
  wherever it stands,
  and whatever follows the end of the picture is cut — a second JPEG of MPF or Ultra HDR with its own
  EXIF, any tail. A client changed by hand must not carry where a photo was taken. **More than 256
  markers outside the scans is no picture** (А3, Б1), one with no length counted as one with — and a
  restart or a TEM before the first scan is none at all: a real picture has a few dozen, and two
  megabytes of empty segments, or of two-byte markers, held the API's thread for a hundred
  milliseconds a picture. Not one — `error.feedback_picture_invalid`,
  `415`; too heavy — `error.feedback_picture_too_large`, `413`; the text and the other pictures stay on
  the phone. **The price, named** (А3): a body of eight megabytes is read — JSON, base64 — before
  anything is counted, some fifty milliseconds of the thread, and a refused one is not counted in the
  day's limit; a person with a session could send them in a row. Not closed before 0.2: a limit of
  heavy bodies in memory is the next step if the log ever shows it.
- **One request** (Р-3): the pictures go in base64 in `POST /feedback`, written with the message in one
  transaction, so a repeat compares them too — by `fingerprint`, the sha256 of the bytes kept, which
  outlives them. The body's limit is the route's alone (`FEEDBACK_BODY_BYTES_MAX`), and too large by
  its `Content-Length` says its own code before the body is read; every other route keeps a megabyte.
  A separate upload would have needed a table of pictures waiting for their message.
- **The picture lives only until the owner's Telegram has it** (В-1): it waits in a table of its own,
  `feedback_picture_files` — the phone's bytes or Telegram's id — and its row goes with the bot's word
  that the notice went, in that transaction, or after `FEEDBACK_PICTURE_KEPT_DAYS` (7) the bot never
  took it — the bot away, or a copy with no owner. What stays is the line in `feedback_pictures`:
  place, source, sides, size, and `sent_at` **for every picture the bot did not name as missed**
  (adversarial А4, Б4) — one the timer let go before the bot came, or Telegram refused, never reached
  the owner, and the bot, which found it gone or saw the refusal, is what knows it; a file the timer
  let go while its picture was on its way still went. The copy shows the line and never a picture. **The
  nightly copy leaves out the files, not the lines** (`backup.sh`, А5): a restored message still says
  what it had, and its repeat is still the same message. The copy in the owner's chat stays, as the
  text's does (В-3 of MOL-150), and `/privacy` says Telegram sees it.
- **A photo from the bot is kept by Telegram's id** (Р-8): `source = telegram`, `fingerprint` its
  `file_unique_id` — the same photo sent twice to the same reply within a day is one word. **A caption
  that draws nothing is no words** (`drawsNothing`, review 5): the photo goes alone, as В-3 allows.
- **The day's limit is the message's** (Р-10): pictures do not count apart.
- **In the sheet** (В-4 «б»: no handoff drew it — the brief of MOL-147 left it out — so it is built
  from the sheet's own kit and tokens): a row under the field, each picture shown whole (`contain`,
  never cropped — the person checks what goes) with «Убрать» on a thumb-sized corner, and «Приложить
  снимок» as a label over a native file input — the gallery's own picker, by tap, keyboard and screen
  reader alike — while there is room; before any, a line says a screenshot is made with the phone's
  buttons. The pictures are the content: one added or taken away takes a new key (Р-6), and the line
  of what goes with the text starts with «2 снимка». The button waits for words or a picture, and
  while a picture is drawn; **words are what draws something**, by the domain's `drawsNothing` — a
  word joiner beside a picture is no words, and the picture goes alone (review 5). Each file chosen is
  tried on its own, and the first refusal said (adversarial А6). **The pictures live in the page's
  memory**, the draft keeps their number: megabytes on the shelf would push out the queue of purchases
  kept there. Where the draft has more than the page holds — a reload, or another window that holds
  them — the sheet says «Снимки не сохранились» **and keeps the key**: the opening decides nothing for
  another window, which may be sending that very draft (review 7, 10; adversarial В2). The next change
  takes a key, as any does. **What a `409` means is decided by the answer** (Б3, В2): under a key whose
  draft had begun to leave with pictures this page lost, and with nothing changed since, the server
  holds that very message, pictures and all — the sheet says «sent» and lets the draft go, never «Не
  получилось» and a second message. Changed since, a `409` is the phone's own defect again. **The
  price**: a message sent without its pictures under a new key after one of them already left with
  them is a second message. A picture the API refused is
  said under the pictures, never as a failure of the message. **The pictures go with the message
  sent, the sheet open or not** (adversarial А1): kept, the next message opened with a screenshot
  already sent, one kind away from sending it again. **«Another message» is the key's**, for the draft
  and the pictures alike (Б2): a word or a picture changed while it was on its way makes another
  message, and its pictures stay — never taken from under the finger. **The same key is the same
  message in any opening** (В1): closed and opened again untouched, the sheet says «sent» when the
  answer comes, rather than lose its pictures under a button that still says «Отправить». The body is read at the press, never with every letter (review 6).

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
  came with the writer, `0043`, before the first row of either.
- **The owner's replies are kept** (`feedback_replies`, Р-1) so the copy is whole and a continuation
  shows the owner what is answered; they go with their message by the cascade.
- **A thread lives a year from its last message, the person's or the owner's** (В-4): `purgeStale`
  on the minute timer removes a first message whose thread is all older than
  `FEEDBACK_KEPT_YEARS`, and the cascade takes the continuations and replies along. And it goes with
  the person (`privacy.md`): `feedback` is in `ACTOR_REFERENCES` and `ERASED_TABLES`, the copy has a
  section with the replies nested, `client_key` left out as the phone's key against a repeat.
- **What `/privacy` says** — «Сообщения разработчику»: what is kept and attached, that only the owner
  reads, that a copy of the notice stays in the owner's Telegram without a name or an id even after
  erasure (В-3), the year, and since MOL-148 a word written in reply in the bot and the number of the
  Telegram message each reply went out as. A change here is a change there.
- **The owner hears of every new message** (MOL-148, Р-6): a notice of kind `feedback` in the owner's
  channel (`owner_notices`, `observability.md`), queued in the transaction of the write, only where
  `OWNER_TELEGRAM_ID` is set, and never for a repeat. **It names its message by `feedback_id`** and
  goes with it — erased with the person, purged with the thread's year (Р-5); unclaimed, it is not
  dropped after a day as a failure's is, and it is handed again until the bot says it went
  (`observability.md`, adversarial В1). Going with the person, it is theirs to the copy too: every
  column of `owner_notices` is left out there with its reason — what it holds of them is the message,
  in `feedback` word for word. A message written before MOL-148 has none (Р-13).
- **The owner's reply and the person's answer to it are the bot's** (`bot.md`), and the API decides
  which a text is (`feedbackFromBot`). **The reply lies under the person's latest word in the thread**
  — that is what the owner answers — and «от 3 октября» is that word's day in the person's country's
  zone (Р-3). **A continuation is a message of its thread**: the thread's kind and language, no screen,
  platform or page build, the form's day limit, and no key: **the same words of the same person to
  the same reply within a rolling day are a repeat**, looked for before the count — an update Telegram
  hands over twice, or the word sent again after «ответьте ещё раз», is written once, and the same word
  a day on is a new one (Р-7, adversarial В3, round 2 Г1). It is found by the message the reply
  went out as — `feedback_replies.telegram_message_id`, looked for only beside the person (В-2).
- **A reply's outcome is the bot's word after the send** (Р-4): `sent` with that message, `blocked`,
  or `failed` — Telegram refused it otherwise, and it never reached the person nor keeps the thread
  alive (adversarial В4); empty is «unknown». `gone` is not a value: a message gone has no reply to
  mark. **A reply carries its thread** (`thread_id`, adversarial В5 of MOL-148): a continuation
  answers a reply of its own thread only — not another thread of the same person, or `purgeStale`
  took a fresh word with the old thread — by `(in_reply_to, actor_id, thread_key)`, `thread_key` the
  generated `coalesce(thread_id, id)` of every message.
- **The quote of a reply in «Продолжение» is one line** (`feedbackQuote`): a second line of the
  reply read as the person's own words under it.

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
