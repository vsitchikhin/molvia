import { randomUUID } from 'node:crypto'
import {
  DomainError,
  ERROR,
  PAYMENTS_DAY_MAX,
  PAYMENT_ANCHOR_CURRENCY,
  PAYMENT_CURRENCY,
  PAYMENT_TARIFFS,
  TIP_CENTS,
  accessOf,
  anchorCentsOf,
  extendedUntil,
  paymentPrice,
  refundSum,
  yerevanDate,
} from '@molvia/model'
import type {
  ExchangeRate,
  Money,
  PaidAccessView,
  PaymentChannel,
  PaymentLang,
  PaymentOffer,
  PaymentOrder,
  PaymentStatus,
  PaymentTariff,
} from '@molvia/model'
import type { RateRepository } from '@/db/rates-repository'
import type {
  PaidFacts,
  PaidUntil,
  PaymentRow,
  PaymentsRepository,
  Settled,
} from '@/db/payments-repository'
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

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The CBA's dollar fresh for today in Yerevan — the one rate a price is made at; null while the CBA is silent, never
 * another provider's (requirement 2; adversarial А3), and the day is the server's, never the caller's (А5).
 */
async function rateOfToday(
  rates: Pick<RateRepository, 'latestOnOrBefore'>,
  now: Date,
): Promise<ExchangeRate | null> {
  const day = yerevanDate(now)
  const rows = await rates.latestOnOrBefore([PAYMENT_ANCHOR_CURRENCY], day)
  const cba = rows.filter((row) => row.provider === 'cba')
  return freshOfficialRate(PAYMENT_ANCHOR_CURRENCY, PAYMENT_CURRENCY, cba, day)
}

/**
 * Opens a payment of the order in the journal at today's price (MOL-271): the dollar anchor at the CBA's rate
 * fresh for today in Yerevan, rounded up to 10 ֏. Null without such a rate — no price is made up. A tip names one
 * of its amounts; any other is refused. At most `PAYMENTS_DAY_MAX` a person's rolling day (MOL-277, Р-12).
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
  const rate = await rateOfToday(deps.rates, input.now)
  if (rate === null) return null
  const amount = paymentPrice(cents, rate)
  const id = randomUUID()
  const created = await deps.payments.createWithin(
    {
      id,
      actorId: input.actorId,
      tariff: input.tariff,
      anchor: { minor: cents, currency: PAYMENT_ANCHOR_CURRENCY },
      rate,
      amount,
      channel: input.channel,
    },
    PAYMENTS_DAY_MAX,
    new Date(input.now.getTime() - DAY_MS),
  )
  if (created === null) throw new DomainError(ERROR.PAYMENTS_DAY_LIMITED, input.actorId)
  return { id, orderNo: created.orderNo, amount }
}

function viewOf(access: PaidUntil): PaidAccessView {
  return { shared: access.sharedUntil, receipts: access.receiptsModelUntil }
}

/** Where a tariff paid now would leave the access: each term it opens thirty days on (MOL-271). */
function after(access: PaidUntil, tariff: PaymentTariff, now: Date): PaidAccessView {
  const opens = accessOf(tariff)
  return {
    shared: opens.includes('shared') ? extendedUntil(access.sharedUntil, now) : access.sharedUntil,
    receipts: opens.includes('receipts')
      ? extendedUntil(access.receiptsModelUntil, now)
      : access.receiptsModelUntil,
  }
}

/**
 * What a person is offered on the screen of payment (MOL-277, requirement 1): the access they have, each tariff's
 * price today with where its terms would end once paid now, and the tips — prices none while the CBA is silent.
 */
