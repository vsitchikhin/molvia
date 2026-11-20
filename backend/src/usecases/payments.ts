import { randomUUID } from 'node:crypto'
import {
  DomainError,
  ERROR,
  PAYMENT_ANCHOR_CURRENCY,
  PAYMENT_CURRENCY,
  anchorCentsOf,
  paymentPrice,
} from '@molvia/model'
import type { Money, PaymentChannel, PaymentTariff } from '@molvia/model'
import type { RateRepository } from '@/db/rates-repository'
import type { PaidFacts, PaymentRow, PaymentsRepository, Settled } from '@/db/payments-repository'
import { freshOfficialRate } from './exchanges'

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
  start(payment: PaymentRow): Promise<{ readonly ref: string; readonly url: string }>
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
 * Opens a payment of `tariff` in the journal at today's price (MOL-271): the dollar anchor at the official rate
 * fresh for `day`, rounded up to 10 ֏. Null without such a rate — no price is made up. A tip names one of its
 * amounts; any other is refused.
 */
export async function openPayment(
  deps: {
    readonly payments: PaymentsRepository
    readonly rates: Pick<RateRepository, 'latestOnOrBefore'>
  },
  input: {
    readonly actorId: string
    readonly tariff: PaymentTariff
    readonly tipCents?: bigint
    readonly channel: PaymentChannel
    readonly day: string
  },
): Promise<OpenedPayment | null> {
  const cents = anchorCentsOf(input.tariff, input.tipCents)
  if (cents === null) throw new DomainError(ERROR.INVALID_AMOUNT, String(input.tipCents))
  const rows = await deps.rates.latestOnOrBefore([PAYMENT_ANCHOR_CURRENCY], input.day)
  const rate = freshOfficialRate(PAYMENT_ANCHOR_CURRENCY, PAYMENT_CURRENCY, rows, input.day)
  if (rate === null) return null
  const amount = paymentPrice(cents, rate)
  const id = randomUUID()
  const { orderNo } = await deps.payments.create({
    id,
    actorId: input.actorId,
    tariff: input.tariff,
    anchor: { minor: cents, currency: PAYMENT_ANCHOR_CURRENCY },
    rate,
    rateDay: input.day,
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
 * says what the bank did, never what it was asked to do; a failure there leaves the journal as it was.
 */
export async function refundPayment(
  deps: { readonly payments: PaymentsRepository; readonly channel: PaymentChannelAdapter },
  id: string,
  minor: bigint | undefined,
  now: Date,
): Promise<Settled> {
  const payment = await deps.payments.get(id)
  if (payment === null) throw new DomainError(ERROR.NOT_FOUND, id)
  const left = payment.amount.minor - payment.refundedMinor
  const sum = minor ?? left
  if (payment.state !== 'paid' || sum <= 0n || sum > left) {
    throw new DomainError(ERROR.CONFLICT, `refund ${String(sum)} of ${payment.state}`)
  }
  await deps.channel.refund(payment, sum)
  const settled = await deps.payments.refund(id, sum, now)
  if (settled === null) throw new DomainError(ERROR.NOT_FOUND, id)
  return settled
}
