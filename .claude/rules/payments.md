---
paths:
  - 'packages/model/src/entities/payment.ts'
  - 'packages/model/tests/entities/payment.test.ts'
  - 'backend/src/usecases/payments*.ts'
  - 'backend/src/db/payments-repository.ts'
  - 'backend/tests/payments.integration.test.ts'
  - 'backend/tests/payments-*.integration.test.ts'
  - 'backend/src/vpos/**'
  - 'backend/src/routes/payments.ts'
  - 'backend/src/usecases/reconcile-payments*.ts'
  - 'backend/src/refund*.ts'
  - 'packages/model/src/contracts/payment.ts'
  - 'frontend/src/views/Pay*.vue'
  - 'frontend/src/composables/usePaymentOffer.ts'
  - 'frontend/src/components/RfCardSheet.vue'
  - 'bin/fake-vpos.mjs'
---

# Payments: the journal, tariffs, access paid for

The detail behind the payments lines of `CLAUDE.md`. The journal is MOL-283; its first channel, Ameriabank vPOS, is
MOL-277 (its research: `.scratch/tasks/research/MOL-281.md`). Decisions: owner's lavish of MOL-277 (В-1…В-7) and of
MOL-283 (В-1), 20.11.2026; rounds 1–2 of its review and adversarial (`.scratch/tasks/selfreviews/MOL-283.md`,
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
  end each access reached by its extension, for the refund below — **and moves it when its days move**: a whole
  refund of an earlier payment brings every later paid payment's end earlier by what the access moved — one shift,
  decided once (`shiftLater`, adversarial Б1, review №11),
  or the next refund reads an end that is gone and takes a later payment's days. Later is an end past the refunded
  one: while any of a payment's days is to come, every payment after it extended from the end of a running term, so
  none is apart from it.
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
  the day it was paid takes the thirty (`unlivedMs`). The price, named: a grant by hand that lowers a term is not
  followed into the payments' ends — `psql` is the owner's, and only until MOL-277. An access already over is left as it is; a partial refund is money only.
- **The owner refunds by a command** (MOL-277 Р-9), never a screen.

## Keeping

- **Erasure lets the person go and keeps the payment** (MOL-283 В-1 «а»): `payments.actor_id` is `on delete set null`,
  as the shops' memory and the catalogue's codes are, since Ameriabank's terms §3.9 keep card records three years and
  hand them to the bank within three banking days. What stays names nobody: an order number, the sums, the bank's
  numbers. The report counts it (`paymentsReleased`), `make forget` prints it. **A payment the channel never named and
  nobody paid goes with the person** (adversarial А6): it reached no bank, so there is no card record to keep, and «no
  data is kept without a reason». A paid one stays however it is named (review №10): nothing ties a name to the
  money. The price, named: a payment erased between the bank's taking the order and its name written —
  the moment of one request — is unknown to the journal when the bank speaks of it.
- **Every payment goes three years after its last movement** (`PAYMENT_KEEP_YEARS`, `moved_at`), a living person's too:
  no data is kept without a reason. **A paid one, three years after the end of its days too** (adversarial Д1): a term
  paid years ahead (37 months at once) moved its rows on the day it was paid, and the sweep took them while their days
  were still to come — a refund of them answered «not found» and nothing said what the access was paid by. A refunded
  one's ends went with its days, so it goes by its movement alone. A daily timer (`PAYMENT_SWEEP_EVERY_MS`), at start
  too, `job:payment-sweep`.
- **Of the channel's answer only the state, the sums and its numbers are kept** — `rrn`, the approval code, the
  channel's id. The holder's name, email, card mask, its term and issuer the bank sends are never written (MOL-281 §8).
- **The copy carries every payment** (`payments`, version 38), every column but the owner's key.
- **The privacy page names payments in MOL-277's edition**, with Ameriabank as a recipient: without a channel no row
  is ever written. The record of processing (Confluence 12091393) names the journal as row 17 (v42).

## Ameriabank vPOS, the first channel (MOL-277)

Owner's lavish of 20.11.2026, В-1…В-7 and Р-1…Р-13 (`.scratch/tasks/plans/MOL-277.md`); the bank's API as it was read —
`.scratch/tasks/research/MOL-281.md`.

- **Behind the фф `payments`, off until the bank is connected** (MOL-382; on not before 01.01.2027, MOL-282): off, its
  routes, its timers and its entries on the phone are not there at all. **On, the bank is required** (`vposConfiguration`):
  `VPOS_STAND` (`test`, `live`; `local` is end-to-end's fake and never production) and the merchant's three values —
  missing, the API does not start, naming the variable and never its value. The test stand takes 10 ֏ whatever the
  tariff (`chargedDrams`).
- **The host is the code's by the stand, never a request's** (`VPOS_HOSTS`, SSRF), every answer through `boundedBody`,
  15 s a call. **The merchant's values are in every body and nowhere else**: a failed call keeps no cause — the cause
  carried the request — and an error names the method and the bank's code alone (`VposError`).
- **The bank's codes are read whatever their type** — `1` an integer, `"00"` a string, `OrderStatus` either — **and never
  by the HTTP status**: a wrong password is a 200 with `20`, and **a 500 of `GetPaymentDetails` is «not paid yet»**, no
  failure (MOL-281 §1).
- **«Paid» only by the bank's word on our own saved id** (`judged`, requirement 4): `ResponseCode "00"`, `OrderStatus "2"`,
  our `OrderID`, `"051"`, `ApprovedAmount` the sum charged. The address the bank sends the browser back to is a hint of
  which payment to open, never a word of what became of it — `resposneCode=00` is typed by hand. `6` and `3` are
  declined; nothing tried and the page's time out are waiting, for the reconciliation. **A `5`, a «paid» of another
  order, sum or currency, and a refund we never made are told to the owner and never acted on** (`VposStrangeAnswer`,
  `job:payment-bank`, Р-2).
- **A lost answer of `InitPayment` is found by our order's number** (`GetPaymentId`), else the same body again — never a
  new one: a repeat with another body rewrites the order (MOL-281 §4). A new tap of the person is a new order.
- **The bank sends the browser back to the PWA, never the API** (`BackURL` = `APP_BASE_URL/pay/done/<payment>`): a
  navigation from another site is a 404 at the API (MOL-368), so the page opens from the worker and asks by its own
  `fetch`. The payment's id is in the path: the bank adds its own query to the address it was given.
- **The return page asks the bank at most once in five seconds a payment** (`paymentAskLimiter`, in the API's memory),
  however often it is asked; a bank away answers the state as it stands. The page asks again every five seconds for a
  minute, then the server's minute is the one that asks.
- **The minute's reconciliation** (`reconcilePending`, Р-4): every «created» from its first minute to 25 — the page's
  1200 s and five minutes more — is asked, its word written as the return page's; at 25 the last answer that is not
  «paid» abandons it. A bank away leaves it for the next minute, and each failure is told. At most a hundred a minute.
- **The day's reconciliation by the bank's list** (`reconcileWithList`, В-5 «а»): the SOAP `GetTransactionList` of the
  two days before today in Yerevan against the journal. An order the bank took money for (`2`, `4`) that the journal has
  not as paid is asked by its own id and settled; what still disagrees — either way round — is a `payment_mismatch`
  notice to the owner by the order's number and the two states, nothing of the person, queued once (`queueOnce`): every
  restart looks at the same days again. An order the bank lists that is no number of ours is a failure, never a notice.
  A copy with no owner logs it. Only with a real bank: a channel a test names has no list.
- **The price is today's and the screen's figures are the server's** (Р-1): `GET /payments/tariffs` says the access as
  it stands — a term already over is none, so the phone keeps no clock — each tariff's price and where its terms would
  end once paid now, and the tips; no CBA rate fresh for today, no prices, and the screen says it as attention, never an
  error. `POST /payments` with no price is `409 error.payment_unpriced`.
- **A payment is started at most ten times a rolling day a person** (`PAYMENTS_DAY_MAX`, Р-12, MOL-287's rule of a new
  write path): counted from the journal under the person's row lock (`createWithin`), past it `429
error.payments_day_limited`, nothing written. **A bank that did not register the order is `503
error.payment_channel_unavailable`**: nothing charged, the owner hears the failure, and the row the bank never named is
  abandoned by the minute.
- **«Оплата» on the phone** (`PayView`, В-6 «а»: the kit, by the lavish's mockups): three tariffs, one chosen — `?tariff=`
  from the receipts' sheet and the settings' row, receipts by default — a price in dollars and drams, «открыто до → продлит
  до», one button «Оплатить картой N ֏», the tips at the bottom (В-4 «а»). The bank's page is left by a full navigation
  (`openBankPage`), never the router. Nothing kept: a price is today's.
- **The entries are payment's only while the фф is on** (В-7 «а»): «Открыть за $2» first in «Пробные чеки закончились»
  and «Распознавание закончилось» — never in «Сотня чеков месяца прочитана», which a payment does not lift — and a chevron
  on «Распознавание чеков» of «Настройки». «Чужие данные» is MOL-395's.
- **«У меня только карта РФ»** (Р-8): a sheet that says the bank takes no card a Russian bank issued (MOL-282), and a tap
  counted by Yerevan's day with no id (`rf_card_days`) — the device's own repeat within a day apart, as the login's — read
  in `make gates` with no stop.
- **The owner refunds by `make refund ORDER= [AMOUNT=] [YES=1]`** (Р-9; `dist/refund.js` on production): a dry run
  without `YES=1`, the bank first, the journal after; the whole sum within 72 hours is `CancelPayment`, else
  `RefundPayment`. The bank's values are read for a real refund only, whether the фф is on or not.
- **The bot says nothing of payment** (Р-11): Telegram's rules for digital goods.

## The price, named

- **End-to-end starts no payment**: its database keeps no CBA rate (`money.spec` holds dollars «не посчитано» on that),
  so the screen says «no price» there; the way to the bank and back is held by the integration test with a channel of
  its own and the components'. The fake bank (`bin/fake-vpos.mjs`) is there so the API starts with every фф on.
- **The minute reads the «created» payments with no index of their own**: a few dozen payers a month (MOL-271); an
  index comes when the table says it needs one.
- **The ask limiter and the bank's answers live in the API's process** — there is one; a restart forgets which payment
  was asked a second ago, and asks it once more.
- **«Paid» locks the person's row**: a payment confirmed while that person records a receipt waits for it, a moment.
- **No index waits for a reader** (review №7): the sweep of payments abandoned by time, and its index, come with
  MOL-277, which reads them.
