import { randomUUID } from 'node:crypto'
import {
  DomainError,
  ERROR,
  PAYMENT_ANCHOR_CURRENCY,
  PAYMENT_CURRENCY,
  anchorCentsOf,
  paymentPrice,
  refundSum,
  yerevanDate,
} from '@molvia/model'
import type { Money, PaymentChannel, PaymentOrder } from '@molvia/model'
import type { RateRepository } from '@/db/rates-repository'
import type { PaidFacts, PaymentRow, PaymentsRepository, Settled } from '@/db/payments-repository'
import { freshOfficialRate } from './exchanges'

/** The journal's three years are swept once a day: a day late is nothing against three years. */
export const PAYMENT_SWEEP_EVERY_MS = 24 * 60 * 60 * 1000

/**
 * What a channel said of a payment when asked: paid with its numbers, declined, its page outlived with nothing
 * paid, or nothing yet.
 */
export type ChannelWord =
  | { readonly said: 'paid'; readonly facts: PaidFacts }
  | { readonly said: 'declined' }
  | { readonly said: 'abandoned' }
  | { readonly said: 'waiting' }

/**
 * A channel of payment as the journal sees it (MOL-283): an adapter that starts a payment on its side — the
 * page the person pays on — says what became of it when asked, and gives money back. The journal stays one
 * for every channel; Ameriabank is the first (MOL-277).
 */
export interface PaymentChannelAdapter {
  readonly channel: PaymentChannel
  /** The channel's page for the payment, in the person's language; its name of the payment is `ref`. */
  start(
    payment: PaymentRow,
    lang: 'ru' | 'en',
  ): Promise<{ readonly ref: string; readonly url: string }>
  check(payment: PaymentRow): Promise<ChannelWord>
  refund(payment: PaymentRow, minor: bigint): Promise<void>
}

/** A payment opened: its journal row, at the price fixed now. */
export interface OpenedPayment {
  readonly id: string
  readonly orderNo: bigint
  readonly amount: Money
}

/**
 * Opens a payment of the order in the journal at today's price (MOL-271): the dollar anchor at the CBA's rate
 * fresh for today in Yerevan, rounded up to 10 ֏. Null without such a rate — no price is made up, nor made of
 * another provider's rate (requirement 2; adversarial А3) — and the day is the server's, never the caller's
 * (А5). A tip names one of its amounts; any other is refused.
 */
export async function openPayment(
  deps: {
    readonly payments: PaymentsRepository
    readonly rates: Pick<RateRepository, 'latestOnOrBefore'>
  },
  input: PaymentOrder & {
    readonly actorId: string
    readonly channel: PaymentChannel
    readonly now: Date
  },
): Promise<OpenedPayment | null> {
  const cents = anchorCentsOf(input)
  if (cents === null) throw new DomainError(ERROR.INVALID_AMOUNT, input.tariff)
  const day = yerevanDate(input.now)
  const rows = await deps.rates.latestOnOrBefore([PAYMENT_ANCHOR_CURRENCY], day)
  const cba = rows.filter((row) => row.provider === 'cba')
  const rate = freshOfficialRate(PAYMENT_ANCHOR_CURRENCY, PAYMENT_CURRENCY, cba, day)
  if (rate === null) return null
  const amount = paymentPrice(cents, rate)
  const id = randomUUID()
  const { orderNo } = await deps.payments.create({
    id,
    actorId: input.actorId,
    tariff: input.tariff,
    anchor: { minor: cents, currency: PAYMENT_ANCHOR_CURRENCY },
    rate,
    amount,
    channel: input.channel,
  })
  return { id, orderNo, amount }
}

/**
 * A channel's word written into the journal. «Paid» extends access once, however many times it is said
 * (`markPaid`); a word that came after the payment moved changes nothing; «waiting» changes nothing.
 */
export async function settlePayment(
  deps: { readonly payments: PaymentsRepository },
  id: string,
  word: ChannelWord,
  now: Date,
): Promise<Settled | null> {
  switch (word.said) {
    case 'paid':
      return deps.payments.markPaid(id, word.facts, now)
    case 'declined':
    case 'abandoned':
      return deps.payments.markClosed(id, word.said, now)
    case 'waiting': {
      const payment = await deps.payments.get(id)
      return payment === null ? null : { state: payment.state, moved: false, access: {} }
    }
  }
}

/**
 * The owner gives money back (MOL-277, Р-9): `minor` of it, or all that is left. The channel first — the journal
 * says what the bank did, never what it was asked to do; a failure there leaves the journal as it was. The check
 * before the bank reads without a lock, so a second refund of the same payment between the two is refused by the
 * journal after the bank gave the money: that is no conflict but a defect, said so (review №3) — refunds are one
 * command of the owner, one at a time.
 */
export async function refundPayment(
  deps: { readonly payments: PaymentsRepository; readonly channel: PaymentChannelAdapter },
  id: string,
  minor: bigint | undefined,
  now: Date,
): Promise<Settled> {
  const payment = await deps.payments.get(id)
  if (payment === null) throw new DomainError(ERROR.NOT_FOUND, id)
  const sum = refundSum({ ...payment, amountMinor: payment.amount.minor }, minor)
  await deps.channel.refund(payment, sum)
  const settled = await deps.payments.refund(id, sum, now).catch((error: unknown) => {
    throw new Error(`the bank refunded ${String(sum)} of ${id}, the journal did not record it`, {
      cause: error,
    })
  })
  if (settled === null) {
    throw new Error(`the bank refunded ${String(sum)} of ${id}, the journal has no such payment`)
  }
  return settled
}
