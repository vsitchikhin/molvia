# Map · Feedback: «Написать разработчику»

Rules: `.claude/rules/feedback.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/feedback.ts` — Contract of «Написать разработчику» (MOL-147): the kind, the text, what is attached — builds, screen, platform, language, an error's code — and the phone's key for the content; the day's limit and how long a thread is kept.

## backend · routes

- `backend/src/routes/feedback.ts` — Route `POST /feedback` (MOL-147): the session's owner writes; 201 for a new message, 200 for the same one again, `no-store`. The bot's two routes of it — `POST /internal/feedback/reply` and `/delivered` — stand beside the bot's others in `internal-auth.ts` (MOL-148).

## backend · usecases

- `backend/src/usecases/send-feedback.ts` — Use case of «Написать разработчику» (MOL-147): the session's owner, the API's own build, the day's limit of the domain; past it `error.feedback_rate_limited`; a new message queued for the owner when there is one (MOL-148).
- `backend/src/usecases/feedback-from-bot.ts` — Use case of a text written to the bot as a reply (MOL-148): the owner's reply on a tagged notice, else a person's word on a reply they were sent, else `404`; the length by who writes, and the key of a Telegram message.

## backend · db

- `backend/src/db/feedback-repository.ts` — Repository of messages to the developer (MOL-147): a write under a lock of its author — a repeat by the phone's key, the rolling day's count, the row, the owner's notice — and `purgeStale`, a thread a year past its last message, run by the minute timer; the owner's reply under the person's latest word, the reply a Telegram message answers, a word continuing a thread, and what became of a reply sent (MOL-148).

## backend · tests

- `backend/tests/feedback.integration.test.ts` — Integration test: `POST /feedback` writes the session's owner with the API's build; no session, an author named, an empty or invisible text, a code without an error screen are refused; a repeat is the same number, another content under the key a 409; the tenth of a rolling day is taken, the eleventh a 429, a burst stops at the limit; a thread goes whole a year past its last message, the person's or the owner's.

- `backend/tests/feedback-bot.integration.test.ts` — Integration test of the bot's half (MOL-148): a new message queues one notice for the owner with nothing of the person, a repeat and a copy without an owner none, the bot's claim reads it; erasure and a thread's year take the notice along, a day unclaimed does not; the owner's reply — a stranger's tag, no owner, an erased author, a lapsed thread, too long, the outcome of a send; a thread continued — its keys, a reply under it, the same update twice, another's chat, the form's limit, erasure.

## frontend · components

- `frontend/src/components/FeedbackSheet.vue` — The sheet «Написать разработчику» (MOL-147), one for the app in `App.vue`: the kind, the text, what goes with it shown before sending, the button that says what it waits for, sent, the day's limit, a failure.

## frontend · stores

- `frontend/src/stores/feedbackDraft.ts` — The draft of a message to the developer on the device (MOL-147): the kind, the text and the key of its content, under the person.
- `frontend/src/stores/feedbackSheet.ts` — Opens the one sheet «Написать разработчику» and keeps where from — the settings, or an error screen with the code of the last refusal.

## frontend · other

- `frontend/src/platform.ts` — The platform a message to the developer carries (MOL-147): `platformLine` — the system, the major version the browser still tells, app or browser — and `standalone()`, opened from the home screen, shared with the camera hint.

## e2e

- `e2e/feedback.spec.ts` — End-to-end: «Написать разработчику» from the settings with no kind chosen, from an error screen with «Сломалось», the screen and the code, «back» puts the sheet away, offline the button waits and the draft stays; each row read back through the copy.
