import { computed, onMounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { Money, PaymentLang, PaymentOffer, StartPayment, WireCode } from '@molvia/model'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'
import { reportFailure } from '@/failures'

/** `unpriced` — the CBA has published no rate fresh for today: no price, in words, not an error (Р-1). */
export type PaymentOfferPhase = 'loading' | 'ready' | 'unpriced' | 'error' | 'offline'

/**
 * Why a payment did not start (review №4): the server's own code, which is its words' key too, or the connection's
 * — what the screen says under the button.
 */
export type StartRefusal = WireCode | 'offline' | 'error'

/** The server's refusals the screen says in their own words; any other is the screen's «error». */
const SAID_REFUSALS: readonly WireCode[] = [
  ERROR.PAYMENTS_DAY_LIMITED,
  ERROR.PAYMENT_UNPRICED,
  ERROR.PAYMENT_CHANNEL_UNAVAILABLE,
  ERROR.PAYMENT_PRICE_CHANGED,
]

/** After these the offer on the screen is no longer today's: it is read again (adversarial А4). */
const STALE_OFFER: readonly WireCode[] = [ERROR.PAYMENT_UNPRICED, ERROR.PAYMENT_PRICE_CHANGED]

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** What the person chose to pay for: a tariff, or a tip of its cents — the start's body less the price and language. */
export type PaymentChoice = Without<StartPayment, 'amount' | 'lang'>

export interface PaymentOfferState {
  readonly phase: ComputedRef<PaymentOfferPhase>
  readonly offer: Ref<PaymentOffer | null>
  /** The payment being started — the tariff, or the tip's cents; its button says so. */
  readonly starting: Ref<string | null>
  readonly refused: Ref<StartRefusal | null>
  retry(): Promise<void>
  /** Starts the payment and opens the bank's page; false where it did not start (`refused` says why). */
  start(order: PaymentChoice, lang: PaymentLang): Promise<boolean>
}

/** The price the screen shows for the choice: the start names it, so the bank is never asked another (А4). */
function shownPrice(offer: PaymentOffer | null, choice: PaymentChoice): Money | undefined {
  return choice.tariff === 'tip'
    ? offer?.tips?.find((tip) => tip.cents === choice.tipCents)?.amount
    : offer?.tariffs?.find((tariff) => tariff.tariff === choice.tariff)?.amount
}

/**
 * The screen of payment (MOL-277): the server's offer and nothing kept — a price is today's, and yesterday's read
 * as today's would be charged otherwise. Every figure is the server's; the phone only chooses and goes to the bank.
 */
export function usePaymentOffer(go: (url: string) => void): PaymentOfferState {
  const offer = ref<PaymentOffer | null>(null)
  const failure = ref<'offline' | 'error' | null>(null)
  const starting = ref<string | null>(null)
  const refused = ref<StartRefusal | null>(null)
  let latest = 0

  async function load(): Promise<void> {
    const mine = ++latest
    try {
      const answer = await api.paymentOffer()
      if (mine !== latest) return
      offer.value = answer
      failure.value = null
    } catch (error) {
      reportFailure(error, 'screen')
      if (mine !== latest) return
      offer.value = null
      // Decided after the failure, never before the request (MOL-19, A1).
      failure.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  const phase = computed<PaymentOfferPhase>(() => {
    if (offer.value) return offer.value.tariffs === null ? 'unpriced' : 'ready'
    return failure.value ?? 'loading'
  })

  onMounted(() => void load())
  // A price is today's: back on the screen after a while, it is asked again (the CBA may have published since).
  useReconnect(() => void load())

  return {
    phase,
    offer,
    starting,
    refused,
    retry: load,
    async start(order, lang) {
      const amount = shownPrice(offer.value, order)
      if (starting.value !== null || amount === undefined) return false
      starting.value = order.tariff === 'tip' ? String(order.tipCents) : order.tariff
      refused.value = null
      try {
        const body: StartPayment = { ...order, amount, lang }
        const started = await api.startPayment(body)
        go(started.url)
        return true
      } catch (error) {
        const said =
          error instanceof ApiError && error.answered && SAID_REFUSALS.includes(error.code)
            ? error.code
            : undefined
        if (said === undefined) reportFailure(error, 'screen')
        refused.value = said ?? (navigator.onLine ? 'error' : 'offline')
        // The price moved or went since the screen was drawn: the offer is read again — the new price on the button,
        // or «no price» in its place — and the refusal says why.
        if (said !== undefined && STALE_OFFER.includes(said)) void load()
        starting.value = null
        return false
      }
    },
  }
}
