import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { PaymentStatus } from '@molvia/model'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'
import { reportFailure } from '@/failures'
import { useActorStore } from '@/stores/actor'

/**
 * Back from the bank's page, a payment the bank has not said of yet is asked again this often, this many times — a
 * minute; the server's own minute asks it after that (requirement 6).
 */
export const PAY_DONE_ASK_MS = 5_000
export const PAY_DONE_ASKS = 12

export type PaymentStatusPhase =
  'loading' | 'paid' | 'failed' | 'waiting' | 'error' | 'offline' | 'missing'

export interface PaymentStatusState {
  readonly status: Ref<PaymentStatus | null>
  readonly phase: ComputedRef<PaymentStatusPhase>
  readonly ask: () => Promise<void>
}

/**
 * The payment the bank sent the browser back for (MOL-277, requirement 5): the server's word on it, asked every
 * `PAY_DONE_ASK_MS` while it is «created», `PAY_DONE_ASKS` times, and again from the start when the app comes back.
 * Never the address the bank came back with — only the server's, which it takes from the bank by its own saved id.
 */
export function usePaymentStatus(id: ComputedRef<string | null>): PaymentStatusState {
  const actor = useActorStore()
  const status = ref<PaymentStatus | null>(null)
  const failure = ref<'error' | 'offline' | 'missing' | null>(null)
  let asks = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let latest = 0

  async function ask(): Promise<void> {
    clearTimeout(timer)
    if (!actor.id) return
    const payment = id.value
    if (payment === null) {
      failure.value = 'missing'
      return
    }
    const mine = ++latest
    try {
      const answer = await api.paymentStatus(payment)
      if (mine !== latest) return
      status.value = answer
      failure.value = null
      asks += 1
      if (answer.state === 'created' && asks < PAY_DONE_ASKS) {
        timer = setTimeout(() => void ask(), PAY_DONE_ASK_MS)
      }
    } catch (error) {
      if (mine !== latest) return
      if (error instanceof ApiError && error.answered && error.code === ERROR.NOT_FOUND) {
        failure.value = 'missing'
        return
      }
      reportFailure(error, 'screen')
      // Decided after the failure, never before the request (MOL-19, A1).
      failure.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  onMounted(() => void ask())
  onUnmounted(() => {
    clearTimeout(timer)
  })
  useReconnect(() => {
    if (status.value === null || status.value.state === 'created') {
      asks = 0
      void ask()
    }
  })

  const phase = computed<PaymentStatusPhase>(() => {
    const state = status.value?.state
    if (state === 'paid' || state === 'refunded') return 'paid'
    if (state === 'declined' || state === 'abandoned') return 'failed'
    if (state === 'created') return 'waiting'
    return failure.value ?? 'loading'
  })

  return { status, phase, ask }
}
