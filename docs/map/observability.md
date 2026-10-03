# Map · Observability

Rules: `.claude/rules/observability.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/support/failure.ts` — A failure by its kind, never its content (MOL-58): `describeFailure` — name, driver code, up to eight frames cut below the stack's header — and `failureCodeOf`, the code under drizzle's wrapper; one rule for the API, the bot and the phone (MOL-143).
- `packages/model/src/contracts/failure.ts` — Wire contract of failures (MOL-143): the sources, the limits of a kind, code, route and frame, the bot's report of its own failure, the thresholds 10/100/1000, and the owner's notices — a union by `kind` the feedback of MOL-148 joins — with what a claim hands the bot.

## backend

- `backend/src/db/failures-repository.ts` — Repository of `failures`: one occurrence added to its fingerprint by a single upsert that counts in the build, the owner's notices queued in the same transaction, the 30 days kept, the latest for `make failures`.
- `backend/src/db/owner-notices-repository.ts` — Repository of `owner_notices`: the claim that hands out and marks in one statement, skipping rows another claim holds; a notice about a failure unhanded for a day goes, a handed one after 30 days.
- `backend/tests/failures.integration.test.ts` — Integration test of the two tables: the count by fingerprint and by build, ten at once, a notice in the same transaction, the 30 days, the queue handed out once, no key to `actors`.
