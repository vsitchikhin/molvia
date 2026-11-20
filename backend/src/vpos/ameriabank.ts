import { wholeMajor } from '@molvia/model'
import type { Money } from '@molvia/model'
import type { PaymentRow } from '@/db/payments-repository'
import type { ChannelWord, PaymentChannelAdapter } from '@/usecases/payments'
import { VposError } from './client'
import type { VposClient, VposDetails, VposStand } from './client'

/** The test stand takes 10 ֏ and nothing else (code 560, MOL-281 §6): every tariff is 10 ֏ there. */
export const VPOS_TEST_DRAMS = 10n

/** `CancelPayment` gives the whole sum back within 72 hours of the order's registration (MOL-281 §1, Р-9). */
export const VPOS_CANCEL_WITHIN_MS = 72 * 60 * 60 * 1000

/** The bank's code of the dram (ISO 4217, digits). */
const DRAM = '051'

/** The bank's states of an order (table 2 of the manual): `2` is paid. */
const PAID = '2'
const DECLINED = new Set(['3', '6'])

/**
 * Something the bank said that the journal does not act on and the owner should hear of (Р-2): a `5` — whether it is
 * a payment in a one-step flow only the bank knows; «paid» with another order, sum or currency than ours; refunded
 * an order we never refunded.
 */
export type VposStrange = 'status_5' | 'paid_mismatch' | 'refunded_unknown'

export class VposStrangeAnswer extends Error {
  override readonly name = 'VposStrangeAnswer'
  readonly code: string
  constructor(readonly strange: VposStrange) {
    super(`ameriabank: ${strange}`)
    this.code = `VPOS_${strange.toUpperCase()}`
  }
}

/** The bank writes an empty string for a number it has not: none. */
function blankless(value: string | null): string | null {
  return value === '' ? null : value
}

/**
 * Whole drams for the bank, or a refusal before it (review №7): the bank takes the major unit and refused a fraction
 * on its stand (MOL-281 §1). Counted in `bigint`, never a float.
 */
export function drams(money: Money, method: string): bigint {
  const whole = wholeMajor(money)
  if (whole === null) throw new VposError('refused', method, 'not_whole_drams')
  return whole
}

/** What is charged for a payment, in whole drams: its amount, or 10 ֏ on the test stand. */
export function chargedDrams(payment: Pick<PaymentRow, 'amount'>, stand: VposStand): bigint {
  return stand === 'test' ? VPOS_TEST_DRAMS : drams(payment.amount, 'InitPayment')
}

/**
 * The bank's answer judged (requirement 4, MOL-281 §2 step 6): paid only by the bank's `00` and state `2` for our
 * own order, in drams, for exactly the sum asked — never by what the return address carried. A page closed with
 * nothing tried, its time out, a state in between: waiting, for the reconciliation to decide.
 */
export function judged(
  details: VposDetails | null,
  expected: { readonly orderNo: bigint; readonly drams: bigint },
): { readonly word: ChannelWord; readonly strange: VposStrange | null } {
  const waiting = { said: 'waiting' } as const
  if (details === null) return { word: waiting, strange: null }
  switch (details.orderStatus) {
    case PAID: {
      const ours =
        details.responseCode === '00' &&
        details.orderId === String(expected.orderNo) &&
        details.currency === DRAM &&
        details.approvedAmount === Number(expected.drams)
      if (!ours) return { word: waiting, strange: 'paid_mismatch' }
      return {
        word: {
          said: 'paid',
          facts: { rrn: blankless(details.rrn), approvalCode: blankless(details.approvalCode) },
        },
        strange: null,
      }
    }
    case '5':
      return { word: waiting, strange: 'status_5' }
    case '4':
      return { word: waiting, strange: 'refunded_unknown' }
    default:
      if (details.orderStatus !== null && DECLINED.has(details.orderStatus)) {
        return { word: { said: 'declined' }, strange: null }
      }
      return { word: waiting, strange: null }
  }
}

/** Latin and nothing of the person (MOL-281 §8): an Armenian description came back as `¿`. */
export function vposDescription(tariff: PaymentRow['tariff']): string {
  return tariff === 'tip' ? 'Molvia, tip' : `Molvia, 30 days, ${tariff}`
}

export interface AmeriabankOptions {
  readonly client: VposClient
  readonly stand: VposStand
  /** The PWA's origin: the bank sends the browser back to its `/pay/done/<payment>` (requirement 5). */
  readonly appBaseUrl: string
  /** Hears what the journal does not act on; never throws. */
  readonly strange: (error: VposStrangeAnswer) => void
  readonly now?: () => number
}

/** Ameriabank as a channel of the journal (MOL-277): the page, the bank's word judged, the money given back. */
export function ameriabankChannel(options: AmeriabankOptions): PaymentChannelAdapter {
  const { client, stand } = options
  const now = options.now ?? Date.now

  async function refOf(payment: PaymentRow): Promise<string | null> {
    return payment.channelRef ?? (await client.paymentId(payment.orderNo))
  }

  return {
    channel: 'ameriabank',

    async start(payment, lang) {
      const request = {
        orderId: payment.orderNo,
        amount: chargedDrams(payment, stand),
        description: vposDescription(payment.tariff),
        backUrl: `${options.appBaseUrl}/pay/done/${payment.id}`,
      }
      // A number the bank knows already is never ours to register (adversarial А2): a database restored from its copy
      // gives numbers out again, and two databases on one stand share them — and a repeat of `InitPayment` with an
      // order the bank has answers that order's id, paid or not.
      if ((await client.paymentId(payment.orderNo)) !== null) {
        throw new VposError('refused', 'InitPayment', 'order_number_taken')
      }
      let id: string
      try {
        id = await client.initPayment(request)
      } catch (error) {
        if (!(error instanceof VposError) || error.kind !== 'unreachable') throw error
        // the answer lost, the order may be registered: asked by our number, else the same body again (MOL-281 §4)
        id = (await client.paymentId(payment.orderNo)) ?? (await client.initPayment(request))
      }
      return { ref: id, url: client.pageUrl(id, lang) }
    },

    async check(payment) {
      const ref = await refOf(payment)
      if (ref === null) return { said: 'waiting' }
      const { word, strange } = judged(await client.paymentDetails(ref), {
        orderNo: payment.orderNo,
        drams: chargedDrams(payment, stand),
      })
      if (strange !== null) options.strange(new VposStrangeAnswer(strange))
      return word
    },

    async refund(payment, minor) {
      const ref = await refOf(payment)
      if (ref === null) throw new VposError('refused', 'RefundPayment', 'no_payment_id')
      // nothing given back before and all of it now: what `CancelPayment` takes, within its 72 hours (review №13)
      const untouched = payment.refundedMinor === 0n && minor === payment.amount.minor
      if (untouched && now() - payment.createdAt.getTime() < VPOS_CANCEL_WITHIN_MS) {
        await client.cancel(ref)
        return
      }
      if (stand === 'test') {
        // the stand charged 10 ֏ for any tariff: only that whole sum is a sum it holds
        if (!untouched) throw new VposError('refused', 'RefundPayment', 'test_stand_partial')
        await client.refund(ref, VPOS_TEST_DRAMS)
        return
      }
      await client.refund(ref, drams({ ...payment.amount, minor }, 'RefundPayment'))
    },
  }
}
