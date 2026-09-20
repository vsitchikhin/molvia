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
   * Answers written since a `load()` went out: a read that left before a write was answered
   * would otherwise put back the trip without it.
   */
  let applied = 0

  /**
   * Takes a trip the server answered with. The current one is replaced by its own later version
   * or by a new open trip; a finished trip answered for a row written into it later — the soy
   * sauce found at home (MOL-21) — is not the one the person is on, and does not take its place.
   *
   * **The current trip finished is no trip** (MOL-24, review Р-1): finished on another device,
   * or by «Завершить» once it goes through the queue, it must not keep taking the purchases —
   * the server would accept them, and the old trip would grow after it ended.
   */
  function apply(trip: TripView): void {
    const same = current.value?.id === trip.id
    applied += 1
    if (trip.finishedAt !== null) {
      if (same) set(null)
      return
    }
    set(trip)
  }

  function set(trip: TripView | null): void {
    current.value = trip
    remember(actor.id, trip)
  }

  /**
   * The trip is over, and the server said so with `204` — there is no trip to apply (MOL-22, Н-11).
   * Nothing is asked here on purpose: at the shelf the person has just finished a trip and may be
   * starting the next one, and a screen waiting on the network to say «done» would be lying about
   * what it already knows.
   */
  function closed(tripId: string): void {
    if (current.value?.id === tripId) set(null)
  }

  /**
   * Asks the server; the memory is for when it cannot be asked, not instead of asking (Р-2). A
   * failure keeps what is remembered and is the caller's to show.
   *
   * The answer is the asking identity's: one that changed while the request was out does not
   * get it (Р-7). And an answer to a write that came back first is the later truth.
   */
  async function load(): Promise<void> {
    const owner = actor.id
    const since = applied
    const trip = await api.currentTrip()
    if (actor.id !== owner || applied !== since) return
    set(trip)
  }

  return { current, apply, closed, load }
})
