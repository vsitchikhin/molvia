# Map · Payments: the journal, tariffs, access paid for

Rules: `.claude/rules/payments.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/entities/payment.ts` — Tariffs and the payment journal's domain (MOL-283): what each tariff costs in cents and which access it extends, tips, the states and channels, the price in drams at the day's rate rounded up to 10 ֏, thirty days on from the end, a whole refund taking them back.
