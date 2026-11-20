---
paths:
  - 'packages/model/src/entities/payment.ts'
  - 'packages/model/tests/entities/payment.test.ts'
  - 'backend/src/usecases/payments*.ts'
  - 'backend/src/db/payments-repository.ts'
  - 'backend/tests/payments.integration.test.ts'
---

# Payments: the journal, tariffs, access paid for

The detail behind the payments lines of `CLAUDE.md`. The journal is MOL-283; its first channel, Ameriabank vPOS, is
MOL-277 (its research: `.scratch/tasks/research/MOL-281.md`). Decisions: owner's lavish of MOL-277 (В-1…В-7) and of
MOL-283 (В-1), 20.11.2026; round 1 of its review and adversarial (`.scratch/tasks/selfreviews/MOL-283.md`,
`selftests/MOL-283-adversarial.md`).

## One journal, channels as adapters

- **Every channel writes the one table, `payments`** (MOL-283): a channel is a `PaymentChannelAdapter` — it starts a
  payment on its side (the page the person pays on), says what became of it when asked, and gives money back. A second
  channel (Idram, by the outcome of MOL-282) is a second adapter, never a second journal: a journal of its own would
  repeat «paid once», the extension and the refund, and the two would drift.
- **The price is fixed at creation** (`openPayment`): the anchor in dollars (`PAYMENT_TARIFFS`, `TIP_CENTS`; a tip's
  amount only beside a tip, `PaymentOrder`), the CBA's rate fresh for today in Yerevan — `freshOfficialRate`, the week a
  comparison allows, never a second rule of freshness (Р-1 of MOL-283 over Р-1 of MOL-277, which said five days) — and
  the drams charged, `paymentPrice`, **rounded up** to 10 ֏ in integers: the dollar named is never less than what is
  asked. No fresh rate, no payment — a price is never made up. The row keeps all three, the rate with its own moment
  (`rate_as_of`): on a Sunday the price is Friday's rate, and the row says Friday (review №1, adversarial А4).
- **The rate is the CBA's alone** (requirement 2; adversarial А3): `pickOfficialRate` falls back to open.er-api or the
  Bank of Russia when the CBA is a week silent, and a price of an aggregator's rate is no official price for the
  turnover of the sole trader nor an answer to the bank — so the use case hands it the CBA's rows only, as «Обмен
  денег» does for its bank, and a silent CBA is no payment. **The day is the server's, never the caller's** (А5): today
  in Yerevan, where the CBA publishes — a day a caller names would choose its rate.
- **`order_no` is an identity**: Ameriabank names an order by an integer of the merchant's (MOL-281 §4). The bank's test
  range of numbers is the channel's concern (MOL-277), not the journal's.
- **The channel's name of a payment is unique with its channel** (`payments_channel_ref_key`): a repeat of the bank's
  word is the same row. **It is given once** (`named`, review №4): a later name, the same or another, changes nothing —
  the bank never renames an order, and a second name would cut the row from the first.

## «Paid» once, and the access with it

- **Created → paid is a conditional write under the person's lock** (owner, 12.11.2026, «this has to be idempotent»):
  the person's row `for no key update` first — as every writer of a person's rows takes it — then `update … where state
= 'created'`. Whichever word comes first — the return page, the minute's or the day's reconciliation — extends; the
  others find «paid» and move nothing. The extension is in the same transaction.
- **Thirty days from the end of a running term, or from now** (`extendedUntil`, MOL-271): `both` extends each column
  from its own end; two payments in a row are two payments, sixty days (MOL-277 В-3 «а»); a tip extends nothing.
- **Declined or abandoned closes only a created payment, and «paid» after «declined» changes nothing** — nor does a
  «declined» after «paid». **The bank's «paid» after our «abandoned» is paid** (adversarial А2): «abandoned» is our
  judgement of a page outlived, and a person may pass 3-D Secure at its very edge — the money taken, the reconciliation
  hearing it, and the journal left «abandoned» would keep neither access nor the bank's numbers nor a way to refund.
  «Declined» is the bank's own final word.
- **A payment keeps where its days end** (`shared_until`, `receipts_model_until` of `payments`, adversarial А1): the
  end each access reached by its extension, for the refund below.
- **A payer erased before the bank's word**: the payment is paid and extends nothing — there is nobody.
- **Extending moves `actors.updated_at`**: a change of access is a change of the row, as a grant by hand is.

## Refunds

- **Refunds add up, never past the amount** (MOL-281 §1); a refund of a payment not paid, of nothing or past what is
  left is a conflict, refused before the bank is asked. **One rule, `refundSum` in the domain** (review №2): the use
  case asks it before the bank, the journal again under the payment's lock. **The bank first, the journal after**
  (`refundPayment`): the journal says what the bank did, never what it was asked; a refusal there leaves the journal as
  it was. **The journal refusing after the bank gave the money is no conflict but a defect** (review №3): the check
  before the bank reads with no lock, so a second refund of the same payment between the two lands there — said as
  «the bank refunded …, the journal did not record it», never the conflict a refusal before the bank answers. The price,
  named: refunds are one command of the owner (MOL-277 Р-9), one at a time, so it takes two commands at once.
- **The refund that makes it whole takes back the days the payment gave and the person has not lived, never earlier
  than now** (`refundedUntil`, MOL-277 В-2 «а», adversarial А1): its days are the thirty before the end it stored; those
  lived stay, and so do a later payment's and a grant's by hand — a refund months after the payment takes nothing, one
  the day it was paid takes the thirty. An access already over is left as it is; a partial refund is money only.
- **The owner refunds by a command** (MOL-277 Р-9), never a screen.

## Keeping

- **Erasure lets the person go and keeps the payment** (MOL-283 В-1 «а»): `payments.actor_id` is `on delete set null`,
  as the shops' memory and the catalogue's codes are, since Ameriabank's terms §3.9 keep card records three years and
  hand them to the bank within three banking days. What stays names nobody: an order number, the sums, the bank's
  numbers. The report counts it (`paymentsReleased`), `make forget` prints it. **A payment the channel never named goes
  with the person** (adversarial А6): it reached no bank, so there is no card record to keep, and «no data is kept
  without a reason». The price, named: a payment erased between the bank's taking the order and its name written —
  the moment of one request — is unknown to the journal when the bank speaks of it.
- **Every payment goes three years after its last movement** (`PAYMENT_KEEP_YEARS`, `moved_at`), a living person's too:
  no data is kept without a reason. A daily timer (`PAYMENT_SWEEP_EVERY_MS`), at start too, `job:payment-sweep`.
- **Of the channel's answer only the state, the sums and its numbers are kept** — `rrn`, the approval code, the
  channel's id. The holder's name, email, card mask, its term and issuer the bank sends are never written (MOL-281 §8).
- **The copy carries every payment** (`payments`, version 38), every column but the owner's key.
- **The privacy page names payments in MOL-277's edition**, with Ameriabank as a recipient: without a channel no row
  is ever written. The record of processing (Confluence 12091393) gains the journal's row on the owner's word.

## The price, named

- **Nothing writes a row before MOL-277**: the journal ships unused — no route, no screen, no фф needed, since no person
  can reach it.
- **«Paid» locks the person's row**: a payment confirmed while that person records a receipt waits for it, a moment.
- **No index waits for a reader** (review №7): the sweep of payments abandoned by time, and its index, come with
  MOL-277, which reads them.
