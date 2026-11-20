# Map · Payments: the journal, tariffs, access paid for

Rules: `.claude/rules/payments.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/entities/payment.ts` — Tariffs and the payment journal's domain (MOL-283): what each tariff costs in cents and which access it extends, tips, the states and channels, the price in drams at the CBA's rate rounded up to 10 ֏, thirty days on from the end, the one rule of a refund's sum, a whole refund taking back the days not lived.

## backend · usecases

- `backend/src/usecases/payments.ts` — Use cases of the payment journal (MOL-283): a payment opened at today's price — the anchor at the CBA's rate fresh for today in Yerevan — a channel's word written in (paid, declined, abandoned, waiting), a refund the bank makes first and the journal says after, a refusal of the journal after the bank told apart from a conflict; `PaymentChannelAdapter`, the interface every channel of payment is.

## backend · vpos

- `backend/src/vpos/client.ts` — The client of Ameriabank's vPOS 3.1 (MOL-277): `InitPayment`, `GetPaymentDetails`, `GetPaymentId`, `RefundPayment`, `CancelPayment` and the SOAP `GetTransactionList`, the host the stand's — test, live, or end-to-end's fake — a timeout, a ceiling of bytes, the bank's codes read whatever their type, its 500 on a fresh order «not paid yet», and no credential in any error.
- `backend/src/vpos/ameriabank.ts` — Ameriabank as a channel of the journal: the page in the person's language with its way back to `/pay/done`, a lost answer found by our order's number, «paid» only by the bank's `00` and `2` for our order, sum and dram — a `5`, a mismatch or a refund we never made said to the owner, never acted on — and the money back by `CancelPayment` within 72 hours or `RefundPayment`; 10 ֏ on the test stand.

## backend · db

- `backend/src/db/payments-repository.ts` — Repository of the journal: a payment written with its order number, the channel's name of it given once, «paid» set once with the access it extends under the person's lock — after our «abandoned» too — and where the payment's days end, declined or abandoned, refunds adding up with the whole one taking back the days not lived and moving the later payments' ends, and the payments three years past their last movement and their days deleted. Tests: `backend/tests/payments.integration.test.ts`.

## backend · tests

- `backend/tests/payments.integration.test.ts` — Integration test: order numbers in order, the channel's name unique and given once, «paid» extending once however many times it is said, «paid» after «abandoned» and never after «declined», «both» each term from its own end, a tip extending nothing, an erased payer's payment paid with nothing extended, refunds up to the sum, a whole refund leaving a later payment's and a grant's days, three years to the moment, a paid one kept while its days are less than three years over.
