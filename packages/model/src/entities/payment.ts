import { z } from 'zod'
import { minorPerMajor } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import { RATE_SCALE } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'
import { DomainError, ERROR } from '#model/support/errors'

/**
 * What a payment buys (MOL-271, MOL-283): other people's figures (`actors.shared_until`), the reading of
 * receipts by the model (`actors.receipts_model_until`), both, or nothing — a tip.
 */
export const paymentTariffSchema = z.enum(['data', 'receipts', 'both', 'tip'])
export type PaymentTariff = z.infer<typeof paymentTariffSchema>

/** An access a payment extends: a column of `actors`, by its meaning. */
export type PaidAccess = 'shared' | 'receipts'

/**
 * A payment's way: created and waiting for the channel's word; paid; declined by the channel; abandoned —
 * the channel's page outlived with nothing paid; refunded whole. A partial refund leaves it `paid` and grows
 * what was given back (MOL-281 §1: refunds add up).
 */
export const paymentStateSchema = z.enum(['created', 'paid', 'declined', 'abandoned', 'refunded'])
export type PaymentState = z.infer<typeof paymentStateSchema>

/** The channels a payment comes through; each is an adapter of the one journal (MOL-283). */
export const paymentChannelSchema = z.enum(['ameriabank'])
export type PaymentChannel = z.infer<typeof paymentChannelSchema>

/** The anchor is the dollar, the money taken is the dram (Ameriabank's terms §4.10.5, the law on currency). */
export const PAYMENT_ANCHOR_CURRENCY = 'USD' satisfies Currency
export const PAYMENT_CURRENCY = 'AMD' satisfies Currency

/** A price is rounded up to this many drams: «390 ֏», never «383,12 ֏» (MOL-271). */
export const PAYMENT_PRICE_STEP_MAJOR = 10n

/** A tariff's price in cents of the anchor and the access it extends. */
export const PAYMENT_TARIFFS: Readonly<
  Record<
    Exclude<PaymentTariff, 'tip'>,
    { readonly cents: bigint; readonly opens: readonly PaidAccess[] }
  >
> = Object.freeze({
  data: { cents: 100n, opens: ['shared'] },
  receipts: { cents: 200n, opens: ['receipts'] },
  both: { cents: 250n, opens: ['shared', 'receipts'] },
})

/** A tip's amounts in cents (MOL-277, owner's В-4 «а»): it extends nothing. */
export const TIP_CENTS: readonly bigint[] = Object.freeze([100n, 300n, 500n])

/** The anchor in cents a payment of `tariff` names: the tariff's, or a tip's own — one of `TIP_CENTS` or none. */
export function anchorCentsOf(tariff: PaymentTariff, tipCents?: bigint): bigint | null {
  if (tariff !== 'tip') return PAYMENT_TARIFFS[tariff].cents
  return tipCents !== undefined && TIP_CENTS.includes(tipCents) ? tipCents : null
}

/** The access a tariff extends; a tip extends none. */
export function accessOf(tariff: PaymentTariff): readonly PaidAccess[] {
  return tariff === 'tip' ? [] : PAYMENT_TARIFFS[tariff].opens
}

/** A month of access is thirty days (MOL-271), a span of time, not a calendar month. */
export const PAYMENT_TERM_DAYS = 30
const TERM_MS = PAYMENT_TERM_DAYS * 24 * 60 * 60 * 1000

/**
 * A payment row lives this long after its last movement (MOL-283, Р-4): Ameriabank's terms §3.9 keep card
 * records three years; past them nothing is kept without a reason — a living person's payment included.
 */
export const PAYMENT_KEEP_YEARS = 3

/**
 * The price in drams of `cents` dollars at `rate` — drams per dollar, the official rate of the day — rounded
 * up to `PAYMENT_PRICE_STEP_MAJOR`: up, so the dollar named is never less than what the person is asked
 * for. Exact in integers: the rate's six digits and both exponents are carried to the one division.
 */
export function paymentPrice(cents: bigint, rate: ExchangeRate): Money {
  if (rate.base !== PAYMENT_ANCHOR_CURRENCY || rate.quote !== PAYMENT_CURRENCY) {
    throw new DomainError(ERROR.CURRENCY_MISMATCH, `${rate.base}/${rate.quote}`)
  }
  const step = PAYMENT_PRICE_STEP_MAJOR * minorPerMajor(PAYMENT_CURRENCY)
  const numerator = cents * rate.scaled * minorPerMajor(PAYMENT_CURRENCY)
  const denominator = RATE_SCALE * minorPerMajor(PAYMENT_ANCHOR_CURRENCY) * step
  const steps = (numerator + denominator - 1n) / denominator
  return { minor: steps * step, currency: PAYMENT_CURRENCY }
}

/**
 * Where a paid month leaves an access: thirty days on from its end while it runs, from `now` when it is over
 * or was never open (MOL-271: a payment while access runs extends it from its end).
 */
export function extendedUntil(until: Date | null, now: Date): Date {
  const from = until !== null && until > now ? until : now
  return new Date(from.getTime() + TERM_MS)
}

/**
 * Where a whole refund leaves an access (MOL-277, owner's В-2 «а»): the thirty days the payment gave taken
 * back, never earlier than `now` — a later payment's days stay. An access already over is left as it is.
 */
export function refundedUntil(until: Date | null, now: Date): Date | null {
  if (until === null || until <= now) return until
  const back = new Date(until.getTime() - TERM_MS)
  return back > now ? back : now
}
