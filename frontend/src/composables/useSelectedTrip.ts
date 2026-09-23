import { computed, ref, toValue, watch } from 'vue'
import type { ComputedRef, Ref, MaybeRefOrGetter } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { TripView } from '@molvia/model'
import type { LocalFinishedTrip } from '@/stores/tripHistory'
import { useActorStore } from '@/stores/actor'
import { useTripHistoryStore } from '@/stores/tripHistory'
import { useTripQueueStore } from '@/stores/tripQueue'
import { useReconnect } from './useReconnect'

export interface SelectedTrip {
  id: ComputedRef<string | null>
  trip: ComputedRef<TripView | null>
  local: ComputedRef<LocalFinishedTrip | null>
  available: ComputedRef<boolean>
  loading: Ref<boolean>
  missing: Ref<boolean>
  trouble: Ref<'error' | 'offline' | null>
  stale: Ref<boolean>
  load: () => Promise<void>
}

/** An explicit trip stays explicit through a failure or a change to the current one. */
export function useSelectedTrip(target: MaybeRefOrGetter<string | null>): SelectedTrip {
  const history = useTripHistoryStore()
  const queue = useTripQueueStore()
  const actor = useActorStore()
  const id = computed(() => toValue(target)?.toLowerCase() ?? null)
  const loading = ref(false)
  const trouble = ref<'error' | 'offline' | null>(null)
  const missing = ref(false)
  const stale = ref(true)
  let request = 0
  const local = computed(() => history.local.find((row) => row.id === id.value) ?? null)
  const trip = computed(() => (id.value && !missing.value ? history.known(id.value) : null))
  /**
   * Whether the screen has anything to draw about this trip. A trip the server has never heard
   * of is still one the phone knows, as long as the queue holds its writes: its start went in at
   * the shelf with no signal, and its purchases are lines of it. Without this the screen had a
   * fifth state — no skeleton, no «not found», no error, no offline and no rows, just the header
   * (В4), reachable by the plain address `/trip/history/<id>` from a link or a reload.
   */
  const queued = computed(
    () =>
      queue.pending.some((write) => write.tripId === id.value) ||
      queue.rejected.some((item) => item.write.tripId === id.value),
  )
  const available = computed(
    () => !missing.value && (trip.value !== null || local.value !== null || queued.value),
  )
  async function load(): Promise<void> {
    const selected = id.value
    if (!selected || !actor.id) return
    const token = ++request
    loading.value = true
    missing.value = false
    try {
      await history.open(selected)
      if (token !== request) return
      trouble.value = null
      stale.value = false
    } catch (error) {
      if (token !== request) return
      const localStart = queue.pending.some((w) => w.kind === 'start' && w.tripId === selected)
      const absent = error instanceof ApiError && error.answered && error.code === ERROR.NOT_FOUND
      missing.value = !localStart && absent
      // A trip whose start is still in the queue is not a breakage, and red always offers
      // «Попробовать ещё раз» — here there is nothing to try (MOL-19, З-3). The screen shows the
      // rows it holds; the strip below already says the completion has not been sent.
      trouble.value = localStart && absent ? null : navigator.onLine ? 'error' : 'offline'
      stale.value = true
    } finally {
      if (token === request) loading.value = false
    }
  }
  watch(
    [id, () => actor.id],
    () => {
      request += 1
      stale.value = true
      missing.value = false
      trouble.value = null
      void load()
    },
    { immediate: true },
  )
  useReconnect(() => {
    void load()
  })
  return { id, trip, local, available, loading, missing, trouble, stale, load }
}
