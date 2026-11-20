# Map · Payments: the journal, tariffs, access paid for

Rules: `.claude/rules/payments.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/entities/payment.ts` — Tariffs and the payment journal's domain (MOL-283): what each tariff costs in cents and which access it extends, tips, the states and channels, the price in drams at the day's rate rounded up to 10 ֏, thirty days on from the end, a whole refund taking them back.

## backend · usecases

- `backend/src/usecases/payments.ts` — Use cases of the payment journal (MOL-283): a payment opened at today's price — the anchor at the official rate fresh for the day — a channel's word written in (paid, declined, abandoned, waiting), a refund the bank makes first and the journal says after; `PaymentChannelAdapter`, the interface every channel of payment is.

## backend · db

- `backend/src/db/payments-repository.ts` — Repository of the journal: a payment written with its order number, the channel's name of it, «paid» set once with the access it extends under the person's lock, declined or abandoned, refunds adding up with the whole one taking the thirty days back, and the payments three years old deleted. Tests: `backend/tests/payments.integration.test.ts`.

## backend · tests

- `backend/tests/payments.integration.test.ts` — Integration test: order numbers in order, the channel's name unique, «paid» extending once however many times it is said, «both» each term from its own end, a tip extending nothing, an erased payer's payment paid with nothing extended, refunds up to the sum, three years to the day.
