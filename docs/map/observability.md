# Map · Observability

Rules: `.claude/rules/observability.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/support/failure.ts` — A failure by its kind, never its content (MOL-58): `describeFailure` — name, driver code, up to eight frames cut below the stack's header — and `failureCodeOf`, the code under drizzle's wrapper; one rule for the API, the bot and the phone (MOL-143).
