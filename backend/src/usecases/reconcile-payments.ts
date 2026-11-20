import { yerevanDate } from '@molvia/model'
import type { PaymentMismatchNotice, PaymentState } from '@molvia/model'
import type { PaymentRow, PaymentsRepository } from '@/db/payments-repository'
import { settlePayment } from './payments'
import type { PaymentChannelAdapter } from './payments'

/** The minute's reconciliation (MOL-277, Р-4): the bank sends no word of its own, so it is asked. */
export const PAYMENT_RECONCILE_EVERY_MS = 60_000

/** A payment is first asked a minute after it was made: the person is still on the bank's page. */
export const PAYMENT_FIRST_ASK_MS = 60_000

/**
 * The bank's page lives 1200 s (`Timeout`); five minutes more for a slow bank and a late return. Past them the
 * last answer that is not «paid» abandons the payment — the bank's «paid» after it is still paid (adversarial А2 of
 * MOL-283).
 */
export const PAYMENT_LAST_ASK_MS = 25 * 60_000

/** At most this many payments a minute: a few dozen payers a month (MOL-271) never come near it. */
export const PAYMENT_RECONCILE_BATCH = 100

/** The day's reconciliation by the bank's list (В-5 «а»): once a day, the two days before today in Yerevan. */
export const PAYMENT_LIST_EVERY_MS = 24 * 60 * 60 * 1000
export const PAYMENT_LIST_DAYS = 2

/** The bank's states that mean the money was taken: deposited, and refunded after it. */
const TAKEN = new Set(['2', '4'])

/** Our states that mean the money was taken. */
const KEPT: ReadonlySet<PaymentState> = new Set(['paid', 'refunded'])

/**
 * Each payment the bank's page may still hold, asked of the bank (requirement 6): its word written as the return
 * page's would be, and at 25 minutes «abandoned» unless the bank says otherwise. A bank away leaves the payment as it
 * is for the next minute; each failure is told, and the next payment is asked all the same.
 */
export async function reconcilePending(
  deps: {
    readonly payments: PaymentsRepository
    readonly channel: PaymentChannelAdapter
    readonly failed: (error: unknown) => void
  },
  now: Date,
): Promise<number> {
  const due = await deps.payments.pending(
    deps.channel.channel,
    new Date(now.getTime() - PAYMENT_FIRST_ASK_MS),
    PAYMENT_RECONCILE_BATCH,
  )
  let moved = 0
  for (const payment of due) {
    try {
      const word = await deps.channel.check(payment)
      const last = now.getTime() - payment.createdAt.getTime() >= PAYMENT_LAST_ASK_MS
      const settled = await settlePayment(
        deps,
        payment.id,
        word.said === 'waiting' && last ? { said: 'abandoned' } : word,
        now,
      )
      if (settled?.moved) moved += 1
    } catch (error) {
      deps.failed(error)
    }
  }
  return moved
}

/** One operation of the bank's list, as the reconciliation reads it: our order and the bank's state. */
export interface BankOperation {
  readonly orderId: string
  readonly state: string
}

/** The start of a day in Yerevan, which keeps +04:00 the year round. */
function yerevanMidnight(day: string): Date {
  return new Date(`${day}T00:00:00+04:00`)
}

/**
 * The bank's list of the days before today against the journal (В-5 «а»). An order the bank took money for that the
 * journal has not as paid is asked of the bank by its own id and settled — the minute's reconciliation missed it, a
 * bank away; what still disagrees, either way round, is told to the owner once (`tell`), by the order's number and the
 * two states, nothing of the person.
 */
export async function reconcileWithList(
  deps: {
    readonly payments: PaymentsRepository
    readonly channel: PaymentChannelAdapter
    readonly operations: (from: Date, to: Date) => Promise<readonly BankOperation[]>
    readonly tell: (notice: PaymentMismatchNotice) => Promise<void>
    readonly failed: (error: unknown) => void
  },
  now: Date,
): Promise<number> {
  const to = yerevanMidnight(yerevanDate(now))
  const from = yerevanMidnight(
    yerevanDate(new Date(to.getTime() - PAYMENT_LIST_DAYS * 24 * 60 * 60 * 1000 + 1)),
  )
  const operations = await deps.operations(from, to)
  const bankState = new Map<string, string>()
  for (const operation of operations) {
    // an order may be listed twice — a payment and its refund: the money taken is what counts
    const known = bankState.get(operation.orderId)
    if (known === undefined || TAKEN.has(operation.state)) {
      bankState.set(operation.orderId, operation.state)
    }
  }
  const taken = [...bankState].filter(([, state]) => TAKEN.has(state)).map(([order]) => order)
  const ours = new Map<string, PaymentRow>(
    (
      await deps.payments.byOrders(
        deps.channel.channel,
        taken.filter((order) => /^\d{1,19}$/.test(order)).map(BigInt),
      )
    ).map((payment) => [String(payment.orderNo), payment]),
  )
  const notices: PaymentMismatchNotice[] = []
  for (const order of taken) {
    if (!/^\d{1,19}$/.test(order)) {
      deps.failed(new Error('the bank listed an order that is no number of ours'))
      continue
    }
    const payment = ours.get(order)
    if (payment === undefined) {
      notices.push(mismatch(order, bankState.get(order), 'none'))
      continue
    }
    let state = payment.state
    if (!KEPT.has(state)) {
      try {
        const settled = await settlePayment(
          deps,
          payment.id,
          await deps.channel.check(payment),
          now,
        )
        if (settled !== null) state = settled.state
      } catch (error) {
        deps.failed(error)
      }
    }
    if (!KEPT.has(state)) notices.push(mismatch(order, bankState.get(order), state))
  }
  for (const payment of await deps.payments.paidWithin(deps.channel.channel, from, to)) {
    const order = String(payment.orderNo)
    const state = bankState.get(order)
    if (state === undefined || !TAKEN.has(state)) {
      notices.push(mismatch(order, state, payment.state))
    }
  }
  for (const notice of notices) await deps.tell(notice)
  return notices.length
}

function mismatch(
  orderNo: string,
  bank: string | undefined,
  journal: PaymentState | 'none',
): PaymentMismatchNotice {
  const said = bank === undefined || !/^[\w-]{1,8}$/.test(bank) ? 'none' : bank
  return { kind: 'payment_mismatch', orderNo, bank: said, journal }
}
