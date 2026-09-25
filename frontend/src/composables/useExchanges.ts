import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type {
  ExchangeAmendBody,
  ExchangeBody,
  ExchangeView,
  ExchangesResponse,
  RatePreference,
} from '@molvia/model'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'

/** How an amendment ended: written, made over a version that moved on, or the exchange is gone. */
export type AmendOutcome = 'saved' | 'conflict' | 'gone'

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
  /**
   * The last amendment was made over a version another device had already moved on from
   * (MOL-42): the list shows the exchange as it is now, and the screen says so.
   */
  readonly amendConflicted: Ref<boolean>
  /** The exchange being amended is gone — removed elsewhere: the list is read again. */
  readonly vanished: Ref<boolean>
  /** «Вернуть» came after the removal became final: the screen says so instead of «no connection». */
  readonly gone: Ref<boolean>
  /** The last «Вернуть» brought the exchange back — said out loud, the button being gone. */
  readonly restored: Ref<boolean>
  retry(): Promise<void>
  /** Resolves `null` when the server holds another exchange under this name (В-6). */
  record(body: ExchangeBody): Promise<ExchangesResponse | null>
  /** A conflict and a missing exchange are said above the list, and the list is read again. */
  amend(id: string, body: ExchangeAmendBody): Promise<AmendOutcome>
  prefer(preference: RatePreference): Promise<void>
  remove(exchange: ExchangeView): Promise<void>
  restore(): Promise<void>
}

/**
 * Whether the card of the rate has anything to say: an exchange, or a rate — or the reason there is
 * none — that incomes alone made (MOL-66, adversarial Д1). Drams that came in with no exchange are
 * a wallet a trip takes, and «no exchanges, trips take the central bank» above it was untrue, with
 * the switch back to the bank hidden in the card that was not drawn.
 */
function hasOwnMoney(overview: ExchangesResponse): boolean {
  return (
    overview.exchanges.length > 0 ||
    overview.wallet !== null ||
    overview.walletUnknown !== null ||
    overview.costs.length > 0
  )
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
  const amendConflicted = ref(false)
  const vanished = ref(false)
  const gone = ref(false)
  const restored = ref(false)
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
    if (overview.value) return hasOwnMoney(overview.value) ? 'ready' : 'empty'
    return failure.value ?? 'loading'
  })

  /** Every word above the list is about the last write; a new one takes them all away. */
  function hush(): void {
    failed.value = false
    conflicted.value = false
    amendConflicted.value = false
    vanished.value = false
    gone.value = false
    restored.value = false
  }

  async function write(run: () => Promise<ExchangesResponse>): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    hush()
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
      hush()
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
    amendConflicted,
    vanished,
    gone,
    restored,
    retry: load,
    async record(body) {
      hush()
      // The offer to bring a removed exchange back goes when the server made the removal final —
      // with a write that reached it — never on the tap: a write lost on the way, or refused
      // before it got that far (a day ahead of the server's clock), leaves it undoable (round 4, Е1).
      try {
        const { exchanges } = await api.recordExchange(body)
        land(exchanges)
        removed.value = null
        return exchanges
      } catch (caught) {
        // Another exchange under this name — the first «Сохранить» landed with the amounts it had,
        // and its answer was lost. Not a failure of this form: the list is read again to show what
        // is there, and the screen says what to do about it (В-6). This one did reach the point
        // where the server makes removals final.
        if (caught instanceof ApiError && caught.code === ERROR.CONFLICT && caught.answered) {
          removed.value = null
          conflicted.value = true
          await load()
          return null
        }
        throw caught
      }
    },
    // An amendment reaches the point where the server makes removals final on every answer it
    // gives — a success, a conflict, a missing exchange — so each of those takes «Вернуть» away,
    // and a write lost on the way leaves it (as `record` does, round 4, Е1).
    async amend(id, body) {
      hush()
      try {
        land(await api.amendExchange(id, body))
        removed.value = null
        return 'saved'
      } catch (caught) {
        const answered = caught instanceof ApiError && caught.answered
        if (answered && caught.code === ERROR.CONFLICT) {
          removed.value = null
          amendConflicted.value = true
          await load()
          return 'conflict'
        }
        if (answered && caught.code === ERROR.NOT_FOUND) {
          removed.value = null
          vanished.value = true
          await load()
          return 'gone'
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
      // A request that reached the server makes a removed exchange final; one that did not leaves it
      // there to bring back — so the offer goes with the answer, not with the tap (round 3, Д4).
      if (await write(() => api.chooseRatePreference(preference))) removed.value = null
      // Read again after the wait: the owner may have changed meanwhile and taken the list away.
      const after = current()
      if (failed.value && after?.preference === preference) {
        overview.value = { ...after, preference: shown.preference }
      }
    },
    // Only a removal that reached the server replaces the one offered back: one lost on the way
    // leaves the earlier removal undoable, as it still is (round 4, Е2).
    async remove(exchange) {
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
      gone.value = false
      try {
        land(await api.restoreExchange(exchange.id))
        removed.value = null
        restored.value = true
      } catch (caught) {
        // The server's own «nothing to bring back»: it is final — another request, another window.
        // Said as it is and the list read again, so what is on screen is what is there; «check the
        // connection» here sent people to enter the exchange a second time (round 3, Д1).
        if (caught instanceof ApiError && caught.code === ERROR.NOT_FOUND && caught.answered) {
          removed.value = null
          gone.value = true
          await load()
        } else {
          failed.value = true
        }
      } finally {
        busy.value = false
      }
    },
  }
}
