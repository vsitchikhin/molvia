import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { recentPlacesResponseSchema } from '@molvia/model'
import type { TripPlace } from '@molvia/model'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import { read, write } from '@/stores/storage'

const KEY = 'molvia.places'

const keyOf = (actorId: string): string => `${KEY}.${actorId}`

/** Anything that does not parse is no list rather than a crash, as the trip's memory does it. */
function recall(actorId: string | null): TripPlace[] {
  if (!actorId) return []
  const raw = read(keyOf(actorId))
  if (!raw) return []
  try {
    const parsed = recentPlacesResponseSchema.safeParse(JSON.parse(raw))
    return parsed.success ? [...parsed.data.places] : []
  } catch {
    return []
  }
}

/**
 * Where this person shopped last, kept on the device (MOL-22, В-8). «Начать поход» is tapped at
 * the door of a shop, which is exactly where the connection is worst: without the list the name
 * would have to be typed every time, and a name typed in a hurry is how one shop becomes two.
 *
 * Per identity, like everything else the device remembers: a restored identity sees its own shops.
 */
export const useRecentPlacesStore = defineStore('recentPlaces', () => {
  const actor = useActorStore()
  const places = ref<TripPlace[]>(recall(actor.id))

  watch(
    () => actor.id,
    (id) => {
      places.value = recall(id)
    },
  )

  /** Asks the server and keeps the answer. A failure leaves what is remembered — it is still true. */
  async function refresh(): Promise<void> {
    const owner = actor.id
    const answer = await api.recentPlaces()
    if (actor.id !== owner || !owner) return
    places.value = [...answer]
    write(keyOf(owner), JSON.stringify(recentPlacesResponseSchema.encode({ places: answer })))
  }

  return { places, refresh }
})
