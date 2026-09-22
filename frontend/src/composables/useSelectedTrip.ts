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
  const available = computed(() => !missing.value && (trip.value !== null || local.value !== null))
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
      missing.value =
        !localStart && error instanceof ApiError && error.answered && error.code === ERROR.NOT_FOUND
      trouble.value = navigator.onLine ? 'error' : 'offline'
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
