import { onUnmounted, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { drawsNothing } from '@molvia/model'
import type { CatalogueEntry } from '@molvia/model'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'

/**
 * `idle` — nothing typed, the screen shows the recent items and nothing is asked. `loading` —
 * the first answer is on its way and there is none to show meanwhile. `ready` and `empty` — the
 * last answer, with rows or without. `error` and `offline` — the last search failed, told apart
 * by the connection rather than by the code: a dropped connection and a 500 arrive as the same
 * error from the client.
 */
export type SearchPhase = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'offline'

/** The pause in typing that sends a search (handoff `02`). */
export const SEARCH_DEBOUNCE_MS = 250

// Asked afresh each time, never narrowed: the answer before the request says nothing about
// the connection by the time the request has failed.
function connected(): boolean {
  return navigator.onLine
}

export interface CatalogueSearch {
  readonly phase: Ref<SearchPhase>
  readonly results: Ref<CatalogueEntry[]>
  /** An answer is on screen and a newer search is out. */
  readonly stale: Ref<boolean>
  /** The query the answer on screen belongs to — «Не нашли „{query}“» names that one. */
  readonly answered: Ref<string>
  readonly retry: () => void
}

/**
 * The catalogue search behind «Что взяли?», as the screen types it.
 *
 * One search per pause, and only the latest one counts: a new pause aborts the search still on
 * its way, and an answer that arrives anyway — the abort lost the race — is dropped by its
 * number, not by its error code. While a search is out the previous answer stays on screen,
 * marked `stale`: a list that blinks empty between keystrokes is worse than an old one.
 *
 * An empty field sends nothing. The server would answer `[]` and still record a visit in the
 * log the 0.3 gate reads, so an untouched field would count as someone coming back.
 */
export function useCatalogueSearch(query: Ref<string>): CatalogueSearch {
  const phase = ref<SearchPhase>('idle')
  const results = shallowRef<CatalogueEntry[]>([])
  const stale = ref(false)
  const answered = ref('')

  let latest = 0
  let pending: ReturnType<typeof setTimeout> | undefined
  let inFlight: AbortController | undefined

  function cancel(): void {
    clearTimeout(pending)
    pending = undefined
    inFlight?.abort()
    inFlight = undefined
  }

  async function run(text: string): Promise<void> {
    cancel()
    const mine = ++latest

    if (!connected()) {
      settleFailed()
      return
    }

    const controller = new AbortController()
    inFlight = controller
    try {
      const found = await api.searchCatalogue(text, { signal: controller.signal })
      if (mine !== latest) return
      results.value = found
      answered.value = text
      phase.value = found.length > 0 ? 'ready' : 'empty'
      // Still dimmed while a newer search waits for its pause.
      stale.value = pending !== undefined
    } catch {
      if (mine !== latest) return
      settleFailed()
    } finally {
      if (inFlight === controller) inFlight = undefined
    }
  }

  function settleFailed(): void {
    results.value = []
    stale.value = false
    phase.value = connected() ? 'error' : 'offline'
  }

  function schedule(text: string): void {
    // The search still out is not cancelled at the keystroke, only at the next pause (`run`):
    // on a slow network at a shelf every letter would otherwise cut the search the pause before it
    // sent, and nothing would show until the typing stopped — though «мол» already finds the milk
    // (Р-13). Its answer, when it lands in the pause, is shown but stays dimmed: it answers the
    // text before (A2), and a pick from it leaves with that text (`answered`).
    clearTimeout(pending)
    if (phase.value === 'ready' || phase.value === 'empty') stale.value = true
    else phase.value = 'loading'
    pending = setTimeout(() => {
      pending = undefined
      void run(text)
    }, SEARCH_DEBOUNCE_MS)
  }

  watch(query, (text) => {
    // By what draws, not by `trim`: a pasted U+200B looks empty and would still count as a visit.
    if (drawsNothing(text)) {
      // Counted too, so an answer to the text just erased cannot land on the empty field.
      latest += 1
      cancel()
      phase.value = 'idle'
      results.value = []
      stale.value = false
      answered.value = ''
      return
    }
    // Offline there is nothing to wait for: the pause would only blink the skeleton over the
    // recent items, which are what the screen searches meanwhile.
    if (!connected()) {
      latest += 1
      cancel()
      settleFailed()
      return
    }
    schedule(text)
  })

  /** «Повторить» — at once, without the pause, and the skeleton says it is trying. */
  function retry(): void {
    if (drawsNothing(query.value)) return
    if (phase.value === 'error' || phase.value === 'offline') phase.value = 'loading'
    void run(query.value)
  }

  // The connection may be back, or the app is looked at again — which happens every time the
  // phone is unlocked at a shelf. Quietly: what is on screen stays until an answer replaces it,
  // so the recent items taken under an error are not pulled from under the finger (A8).
  useReconnect(() => {
    if (drawsNothing(query.value)) return
    if (phase.value === 'error' || phase.value === 'offline') void run(query.value)
  })

  onUnmounted(() => {
    latest += 1
    cancel()
  })

  return { phase, results, stale, answered, retry }
}
