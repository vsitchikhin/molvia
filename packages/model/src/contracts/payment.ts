import { z } from 'zod'
import {
  TIP_CENTS,
  bankStateSchema,
  orderNoSchema,
  paidTariffSchema,
  paymentStateSchema,
  paymentTariffSchema,
} from '#model/entities/payment'
import type { PaidTariff, PaymentState, PaymentTariff } from '#model/entities/payment'
import { moneyCodec } from '#model/values/money'
import type { Money } from '#model/values/money'

/**
 * Payment by card (MOL-277), behind the фф `payments`: what a month of each tariff costs today and until when it
 * would open, the start of a payment — the bank's page to go to — and what became of it.
 */

/** The language of the bank's page: the app's own two (Р-5) — Armenian is not one of them yet. */
export const paymentLangSchema = z.enum(['ru', 'en'])
export type PaymentLang = z.infer<typeof paymentLangSchema>

/** At most this many payments a person starts a rolling day (Р-12, MOL-287's rule of a new write path). */
export const PAYMENTS_DAY_MAX = 10

const tipCentsSchema = z
  .number()
  .int()
  .refine((cents) => TIP_CENTS.includes(BigInt(cents)))

/**
 * `POST /payments`: a tariff of thirty days, or a tip of one of its three sums — with the price the screen showed
 * (adversarial А4): the server makes the price again at the tap, and a rate that moved meanwhile refuses rather
 * than charge what the button did not say.
 */
export const startPaymentSchema = z.discriminatedUnion('tariff', [
  z.strictObject({ tariff: paidTariffSchema, amount: moneyCodec, lang: paymentLangSchema }),
  z.strictObject({
    tariff: z.literal('tip'),
    tipCents: tipCentsSchema,
    amount: moneyCodec,
    lang: paymentLangSchema,
  }),
])
export type StartPayment = z.infer<typeof startPaymentSchema>

/**
 * The bank's page of the payment started, and the payment's id. `https`, and `http` only for end-to-end's fake bank on
 * the loopback, the stand `local` the API refuses in production.
 */
export const paymentStartedSchema = z.strictObject({
  id: z.uuid(),
  url: z.url({ protocol: /^https?$/ }),
})
export type PaymentStarted = z.infer<typeof paymentStartedSchema>

/** Until when a person's paid access is open, by its two columns; none — never, or over. */
export interface PaidAccessView {
  readonly shared: Date | null
  readonly receipts: Date | null
}

const isoOrNull = z.iso.datetime().nullable()
const accessWire = z.strictObject({ shared: isoOrNull, receipts: isoOrNull })
const dateOrNull = (value: string | null): Date | null => (value === null ? null : new Date(value))
const isoOf = (value: Date | null): string | null => (value === null ? null : value.toISOString())

export const paidAccessCodec = z.codec(accessWire, z.custom<PaidAccessView>(), {
  decode: (wire) => ({ shared: dateOrNull(wire.shared), receipts: dateOrNull(wire.receipts) }),
  encode: (access) => ({ shared: isoOf(access.shared), receipts: isoOf(access.receipts) }),
})

/** One tariff offered: its price today and where each term it opens would end once paid now. */
export interface TariffOffer {
  readonly tariff: PaidTariff
  readonly cents: number
  readonly amount: Money
  readonly after: PaidAccessView
}

/** What a person is offered: the access they have, and the prices — none without the CBA's rate today. */
export interface PaymentOffer {
  readonly access: PaidAccessView
  readonly tariffs: readonly TariffOffer[] | null
  readonly tips: readonly { readonly cents: number; readonly amount: Money }[] | null
}

const offerWire = z.strictObject({
  access: accessWire,
  tariffs: z
    .array(
      z.strictObject({
        tariff: paidTariffSchema,
        cents: z.number().int().positive(),
        amount: moneyCodec,
        after: accessWire,
      }),
    )
    .max(3)
    .nullable(),
  tips: z
    .array(z.strictObject({ cents: z.number().int().positive(), amount: moneyCodec }))
    .max(TIP_CENTS.length)
    .nullable(),
})

export const paymentOfferCodec = z.codec(offerWire, z.custom<PaymentOffer>(), {
  decode: (wire) => ({
    access: paidAccessCodec.decode(wire.access),
    tariffs:
      wire.tariffs?.map((offer) => ({ ...offer, after: paidAccessCodec.decode(offer.after) })) ??
      null,
    tips: wire.tips,
  }),
  encode: (offer) => ({
    access: paidAccessCodec.encode(offer.access),
    tariffs:
      offer.tariffs?.map((tariff) => ({
        ...tariff,
        after: paidAccessCodec.encode(tariff.after),
      })) ?? null,
    tips: offer.tips?.map((tip) => ({ ...tip })) ?? null,
  }),
})

/** What became of a payment, and where the person's access stands now. */
export interface PaymentStatus {
  readonly state: PaymentState
  readonly tariff: PaymentTariff
  readonly amount: Money
  readonly access: PaidAccessView
}

const statusWire = z.strictObject({
  state: paymentStateSchema,
  tariff: paymentTariffSchema,
  amount: moneyCodec,
  access: accessWire,
})

export const paymentStatusCodec = z.codec(statusWire, z.custom<PaymentStatus>(), {
  decode: (wire) => ({ ...wire, access: paidAccessCodec.decode(wire.access) }),
  encode: (status) => ({
    ...status,
    access: paidAccessCodec.encode(status.access),
  }),
})

/**
 * The bank and the journal disagree about a payment, after the reconciliation settled what it could (MOL-277, В-5
 * «а»): the order's number, the bank's state of it — `none` where the bank lists no such operation — and the
 * journal's — `none` where we have no such order. Nothing of the person: the order finds the rest in the journal.
 */
export const paymentMismatchNoticeSchema = z.strictObject({
  kind: z.literal('payment_mismatch'),
  orderNo: orderNoSchema,
  bank: bankStateSchema,
  journal: z.union([paymentStateSchema, z.literal('none')]),
})
export type PaymentMismatchNotice = z.infer<typeof paymentMismatchNoticeSchema>
