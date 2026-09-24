import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { ExchangeBody, ExchangesResponse, RatePreference } from '@molvia/model'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'

/** `idle` — no identity yet, so there is nobody whose exchanges to ask for. */
export type ExchangesPhase = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'offline'

export interface Exchanges {
  readonly phase: ComputedRef<ExchangesPhase>
  readonly overview: Ref<ExchangesResponse | null>
  /** A write in the air: the preference, a removal. The form of the sheet keeps its own. */
  readonly busy: Ref<boolean>
  /** A write that failed — said once, above the list, and cleared by the next one. */
  readonly failed: Ref<boolean>
  retry(): Promise<void>
  record(body: ExchangeBody): Promise<ExchangesResponse>
  prefer(preference: RatePreference): Promise<void>
  remove(id: string): Promise<void>
}

/**
 * «Обмен денег» as this phone sees it (MOL-40): the server's answer and nothing worked out here —
 * the wallet, the rate of each exchange and its difference from the central bank are all the
 * server's (CLAUDE.md, «No business logic on the frontend»).
 *
 * Every write answers with the screen whole, and that answer replaces whatever a read still in
 * the air would bring: each request carries a number, and only the newest may land.
 *
 * Nothing is kept on the phone. Saving needs the connection anyway (plan, Р-3), and without one
 * the screen says so rather than showing numbers of unknown age.
 */
export function useExchanges(): Exchanges {
  const actor = useActorStore()
  const overview = ref<ExchangesResponse | null>(null)
  const failure = ref<'offline' | 'error' | null>(null)
  const busy = ref(false)
  const failed = ref(false)
  let latest = 0

  function land(answer: ExchangesResponse): void {
    latest += 1
    overview.value = answer
    failure.value = null
  }

  async function load(): Promise<void> {
    if (!actor.id) return
    const mine = ++latest
    try {
      const answer = await api.exchanges()
      if (mine !== latest) return
      overview.value = answer
      failure.value = null
    } catch {
      if (mine !== latest) return
      // Decided after the failure, never before the request: a connection that drops while the
      // answer is on its way is the commonest break of all (MOL-19, A1).
      failure.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  const phase = computed<ExchangesPhase>(() => {
    if (!actor.id) return 'idle'
    if (overview.value) return overview.value.exchanges.length > 0 ? 'ready' : 'empty'
    return failure.value ?? 'loading'
  })

  async function write(run: () => Promise<ExchangesResponse>): Promise<void> {
    if (busy.value) return
    busy.value = true
    failed.value = false
    try {
      land(await run())
    } catch {
      failed.value = true
    } finally {
      busy.value = false
    }
  }

  onMounted(() => void load())
  watch(
    () => actor.id,
    () => {
      overview.value = null
      failure.value = null
      void load()
    },
  )
  // Back online, or back into view: a screen that failed tries again by itself.
  useReconnect(() => {
    if (failure.value) void load()
  })

  return {
    phase,
    overview,
    busy,
    failed,
    retry: load,
    async record(body) {
      const { exchanges } = await api.recordExchange(body)
      land(exchanges)
      return exchanges
    },
    prefer: (preference) => write(() => api.chooseRatePreference(preference)),
    remove: (id) => write(() => api.removeExchange(id)),
  }
}
