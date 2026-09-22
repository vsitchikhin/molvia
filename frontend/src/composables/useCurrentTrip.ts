import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { currencySchema } from '@molvia/model'
import type { ActorSettings, Currency, TripView } from '@molvia/model'
import { useActorStore } from '@/stores/actor'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'

/** A trip the phone has started and the server has not answered yet (MOL-22, В-2). */
export interface LocalTrip {
  readonly id: string
  readonly placeName: string
  readonly context?: ActorSettings
  readonly startedAt: Date
}

export interface CurrentTrip {
  /** The trip as the server last answered it, and only while it is the one being conducted. */
  readonly trip: ComputedRef<TripView | null>
  /** The same trip before the server has seen it: a name, a moment and no numbers. */
  readonly local: ComputedRef<LocalTrip | null>
  /** What a purchase is written into, whichever of the two it is. */
  readonly tripId: ComputedRef<string | null>
  /** The currency a price starts in: the trip's, or — before the server answers — the person's. */
  readonly currency: ComputedRef<Currency>
}

/**
 * Whether a trip is going on, asked of both places that know: the store, which holds the server's
 * last answer, and the queue, which holds what has not reached it yet (MOL-22, Р-2).
 *
 * Three states have to be told apart, and no single source has all three. A trip **started with no
 * signal** exists only as a `start` in the queue — the purchases queued behind it name it, and a
 * screen that waited for the server would send the person back to «Начать поход» in the middle of
 * a shop. A trip **finished with no signal** is still the server's current one, and showing it
 * again after the person closed it would take their decision back. And a trip started after both —
 * the ordinary «finished one, started the next» at the till — is the later of the two.
 *
 * The queue is in order, so walking it settles all of them: the last `start` not yet closed by its
 * own `finish` is the trip on the phone, and the server's trip counts only when nothing in the
 * queue has ended or replaced it. No second store: the queue already keeps this on the device.
 */
export function useCurrentTrip(): CurrentTrip {
  const trips = useTripStore()
  const queue = useTripQueueStore()
  const actor = useActorStore()

  const local = computed<LocalTrip | null>(() => {
    let started: LocalTrip | null = null
    for (const write of queue.pending) {
      if (write.kind === 'start') {
        started = {
          id: write.tripId,
          placeName: write.place.name,
          startedAt: write.startedAt,
          ...(write.context ? { context: write.context } : {}),
        }
      } else if (write.kind === 'finish' && started?.id === write.tripId) {
        started = null
      }
    }
    return started
  })

  const ended = computed(() => {
    const id = trips.current?.id
    return id !== undefined && queue.pending.some((w) => w.kind === 'finish' && w.tripId === id)
  })

  // A trip the phone started is the later one: it can only have been started after whatever the
  // server still holds was finished here.
  const trip = computed(() => (local.value !== null || ended.value ? null : trips.current))

  const tripId = computed(() => local.value?.id ?? trip.value?.id ?? null)

  const currency = computed(
    () =>
      trip.value?.currency ??
      local.value?.context?.spendCurrency ??
      actor.settings?.spendCurrency ??
      currencySchema.enum.AMD,
  )

  return { trip, local, tripId, currency }
}
