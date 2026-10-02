# Map · Feedback: «Написать разработчику»

Rules: `.claude/rules/feedback.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/feedback.ts` — Contract of «Написать разработчику» (MOL-147): the kind, the text, what is attached — builds, screen, platform, language, an error's code — and the phone's key for the content; the day's limit and how long a thread is kept.

## backend · routes

- `backend/src/routes/feedback.ts` — Route `POST /feedback` (MOL-147): the session's owner writes; 201 for a new message, 200 for the same one again, `no-store`.

## backend · usecases

- `backend/src/usecases/send-feedback.ts` — Use case of «Написать разработчику» (MOL-147): the session's owner, the API's own build, the day's limit of the domain; past it `error.feedback_rate_limited`.

## backend · db

- `backend/src/db/feedback-repository.ts` — Repository of messages to the developer (MOL-147): a write under a lock of its author — a repeat by the phone's key, the rolling day's count, the row — and `purgeStale`, a thread a year past its last message, run by the minute timer.

## backend · tests

- `backend/tests/feedback.integration.test.ts` — Integration test: `POST /feedback` writes the session's owner with the API's build; no session, an author named, an empty or invisible text, a code without an error screen are refused; a repeat is the same number, another content under the key a 409; the tenth of a rolling day is taken, the eleventh a 429, a burst stops at the limit; a thread goes whole a year past its last message, the person's or the owner's.

## frontend

- `frontend/src/platform.ts` — The platform a message to the developer carries (MOL-147): `platformLine` — the system, the major version the browser still tells, app or browser — and `standalone()`, opened from the home screen, shared with the camera hint.
