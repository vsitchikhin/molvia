import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { ExchangeBody, ExchangeView, ExchangesResponse, RatePreference } from '@molvia/model'
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
  /**
   * The exchange just removed, offered back by «Вернуть» (В-5) — until any other request of the
   * screen, which makes it final on the server, or until the screen is left.
   */
  readonly removed: Ref<ExchangeView | null>
  /**
   * The last «Сохранить» named an exchange already written with other amounts (В-6): the list
   * shows what is there, and the screen says to remove it and enter it again.
   */
  readonly conflicted: Ref<boolean>
  retry(): Promise<void>
  /** Resolves `null` when the server holds another exchange under this name (В-6). */
  record(body: ExchangeBody): Promise<ExchangesResponse | null>
  prefer(preference: RatePreference): Promise<void>
  remove(exchange: ExchangeView): Promise<void>
  restore(): Promise<void>
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
  const removed = ref<ExchangeView | null>(null)
  const conflicted = ref(false)
  let latest = 0

  const current = (): ExchangesResponse | null => overview.value

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

  async function write(run: () => Promise<ExchangesResponse>): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    failed.value = false
    conflicted.value = false
    try {
      land(await run())
      return true
    } catch {
      failed.value = true
      return false
    } finally {
      busy.value = false
    }
  }

  onMounted(() => void load())
  watch(
    () => actor.id,
    () => {
      // Everything of the last owner goes with them — «Вернуть» with their amounts would write
      // them into the next account (round 2, Г1).
      overview.value = null
      failure.value = null
      failed.value = false
      conflicted.value = false
      removed.value = null
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
    removed,
    conflicted,
    retry: load,
    async record(body) {
      conflicted.value = false
      failed.value = false
      removed.value = null
      try {
        const { exchanges } = await api.recordExchange(body)
        land(exchanges)
        return exchanges
      } catch (caught) {
        // Another exchange under this name — the first «Сохранить» landed with the amounts it had,
        // and its answer was lost. Not a failure of this form: the list is read again to show what
        // is there, and the screen says what to do about it (В-6).
        if (caught instanceof ApiError && caught.code === ERROR.CONFLICT && caught.answered) {
          conflicted.value = true
          await load()
          return null
        }
        throw caught
      }
    },
    // Shown at once, and taken back if the server refuses: the radio the browser already checked
    // has to follow the answer, or a screen reader reads out a choice the server does not hold
    // (review С-2, adversarial Б3).
    async prefer(preference) {
      const shown = overview.value
      if (!shown || busy.value || shown.preference === preference) return
      overview.value = { ...shown, preference }
      // Any other request makes a removed exchange final on the server: nothing to offer back.
      removed.value = null
      await write(() => api.chooseRatePreference(preference))
      // Read again after the wait: the owner may have changed meanwhile and taken the list away.
      const after = current()
      if (failed.value && after?.preference === preference) {
        overview.value = { ...after, preference: shown.preference }
      }
    },
    async remove(exchange) {
      removed.value = null
      if (await write(() => api.removeExchange(exchange.id))) removed.value = exchange
    },
    // The same row back, marked no longer removed: written anew it would take the moment of the
    // tap and move the order of its day and the hint (round 2, В1, В2). Final already — another
    // request of the screen came first — and there is nothing left to offer.
    async restore() {
      const exchange = removed.value
      if (!exchange || busy.value) return
      busy.value = true
      failed.value = false
      try {
        land(await api.restoreExchange(exchange.id))
        removed.value = null
      } catch (caught) {
        failed.value = true
        if (caught instanceof ApiError && caught.code === ERROR.NOT_FOUND && caught.answered) {
          removed.value = null
        }
      } finally {
        busy.value = false
      }
    },
  }
}
