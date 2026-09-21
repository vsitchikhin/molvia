import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { currentTripResponseSchema } from '@molvia/model'
import type { TripView } from '@molvia/model'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import { read, writeEverywhere } from '@/stores/storage'

const KEY = 'molvia.trip'

function keyOf(actorId: string): string {
  return `${KEY}.${actorId}`
}

/**
 * The trip this identity last saw. Anything that does not parse is no trip rather than a crash.
 *
 * **Read more kindly than a server's answer** (adversarial Б3): the codec is strict on purpose,
 * and a trip remembered by the build before this one lacks a field this one requires — the whole
 * basket would vanish on the first launch after an update, exactly at a shelf, which is what the
 * memory was made for. A field this build added is filled in with what the absence means; the
 * queue reads its own cards the same way («a card kept on the device is not an answer»).
 */
function recall(actorId: string | null): TripView | null {
  if (!actorId) return null
  const raw = read(keyOf(actorId))
  if (!raw) return null
  try {
    const held: unknown = JSON.parse(raw)
    const parsed = currentTripResponseSchema.safeParse({ trip: known(held) })
    return parsed.success ? parsed.data.trip : null
  } catch {
    return null
  }
}

/** The fields of a trip this build knows; a field it added is filled with what its absence means. */
const TRIP_FIELDS = [
  'id',
  'startedAt',
  'finishedAt',
  'currency',
  'rate',
  'rateProvider',
  'rateJump',
  'rateStale',
  'place',
  'expenses',
  'total',
  'converted',
] as const

/**
 * A remembered trip as far as this build can read it, in both directions (Т-9): a field it has
 * since gained is filled in — the build before MOL-22 kept no `rateProvider` — and a field it has
 * never heard of, kept by a newer build the person rolled back from, is left out instead of
 * failing the whole parse. The queue reads its own cards the same way (`cardOf`).
 */
function known(held: unknown): unknown {
  if (!isRecord(held)) return null
  const trip = held.trip
  if (!isRecord(trip)) return trip ?? null
  const fields = Object.fromEntries(
    TRIP_FIELDS.filter((field) => trip[field] !== undefined).map((field) => [field, trip[field]]),
  )
  return { rateProvider: null, ...fields }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Written to every shelf that will take it, and taken off the ones that will not (Т-8): `read`
 * answers from the first shelf that has anything, so a stale copy left on a full `localStorage`
 * would be handed back as the trip on the next re-read — and those happen now on every change a
 * neighbouring window makes.
 */
function remember(actorId: string | null, trip: TripView | null): void {
  if (!actorId) return
  // Wire form: a trip carries bigints, which JSON cannot hold, and the codec that reads it back
  // is the one the client reads the server's answer with.
  writeEverywhere(keyOf(actorId), JSON.stringify(currentTripResponseSchema.encode({ trip })))
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

  /** What storage holds now — another window may have written it. */
  function reread(): void {
    current.value = recall(actor.id)
  }

  // Another window of the same person wrote the trip: the installed app and a tab from the bot
  // share the queue through storage and must share this too, or one of them keeps showing a trip
  // the other has already filled, finished or started (adversarial Б4).
  window.addEventListener('storage', (event) => {
    const id = actor.id
    if (id && event.key === keyOf(id)) reread()
  })

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
    if (current.value?.id !== tripId) return
    // Counted like an answer: a `load()` that left before the trip was finished must not put it
    // back when it returns — the person has closed it, and the server will agree in a moment.
    applied += 1
    set(null)
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

  return { current, apply, closed, reread, load }
})
