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
MOL-283 (В-1), 20.11.2026.

## One journal, channels as adapters

- **Every channel writes the one table, `payments`** (MOL-283): a channel is a `PaymentChannelAdapter` — it starts a
  payment on its side (the page the person pays on), says what became of it when asked, and gives money back. A second
  channel (Idram, by the outcome of MOL-282) is a second adapter, never a second journal: a journal of its own would
  repeat «paid once», the extension and the refund, and the two would drift.
- **The price is fixed at creation** (`openPayment`): the anchor in dollars (`PAYMENT_TARIFFS`, `TIP_CENTS`), the
  official rate fresh for the person's day — `freshOfficialRate`, the week a comparison allows, never a second rule of
  freshness (Р-1 of MOL-283 over Р-1 of MOL-277, which said five days) — and the drams charged, `paymentPrice`, **rounded
  up** to 10 ֏ in integers: the dollar named is never less than what is asked. No fresh rate, no payment — a price is
  never made up. The row keeps all three, so a later rate never re-prices a payment.
- **`order_no` is an identity**: Ameriabank names an order by an integer of the merchant's (MOL-281 §4). The bank's test
  range of numbers is the channel's concern (MOL-277), not the journal's.
- **The channel's name of a payment is unique with its channel** (`payments_channel_ref_key`): a repeat of the bank's
  word is the same row.

## «Paid» once, and the access with it

- **Created → paid is a conditional write under the person's lock** (owner, 12.11.2026, «this has to be idempotent»):
  the person's row `for no key update` first — as every writer of a person's rows takes it — then `update … where state
= 'created'`. Whichever word comes first — the return page, the minute's or the day's reconciliation — extends; the
  others find «paid» and move nothing. The extension is in the same transaction.
- **Thirty days from the end of a running term, or from now** (`extendedUntil`, MOL-271): `both` extends each column
  from its own end; two payments in a row are two payments, sixty days (MOL-277 В-3 «а»); a tip extends nothing.
- **Declined or abandoned closes only a created payment**, and «paid» after either changes nothing — nor does a
  «declined» after «paid».
- **A payer erased before the bank's word**: the payment is paid and extends nothing — there is nobody.
- **Extending moves `actors.updated_at`**: a change of access is a change of the row, as a grant by hand is.

## Refunds

- **Refunds add up, never past the amount** (MOL-281 §1); a refund of a payment not paid, of nothing or past what is
  left is a conflict, refused before the bank is asked. **The bank first, the journal after** (`refundPayment`): the
  journal says what the bank did, never what it was asked; a refusal there leaves the journal as it was.
- **The refund that makes it whole takes back the thirty days, never earlier than now** (`refundedUntil`, MOL-277 В-2
  «а»): a later payment's days stay, an access already over is left as it is; a partial refund is money only.
- **The owner refunds by a command** (MOL-277 Р-9), never a screen.

## Keeping

- **Erasure lets the person go and keeps the payment** (MOL-283 В-1 «а»): `payments.actor_id` is `on delete set null`,
  as the shops' memory and the catalogue's codes are, since Ameriabank's terms §3.9 keep card records three years and
  hand them to the bank within three banking days. What stays names nobody: an order number, the sums, the bank's
  numbers. The report counts it (`paymentsReleased`), `make forget` prints it.
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
