# Map · Payments: the journal, tariffs, access paid for

Rules: `.claude/rules/payments.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/entities/payment.ts` — Tariffs and the payment journal's domain (MOL-283): what each tariff costs in cents and which access it extends, tips, the states and channels, the price in drams at the CBA's rate rounded up to 10 ֏, thirty days on from the end, the one rule of a refund's sum, a whole refund taking back the days not lived.

- `packages/model/src/contracts/payment.ts` — The wire of payment by card (MOL-277): the offer — the access as it stands, each tariff's price today and where its terms would end once paid, the tips, none without the CBA's rate — the start of a tariff or a tip in the page's language, the bank's page handed back, a payment's state with the access after it; `PAYMENTS_DAY_MAX`.

## backend · routes

- `backend/src/routes/payments.ts` — Routes of payment by card, registered only while the фф `payments` is on: `GET /payments/tariffs`, `POST /payments` (201, the bank's page), `GET /payments/:paymentId` — the person's own, one 404 for anyone else's, a missing one and a malformed address. Tests: `backend/tests/payments-routes.integration.test.ts`.

## backend · usecases

- `backend/src/usecases/payments.ts` — Use cases of the payment journal (MOL-283): a payment opened at today's price — the anchor at the CBA's rate fresh for today in Yerevan — a channel's word written in (paid, declined, abandoned, waiting), a refund the bank makes first and the journal says after, a refusal of the journal after the bank told apart from a conflict; `PaymentChannelAdapter`, the interface every channel of payment is. MOL-277: the offer of the screen, a payment started — written under the day's quota, then registered with the channel, a channel away a «try later» and a failure — and confirmed from the return page by the bank's word on its own saved id, the bank asked once in five seconds a payment.

## backend · vpos

- `backend/src/vpos/client.ts` — The client of Ameriabank's vPOS 3.1 (MOL-277): `InitPayment`, `GetPaymentDetails`, `GetPaymentId`, `RefundPayment`, `CancelPayment` and the SOAP `GetTransactionList`, the host the stand's — test, live, or end-to-end's fake — a timeout, a ceiling of bytes, the bank's codes read whatever their type, its 500 on a fresh order «not paid yet», and no credential in any error.
- `backend/src/vpos/config.ts` — The bank's stand and the merchant's three values, read only while the фф `payments` is on and then each required — the API does not start without them, naming the variable and never its value; end-to-end's fake bank (`local`) never in production.
- `backend/src/vpos/ameriabank.ts` — Ameriabank as a channel of the journal: the page in the person's language with its way back to `/pay/done`, a lost answer found by our order's number, «paid» only by the bank's `00` and `2` for our order, sum and dram — a `5`, a mismatch or a refund we never made said to the owner, never acted on — and the money back by `CancelPayment` within 72 hours or `RefundPayment`; 10 ֏ on the test stand.

- `backend/src/usecases/reconcile-payments.ts` — The reconciliation of payments by card (MOL-277): every minute each page still open asked of the bank from its first minute to 25 — then the last answer not «paid» abandons it — and once a day the bank's list of the two days before against the journal, an order the bank took money for settled by its own id, what still disagrees told to the owner by the order and the two states.

## backend · db

- `backend/src/db/payments-repository.ts` — Repository of the journal: a payment written with its order number, the channel's name of it given once, «paid» set once with the access it extends under the person's lock — after our «abandoned» too — and where the payment's days end, declined or abandoned, refunds adding up with the whole one taking back the days not lived and moving the later payments' ends, and the payments three years past their last movement and their days deleted. MOL-277: a payment written under the day's quota, the person's access ends, what the reconciliation reads, and a tap of «У меня только карта РФ» counted by the day (`rf_card_days`). Tests: `backend/tests/payments.integration.test.ts`.

## backend · tests

- `backend/tests/payments-reconcile.integration.test.ts` — Integration test of what the reconciliation reads: the payments still «created» a minute old and more in order, the payments of orders, the paid ones of a period by when they were paid, and a mismatch queued once however many runs see it, read back by the contract.
- `backend/tests/payments-routes.integration.test.ts` — Integration test of the routes with a channel of the test's: the offer at today's CBA rate and none without it, a payment started and named, a tip of its three sums only, a bank away a 503 with the row left, ten a rolling day and the eleventh refused, the return page opening the access on «paid», someone else's payment a 404, and off every route an address the API has not got.

- `backend/tests/payments.integration.test.ts` — Integration test: order numbers in order, the channel's name unique and given once, «paid» extending once however many times it is said, «paid» after «abandoned» and never after «declined», «both» each term from its own end, a tip extending nothing, an erased payer's payment paid with nothing extended, refunds up to the sum, a whole refund leaving a later payment's and a grant's days, three years to the moment, a paid one kept while its days are less than three years over.
