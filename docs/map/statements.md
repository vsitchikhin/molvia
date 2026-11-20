# Map · Spendings from a bank's statement

Rules: `.claude/rules/statements.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/entities/statement-line.ts` — The statement's line every reader fills, the statement, its forms and kinds, the link a record keeps of its line, and the line's key (`statementKeyedLines`, MOL-429).
- `packages/model/src/entities/statement-match.ts` — The duplicates rule: candidates from spendings, trips, transfers and exchanges, and each line's answer — new, recorded or no spending — with the holds no line posted (MOL-429).
- `packages/model/src/support/payee-name.ts` — A payee's name folded across scripts for the duplicates rule: a seller's words with the places aside, the share of a record's words a payee has, and whether two names are one seller.
- `packages/model/src/support/printed-time.ts` — A screenshot's printed time on the 24-hour clock, and whether two of them are one operation.

## backend · statements

- `backend/src/statements/csv.ts` — A bank's CSV export as text and records: UTF-8 or Windows-1251, quotes by RFC 4180, each record with its line in the file (MOL-430).
- `backend/src/statements/refusal.ts` — What every parser of a bank's file answers: its accounts or the refusal named, `StatementRead`, `StatementRefusal` (MOL-430).
- `backend/src/statements/tbank.ts` — T-Bank's CSV as statement lines, one statement an account by its name and currency, or the refusal of the file (MOL-430).
