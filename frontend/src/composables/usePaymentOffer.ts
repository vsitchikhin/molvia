import { computed, onMounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { ApiError } from '@molvia/client'
import type { PaymentLang, PaymentOffer, StartPayment } from '@molvia/model'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'
import { reportFailure } from '@/failures'

/** `unpriced` — the CBA has published no rate fresh for today: no price, in words, not an error (Р-1). */
export type PaymentOfferPhase = 'loading' | 'ready' | 'unpriced' | 'error' | 'offline'

/** Why a payment did not start, by the server's word or the connection: what the screen says under the button. */
export type StartRefusal = 'day_limited' | 'unpriced' | 'bank' | 'offline' | 'error'

/** What the person chose to pay for: a tariff, or a tip of its cents — the start's body less the page's language. */
export type PaymentChoice =
  | { readonly tariff: 'data' | 'receipts' | 'both' }
  | { readonly tariff: 'tip'; readonly tipCents: number }

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

const REFUSALS: Readonly<Record<string, StartRefusal>> = {
  'error.payments_day_limited': 'day_limited',
  'error.payment_unpriced': 'unpriced',
  'error.payment_channel_unavailable': 'bank',
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
      if (starting.value !== null) return false
      starting.value = order.tariff === 'tip' ? String(order.tipCents) : order.tariff
      refused.value = null
      try {
        const body: StartPayment = { ...order, lang }
        const started = await api.startPayment(body)
        go(started.url)
        return true
      } catch (error) {
        const said = error instanceof ApiError && error.answered ? REFUSALS[error.code] : undefined
        if (said === undefined) reportFailure(error, 'screen')
        refused.value = said ?? (navigator.onLine ? 'error' : 'offline')
        // Unpriced since the screen was drawn: the offer is read again, and the screen says it in its place.
        if (said === 'unpriced') void load()
        starting.value = null
        return false
      }
    },
  }
}
