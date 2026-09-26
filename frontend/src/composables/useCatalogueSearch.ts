import { onUnmounted, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { drawsNothing, toSearchKey } from '@molvia/model'
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

/** A query as it was typed, with case and spacing set aside. */
function typed(text: string): string {
  return text.toLocaleLowerCase().trim().replace(/\s+/gu, ' ')
}

export interface CatalogueSearch {
  readonly phase: Ref<SearchPhase>
  readonly results: Ref<CatalogueEntry[]>
  /** An answer is on screen and a newer search is out. */
  readonly stale: Ref<boolean>
  /** The query the answer on screen belongs to — «Не нашли „{query}“» names that one. */
  readonly answered: Ref<string>
  /**
   * The last query the server found nothing for, on this screen (MOL-45). A pick made later by
   * another word takes it along, and the person's word learns the item. Erasing back through it
   * keeps it: «бахч» on the way back from «бахчевые» found nothing too, and is not the word.
   */
  readonly missed: Ref<string | null>
  /**
   * The missed query for a pick found by `text`, or none — and forgotten either way: only the
   * first sheet opened after a miss may carry it (owner's decision on review, MOL-45 И), so a
   * milk looked at and put back does not make the bread taken next the meaning of «кефир».
   * None when one of the two queries starts the other: «сыр» after «сыр косичка» is the same
   * query cut short, not another word for it (review Р-1), and «Кефир» is «кефир » (Е).
   */
  readonly takeMissed: (text: string) => string | null
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
  const missed = ref<string | null>(null)

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
      if (found.length === 0 && !(missed.value !== null && startsHeld(missed.value, text))) {
        missed.value = text
      }
      // Still dimmed while a newer search waits for its pause.
      stale.value = pending !== undefined
    } catch {
      // A failure of a search a newer one is waiting to replace says nothing about that one: the
      // screen keeps what it shows until the newer answers (Р-17).
      if (mine !== latest || pending !== undefined) return
      settleFailed()
    } finally {
      if (inFlight === controller) inFlight = undefined
    }
  }

  /**
   * Whether `text` is the start of `held` — as typed or by the search key, either will do. The
   * key alone folds by position, and «дет» is not the start of `deцkoe`, the key of «детское»
   * (review К); the text alone does not see that «сгущенка» starts «сгущёнка варёная», «кока
   * кола» starts «кока-кола лайт», «moloko» starts «молоко топлёное» (review П).
   */
  function startsHeld(held: string, text: string): boolean {
    return typed(held).startsWith(typed(text)) || toSearchKey(held).startsWith(toSearchKey(text))
  }

  function takeMissed(text: string): string | null {
    const held = missed.value
    missed.value = null
    if (held === null || startsHeld(held, text) || startsHeld(text, held)) return null
    return held
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

  return { phase, results, stale, answered, missed, takeMissed, retry }
}
