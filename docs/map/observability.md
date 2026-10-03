# Map · Observability

Rules: `.claude/rules/observability.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/support/failure.ts` — A failure by its kind, never its content (MOL-58): `describeFailure` — name, driver code, up to eight frames cut below the stack's header — and `failureCodeOf`, the code under drizzle's wrapper; one rule for the API, the bot and the phone (MOL-143).
- `packages/model/src/contracts/failure.ts` — Wire contract of failures (MOL-143): the sources, the limits of a kind, code, route and frame, the bot's report of its own failure, the thresholds 10/100/1000, and the owner's notices — a union by `kind` the feedback of MOL-148 joins — with what a claim hands the bot.

## backend

- `backend/src/failure-reporter.ts` — One path for a failure of the API and the bot's reports (MOL-143): logged by its kind and gathered in memory by fingerprint, one write in flight a fingerprint and four at once, a burst written as one count; a recording that fails is one more line of the log; `apiFailureReporter` is the API's, queued for the owner.
- `backend/src/failures.ts` — The command behind `make failures` and `dist/failures.js`: the latest fingerprints — when, the first six of the fingerprint, source, kind, place, counts in all and in the last build, frames — the API's of the running build read back to the source through the image's map (`bundleDecoder`, В-6); usage and a failure by kind.
- `backend/src/failures-cli.ts` — Entry point of `dist/failures.js`: connects to the database and runs the failures command.
- `backend/src/usecases/record-failure.ts` — Use case «Сбой»: the fingerprint — source, kind, code, top frame without its position, place — the fields cut to the table's limits, and what the owner hears: the first time in a build, then 10, 100, 1000 crossed (В-2, В-5); the bot's report as a summary and its handler.
- `backend/src/db/failures-repository.ts` — Repository of `failures`: one occurrence added to its fingerprint by a single upsert that counts in the build, the owner's notices queued in the same transaction, the 30 days kept, the latest for `make failures`.
- `backend/src/db/owner-notices-repository.ts` — Repository of `owner_notices`: the claim that hands out and marks in one statement, skipping rows another claim holds; a notice about a failure unhanded for a day goes, a handed one after 30 days.
- `backend/src/usecases/owner-notices.ts` — Use case «Что сказать владельцу»: the notices waiting, handed to the bot with whom to write; nothing without an owner; a stored notice the contract no longer reads is said once and dropped.
- `backend/tests/failures-api.integration.test.ts` — Integration test of failures through a real server: a 500 by its route's template and never the address, a person's text in the driver's message nowhere, a refusal not a failure, one notice a build, none without an owner; the bot's report and the owner's claim through `/internal`.
- `backend/tests/failures.integration.test.ts` — Integration test of the two tables: the count by fingerprint and by build, ten at once, a notice in the same transaction, the 30 days, the queue handed out once, no key to `actors`.

## bin

- `bin/failures.sh` — Script behind `make failures [LIMIT=20]`: the latest failures in this copy's database; the line for production in its header.

## bot

- `bot/src/failure.ts` — The bot's failures (MOL-143): `handlerOf` — the kind of update and the prefix of its button or command, never its data or sender — what is a defect and what is the weather (network, Telegram, the API's own answers), the report by kind to the API, its own failure one line of the log.
- `bot/src/owner.ts` — The owner's notices: claimed from the API every minute as the reminders are, sent one by one in Russian, a 429 ending the run; `ownerText` writes a new failure, a count reached, and a message to the developer or its continuation with the thread's tag ending the first line (MOL-148), which `threadTagOf` reads back.
