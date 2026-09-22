import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useTripHistoryStore } from '@/stores/tripHistory'
import { useTripQueueStore } from '@/stores/tripQueue'
import { useActorStore } from '@/stores/actor'
import { useReconnect } from './useReconnect'

interface HistoryRow {
  id: string
  name: string
  at: Date
  pending: boolean
}
interface TripHistoryScreen {
  t: ReturnType<typeof useI18n>['t']
  history: ReturnType<typeof useTripHistoryStore>
  rows: ComputedRef<HistoryRow[]>
  loading: Ref<boolean>
  trouble: Ref<'error' | 'offline' | null>
  when(date: Date): string
  load(): void
  more(): void
  open(tripId: string): void
  home(): void
}
export function useTripHistory(): TripHistoryScreen {
  const history = useTripHistoryStore()
  const queue = useTripQueueStore()
  const actor = useActorStore()
  const router = useRouter()
  const { t, locale } = useI18n()
  const loading = ref(false)
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
    loading.value = true
    history.stale = true
    try {
      await history.load(more)
      if (token === run) trouble.value = null
    } catch {
      if (token === run) trouble.value = navigator.onLine ? 'error' : 'offline'
    } finally {
      if (token === run) loading.value = false
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
  const when = (date: Date) =>
    new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  return {
    t,
    history,
    rows,
    loading,
    trouble,
    when,
    load: () => void load(),
    more: () => void load(true),
    open: (tripId: string) => void router.push({ name: 'finished-trip', params: { tripId } }),
    home: () => void router.push({ name: 'trip' }),
  }
}