export async function offerPayments(
  deps: {
    readonly payments: PaymentsRepository
    readonly rates: Pick<RateRepository, 'latestOnOrBefore'>
  },
  actorId: string,
  now: Date,
): Promise<PaymentOffer> {
  const access = await deps.payments.paidUntil(actorId)
  if (access === null) throw new DomainError(ERROR.NOT_FOUND, actorId)
  const rate = await rateOfToday(deps.rates, now)
  if (rate === null) return { access: viewOf(access), tariffs: null, tips: null }
  return {
    access: viewOf(access),
    tariffs: (['data', 'receipts', 'both'] as const).map((tariff) => {
      const { cents } = PAYMENT_TARIFFS[tariff]
      return {
        tariff,
        cents: Number(cents),
        amount: paymentPrice(cents, rate),
        after: after(access, tariff, now),
      }
    }),
    tips: TIP_CENTS.map((cents) => ({ cents: Number(cents), amount: paymentPrice(cents, rate) })),
  }
}

/**
 * A payment started (MOL-277, requirement 3): written «created» at today's price, then registered with the channel,
 * whose page the person goes to. A channel away or refusing charged nothing: the person hears «try later», the owner
 * the failure (Р-10), and the payment the bank never named is abandoned by the reconciliation.
 */
export async function startPayment(
  deps: {
    readonly payments: PaymentsRepository
    readonly rates: Pick<RateRepository, 'latestOnOrBefore'>
    readonly channel: PaymentChannelAdapter
    readonly failed: (error: unknown) => void
  },
  input: PaymentOrder & {
    readonly actorId: string
    readonly lang: PaymentLang
    readonly now: Date
  },
): Promise<{ readonly id: string; readonly url: string }> {
  const opened = await openPayment(deps, { ...input, channel: deps.channel.channel })
  if (opened === null) throw new DomainError(ERROR.PAYMENT_UNPRICED, input.tariff)
  const payment = await deps.payments.get(opened.id)
  if (payment === null) throw new Error(`payment ${opened.id} written and gone`)
  let started: { readonly ref: string; readonly url: string }
  try {
    started = await deps.channel.start(payment, input.lang)
  } catch (error) {
    deps.failed(error)
    throw new DomainError(ERROR.PAYMENT_CHANNEL_UNAVAILABLE, opened.id)
  }
  await deps.payments.named(opened.id, started.ref)
  return { id: opened.id, url: started.url }
}

/** The bank is asked of one payment at most once in this long, however often its page asks (Р-3). */
export const PAYMENT_ASK_EVERY_MS = 5_000

/**
 * Whether a payment may be asked of the bank now: once in `PAYMENT_ASK_EVERY_MS`. Kept in the API's process — there
 * is one — and a payment let go once its moment is past, so the map holds only the last few seconds' payments.
 */
export function paymentAskLimiter(
  everyMs = PAYMENT_ASK_EVERY_MS,
  now: () => number = Date.now,
): (id: string) => boolean {
  const asked = new Map<string, number>()
  return (id) => {
    const at = now()
    for (const [payment, moment] of asked) if (at - moment >= everyMs) asked.delete(payment)
    if (asked.has(id)) return false
    asked.set(id, at)
    return true
  }
}

/**
 * What became of the person's payment (MOL-277, requirement 5): the page the bank sent the browser back to asks,
 * and a payment still «created» is asked of the bank by its own saved id — never by what the address carried —
 * and its word written as any other's. Someone else's, missing and malformed are one 404. A bank away answers
 * the state as it stands; the minute's reconciliation asks again.
 */
export async function confirmPayment(
  deps: {
    readonly payments: PaymentsRepository
    readonly channel: PaymentChannelAdapter
    readonly mayAsk: (id: string) => boolean
    readonly failed: (error: unknown) => void
  },
  actorId: string,
  id: string,
  now: Date,
): Promise<PaymentStatus> {
  const payment = await deps.payments.get(id)
  if (payment?.actorId !== actorId) throw new DomainError(ERROR.NOT_FOUND, id)
  let state = payment.state
  if (state === 'created' && deps.mayAsk(id)) {
    try {
      const settled = await settlePayment(deps, id, await deps.channel.check(payment), now)
      if (settled !== null) state = settled.state
    } catch (error) {
      deps.failed(error)
    }
  }
  const access = await deps.payments.paidUntil(actorId)
  if (access === null) throw new DomainError(ERROR.NOT_FOUND, id)
  return { state, tariff: payment.tariff, amount: payment.amount, access: viewOf(access) }
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
