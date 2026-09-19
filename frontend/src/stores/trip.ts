import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { currentTripResponseSchema } from '@molvia/model'
import type { TripView } from '@molvia/model'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import { read, write } from '@/stores/storage'

const KEY = 'molvia.trip'

function keyOf(actorId: string): string {
  return `${KEY}.${actorId}`
}

/** The trip this identity last saw. Anything that does not parse is no trip rather than a crash. */
function recall(actorId: string | null): TripView | null {
  if (!actorId) return null
  const raw = read(keyOf(actorId))
  if (!raw) return null
  try {
    const parsed = currentTripResponseSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.trip : null
  } catch {
    return null
  }
}

function remember(actorId: string | null, trip: TripView | null): void {
  if (!actorId) return
  // Wire form: a trip carries bigints, which JSON cannot hold, and the codec that reads it back
  // is the one the client reads the server's answer with.
  write(keyOf(actorId), JSON.stringify(currentTripResponseSchema.encode({ trip })))
}

/**
 * The trip the person is on, as the server last answered it — the list, the price per unit of
 * every row and the total are the server's, and nothing here adds anything up.
 *
 * **It is remembered on the device** (MOL-24, Н-7). At the shelf the app is often opened with no
 * connection, and without the last known trip the sheet would not know where a purchase goes —
 * it would say «start a trip first» to someone standing in the middle of one. Each identity has
 * its own: a restored identity sees its trip, not the one of the identity it replaced.
 */
export const useTripStore = defineStore('trip', () => {
  const actor = useActorStore()
  const current = ref<TripView | null>(recall(actor.id))

  watch(
    () => actor.id,
    (id) => {
      current.value = recall(id)
    },
  )

  /**
   * Takes a trip the server answered with. The current one is replaced by its own later version
   * or by a new open trip; a finished trip answered for a row written into it later — the soy
   * sauce found at home (MOL-21) — is not the one the person is on, and does not take its place.
   */
  function apply(trip: TripView): void {
    const same = current.value?.id === trip.id
    if (!same && trip.finishedAt !== null) return
    current.value = trip
    remember(actor.id, trip)
  }

  /** Asks the server. A failure keeps what is remembered and is the caller's to show. */
  async function load(): Promise<void> {
    const trip = await api.currentTrip()
    current.value = trip
    remember(actor.id, trip)
  }

  return { current, apply, load }
})
