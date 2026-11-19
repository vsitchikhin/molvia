# Map · Spendings from a bank's statement

Rules: `.claude/rules/statements.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/entities/statement-line.ts` — The statement's line every reader fills, the statement, its forms and kinds, the link a record keeps of its line, and the line's key (`statementLineKeys`, MOL-429).
- `packages/model/src/entities/statement-match.ts` — The duplicates rule: candidates from spendings, trips, transfers and exchanges, and each line's answer — new, recorded or no spending — with the holds no line posted (MOL-429).
- `packages/model/src/support/payee-name.ts` — A payee's name folded across scripts for the duplicates rule, and the share of a record's words it has.
- `packages/model/src/support/printed-time.ts` — A screenshot's printed time on the 24-hour clock, and whether two of them are one operation.
