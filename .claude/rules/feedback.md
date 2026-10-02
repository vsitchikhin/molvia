---
paths:
  - 'packages/model/src/contracts/feedback.ts'
  - 'packages/model/tests/contracts/feedback.test.ts'
  - 'backend/src/routes/feedback.ts'
  - 'backend/src/usecases/send-feedback*.ts'
  - 'backend/src/db/feedback-repository.ts'
  - 'backend/tests/feedback.integration.test.ts'
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
  without its query or parameters, the platform, the app's language, and from an error screen the
  code. Never the content of a screen, a draft, the queue or the User-Agent. The build of the API is
  stamped by the API at the write — never the phone's word for it.
- **The platform is a line the domain can check**, `feedbackPlatformSchema`: a system from a short
  list, its major version when the platform shows one, `app` or `browser` — `ios 18 app`. Any other
  shape is refused, so the phone cannot attach more than the sheet says it does (MOL-147, Р-4).
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
  half (MOL-148); a continuation from Telegram has no screen, platform or key.
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
- **The owner's notice is not in MOL-147** (Р-7): there is no channel to the owner yet (MOL-143), and
  MOL-148 builds it if it comes first. Until then a message waits in the table.
