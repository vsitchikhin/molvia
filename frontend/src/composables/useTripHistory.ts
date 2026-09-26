import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useTripHistoryStore } from '@/stores/tripHistory'
import { useTripQueueStore } from '@/stores/tripQueue'
import { useActorStore } from '@/stores/actor'
import { useReconnect } from './useReconnect'

/** A row of the history, as both the history and the home screen draw it (MOL-77). */
export interface HistoryRow {
  id: string
  name: string
  at: Date
  pending: boolean
}
interface TripHistoryScreen {
  t: ReturnType<typeof useI18n>['t']
  history: ReturnType<typeof useTripHistoryStore>
  rows: ComputedRef<HistoryRow[]>
  loading: ComputedRef<boolean>
  trouble: Ref<'error' | 'offline' | null>
  load(): void
  more(): void
  open(tripId: string): void
  home(): void
}
/** How many times one load asks, when every answer came back to a list that had moved. */
const ATTEMPTS = 4
/** The pause before the first ask again; each next one is twice as long. */
const RETRY_PAUSE_MS = 400

export function useTripHistory(): TripHistoryScreen {
  const history = useTripHistoryStore()
  const queue = useTripQueueStore()
  const actor = useActorStore()
  const router = useRouter()
  const { t } = useI18n()
  const busy = ref(false)
  /**
   * Loading covers «the owner is not known yet»: the first launch is still making an identity,
   * and «Здесь будут ваши походы» would be a statement about data nobody has asked for. Computed
   * rather than a flag the early return leaves set — that return goes past no `finally` (В-4).
   */
  const loading = computed(() => busy.value || !actor.id)
  const trouble = ref<'error' | 'offline' | null>(null)
  let run = 0
  const rows = computed(() => {
    const rows = new Map(
      history.page.trips.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.place.name,
          at: row.finishedOnDeviceAt ?? row.finishedAt,
          pending: false,
        },
      ]),
    )
    // A cached selection may be older than the first page. Offline it still needs an entrance.
    const saved = history.selected
    if (history.stale && saved?.finishedAt && !rows.has(saved.id)) {
      rows.set(saved.id, {
        id: saved.id,
        name: saved.place.name,
        at: saved.finishedOnDeviceAt ?? saved.finishedAt,
        pending: false,
      })
    }
    for (const row of history.local) {
      const refused = queue.rejected.some(
        (item) => item.write.tripId === row.id && item.write.kind === 'start',
      )
      if (!refused)
        rows.set(row.id, {
          id: row.id,
          name: row.name,
          at: row.completedAt,
          pending: queue.pending.some(
            (write) => write.kind === 'finish' && write.tripId === row.id,
          ),
        })
    }
    return [...rows.values()].sort(
      (a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id),
    )
  })
  async function load(more = false): Promise<void> {
    if (!actor.id) return
    const token = ++run
    busy.value = true
    history.stale = true
    try {
      // An answer the list moved under is asked for again (adversarial А), after a pause that
      // doubles: the move may be a stream — another window sending its queue one purchase at a
      // time once the connection is back — and asking at once only met the next write (round 2,
      // Ж2). What is left after that is a quiet «did not load», worded so it is true either way.
      let taken = await history.load(more)
      for (let again = 1; !taken && again < ATTEMPTS && token === run; again += 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS * 2 ** (again - 1)))
        if (token === run) taken = await history.load(more)
      }
      if (token === run) trouble.value = taken ? null : 'error'
    } catch {
      if (token === run) trouble.value = navigator.onLine ? 'error' : 'offline'
    } finally {
      if (token === run) busy.value = false
    }
  }
  watch(
    () => actor.id,
    () => {
      run += 1
      void load()
    },
    { immediate: true },
  )
  useReconnect(() => {
    if (!loading.value) void load()
  })
  return {
    t,
    history,
    rows,
    loading,
    trouble,
    load: () => void load(),
    more: () => void load(true),
    open: (tripId: string) => void router.push({ name: 'finished-trip', params: { tripId } }),
    home: () => void router.push({ name: 'trip' }),
  }
}
