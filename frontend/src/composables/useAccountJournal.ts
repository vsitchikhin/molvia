import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { AccountJournalResponse } from '@molvia/model'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'
import { recallJournal, rememberJournal, useAccountsStore } from '@/stores/accounts'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'
import { reportFailure } from '@/failures'

/** `missing` — another's, deleted or never there: one 404 for all three (MOL-115, п. 1). */
export type JournalPhase = 'idle' | 'loading' | 'ready' | 'missing' | 'error' | 'offline'

export interface AccountJournal {
  readonly phase: ComputedRef<JournalPhase>
  readonly journal: ComputedRef<AccountJournalResponse | null>
  /** The journal on screen is the phone's memory: offline, or the server not answered yet. */
  readonly stale: ComputedRef<'loading' | 'offline' | 'error' | null>
  readonly more: ComputedRef<'idle' | 'loading' | 'failed'>
  readonly loadMore: () => Promise<void>
  readonly retry: () => Promise<void>
}

/**
 * One account and its journal as this phone sees it (MOL-123, handoff 04): the server's first page
 * and the pages after it by the key of the last row, and the first page last read, for offline.
 * Read again from the start whenever a queue has had an answer — a spending or a trip that landed
 * may be on this account — keeping as many pages as were open, as the month does (MOL-82).
 */
export function useAccountJournal(accountId: Ref<string>): AccountJournal {
  const actor = useActorStore()
  const accounts = useAccountsStore()
  const spendings = useSpendingQueueStore()
  const trips = useTripQueueStore()

  const shown = ref<AccountJournalResponse | null>(null)
  const failure = ref<'offline' | 'error' | 'missing' | null>(null)
  const confirmed = ref(false)
  const more = ref<'idle' | 'loading' | 'failed'>('idle')
  let pages = 1
  let latest = 0

  function adopt(): void {
    const owner = actor.id
    shown.value = owner ? recallJournal(owner, accountId.value) : null
    failure.value = null
    confirmed.value = false
    more.value = 'idle'
    pages = 1
  }

  async function load(): Promise<void> {
    const owner = actor.id
    const id = accountId.value
    if (!owner) return
    const mine = ++latest
    try {
      const first = await api.accountJournal(id)
      // Kept only when it is the newest answer: a late one must not overwrite a fresher memory.
      if (actor.id === owner && mine === latest) rememberJournal(owner, first)
      let answer = first
      // As many pages as are open when the pages come — a next page that landed during this read
      // counts, or it vanished from under the finger (review 28).
      for (let page = 1; page < pages && answer.cursor; page++) {
        const next = await api.accountJournal(id, answer.cursor)
        answer = { ...next, rows: [...answer.rows, ...next.rows] }
      }
      if (actor.id !== owner || accountId.value !== id || mine !== latest) return
      shown.value = answer
      failure.value = null
      confirmed.value = true
      more.value = 'idle'
    } catch (caught) {
      reportFailure(caught, 'screen')
      if (actor.id !== owner || accountId.value !== id || mine !== latest) return
      if (caught instanceof ApiError && caught.code === ERROR.NOT_FOUND && caught.answered) {
        shown.value = null
        failure.value = 'missing'
        return
      }
      // Decided after the failure, never before the request (MOL-19, A1).
      failure.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  async function loadMore(): Promise<void> {
    const current = shown.value
    if (!current?.cursor || more.value === 'loading') return
    const id = accountId.value
    const mine = latest
    more.value = 'loading'
    try {
      const next = await api.accountJournal(id, current.cursor)
      // A read from the start landed meanwhile: this page continues an answer no longer on screen.
      if (mine !== latest || shown.value !== current || accountId.value !== id) {
        more.value = 'idle'
        return
      }
      shown.value = { ...next, rows: [...current.rows, ...next.rows] }
      pages += 1
      more.value = 'idle'
    } catch {
      if (mine === latest && shown.value === current) more.value = 'failed'
    }
  }

  adopt()
  watch([() => actor.id, accountId], () => {
    latest += 1
    adopt()
    void load()
  })
  watch(
    () => [spendings.landed, trips.wrote],
    () => void load(),
  )
  // A write of the account itself answers with the page, not the journal: its start may have moved.
  watch(
    () => accounts.accounts.find(({ id }) => id === accountId.value)?.revision,
    (revision, before) => {
      if (revision !== undefined && before !== undefined && revision !== before) void load()
    },
  )
  onMounted(() => void load())
  useReconnect(() => void load())

  const phase = computed<JournalPhase>(() => {
    if (!actor.id) return 'idle'
    if (failure.value === 'missing') return 'missing'
    if (shown.value) return 'ready'
    return failure.value ?? 'loading'
  })

  return {
    phase,
    journal: computed(() => shown.value),
    stale: computed(() => {
      if (!shown.value || confirmed.value) return null
      return failure.value === 'missing' ? null : (failure.value ?? 'loading')
    }),
    more: computed(() => more.value),
    loadMore,
    retry: load,
  }
}
