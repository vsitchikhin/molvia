import { onUnmounted, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { drawsNothing, toSearchKey } from '@molvia/model'
import type { AdviceFound, AdviceResponse, AdviceScope } from '@molvia/model'
import { api } from '@/api'
import { SEARCH_DEBOUNCE_MS } from '@/composables/useCatalogueSearch'
import { useReconnect } from '@/composables/useReconnect'

/**
 * `idle` — nothing typed, the list is on screen. `loading` — the first answer is on its way.
 * `ready`, `far` and `empty` — the server's answer: rows, rows none of which is close (MOL-46), none.
 * `memory` — no connection, and the answer is the remembered list searched on the phone (В-3).
 * `error` — the server broke; decided after the failure, as everywhere (MOL-19).
 */
export type AdviceSearchPhase = 'idle' | 'loading' | 'ready' | 'far' | 'empty' | 'memory' | 'error'

export interface AdviceSearch {
  readonly phase: Ref<AdviceSearchPhase>
  readonly found: Ref<AdviceFound[]>
  /** Whose figures the found rows carry — the answer's own, or the remembered list's. */
  readonly scope: Ref<AdviceScope>
  /** An answer is on screen and a newer search is out. */
  readonly stale: Ref<boolean>
  /** The query the answer on screen belongs to — «Не нашли «{query}»» names that one. */
  readonly answered: Ref<string>
  readonly retry: () => void
}

// Asked afresh each time, never narrowed: the answer before the request says nothing about the
// connection by the time the request has failed.
function connected(): boolean {
  return navigator.onLine
}

/**
 * The words of a name as the search key spells them: transliteration and the forks folded by the
 * domain's own `toSearchKey`, so «syr» meets «Сыр» on the phone as it does on the server.
 */
function words(text: string): string[] {
  return toSearchKey(text)
    .split(/\s+/u)
    .filter((word) => word.length > 0)
}

/**
 * The remembered list searched on the phone, with no connection (MOL-128, В-3): every word typed
 * must start a word of the name. Transliteration holds — the key is the domain's — and typos and
 * synonyms do not: they are the server's, and the screen says the search is the list's only.
 * In the list's own order, which is the server's.
 */
export function searchRemembered(rows: AdviceResponse['rows'], text: string): AdviceFound[] {
  const asked = words(text)
  if (asked.length === 0) return []
  return rows
    .filter((row) => {
      const name = words(row.name)
      return asked.every((word) => name.some((part) => part.startsWith(word)))
    })
    .map((row) => ({ itemId: row.itemId, name: row.name, advice: row }))
}

/**
 * The search on «Что брать» (MOL-128), as the field types it: the whole catalogue, each item found
 * with its row of «Что брать» or none — the server's answer (`GET /advice/search`, В-1), never
 * glued to the list here. The rhythm is the catalogue search's (`useCatalogueSearch`): one search
 * per pause, only the latest counts, and the previous answer stays dimmed while the next is out.
 *
 * With no connection it searches `remembered` — the list the phone keeps (`useAdvice`).
 */
export function useAdviceSearch(
  query: Ref<string>,
  remembered: () => AdviceResponse | null,
): AdviceSearch {
  const phase = ref<AdviceSearchPhase>('idle')
  const found = shallowRef<AdviceFound[]>([])
  const scope = ref<AdviceScope>('own')
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

  /** The remembered list, searched: what the phone can say with no connection. */
  function fromMemory(text: string): void {
    const list = remembered()
    found.value = list ? searchRemembered(list.rows, text) : []
    scope.value = list?.scope ?? 'own'
    answered.value = text
    stale.value = false
    phase.value = 'memory'
  }

  async function run(text: string): Promise<void> {
    cancel()
    const mine = ++latest
    if (!connected()) {
      fromMemory(text)
      return
    }
    const controller = new AbortController()
    inFlight = controller
    try {
      const answer = await api.adviceSearch(text, { signal: controller.signal })
      if (mine !== latest) return
      found.value = answer.items
      scope.value = answer.scope
      answered.value = text
      phase.value = answer.items.length === 0 ? 'empty' : answer.near ? 'ready' : 'far'
      stale.value = pending !== undefined
    } catch {
      if (mine !== latest || pending !== undefined) return
      // Decided after the failure: a connection lost mid-answer is not the server's fault.
      if (connected()) {
        found.value = []
        stale.value = false
        phase.value = 'error'
      } else fromMemory(text)
    } finally {
      if (inFlight === controller) inFlight = undefined
    }
  }

  watch(query, (text) => {
    // By what draws, not by `trim`: a pasted U+200B looks empty.
    if (drawsNothing(text)) {
      latest += 1
      cancel()
      phase.value = 'idle'
      found.value = []
      stale.value = false
      answered.value = ''
      return
    }
    // Offline the list on the phone answers at once: there is nothing to wait for.
    if (!connected()) {
      latest += 1
      cancel()
      fromMemory(text)
      return
    }
    clearTimeout(pending)
    if (phase.value === 'idle' || phase.value === 'error') phase.value = 'loading'
    else stale.value = true
    pending = setTimeout(() => {
      pending = undefined
      void run(text)
    }, SEARCH_DEBOUNCE_MS)
  })

  function retry(): void {
    if (drawsNothing(query.value)) return
    phase.value = 'loading'
    void run(query.value)
  }

  // Back online, the phone's answer is replaced by the server's, quietly.
  useReconnect(() => {
    if (drawsNothing(query.value)) return
    if (phase.value === 'memory' || phase.value === 'error') void run(query.value)
  })

  onUnmounted(() => {
    latest += 1
    cancel()
  })

  return { phase, found, scope, stale, answered, retry }
}
