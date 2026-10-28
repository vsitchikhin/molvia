import { z } from 'zod'
import { catalogueEntryCodec, placeNameIdentity } from '@molvia/model'
import type { CatalogueEntry, PreviousItemsResponse } from '@molvia/model'
import { read, write } from '@/stores/storage'

/** How many rows «Брали здесь в прошлый раз» shows (Ф-24): what is left once the trip's own go. */
export const HERE_LAST_SHOWN = 5

/** How many places the device keeps: the oldest used goes first. A person shops in a handful. */
export const HERE_LAST_PLACES = 30

/**
 * Trips kept per place: the one the server last named, the one written here since, and one more
 * — what is needed to tell «the last time» from the trip going on, whichever came last.
 */
const TRIPS_PER_PLACE = 3

/** As many as the server answers with (`PREVIOUS_ITEMS_LIMIT`), and as «Часто берёте» keeps. */
const ITEMS_PER_TRIP = 20

/** A place as a trip names it: its city and name, as the database tells two places apart. */
export interface HerePlace {
  readonly city: string
  readonly name: string
}

/** Per identity, and so swept by «Выйти» with the rest of the drawer (MOL-57). */
function keyOf(owner: string): string {
  return `molvia.here-last.${owner}`
}

/**
 * By the city and the name, folded as the index over `places` folds them (MOL-209, Р-3) — never the
 * place's id: a trip started with no signal knows only what was typed at the door, and a shelf
 * with no signal is exactly where this memory is read. One name in two cities is two places
 * (MOL-120).
 */
function slotOf(place: HerePlace): string {
  return `${placeNameIdentity(place.city)}|${placeNameIdentity(place.name)}`
}

interface Kept {
  readonly tripId: string
  /** The trip's moment in «Записаны» from the server, or the last purchase written here into it. */
  readonly at: number
  readonly items: readonly CatalogueEntry[]
}

interface Slot {
  readonly slot: string
  readonly trips: readonly Kept[]
  /** The trip the server said has no last time at this place: nothing to wait for (В-2). */
  readonly none: string | null
}

const slotSchema = z.object({
  slot: z.string(),
  trips: z.array(z.unknown()).catch([]),
  none: z.string().nullable().catch(null),
})
const keptSchema = z.object({ tripId: z.string(), at: z.number(), items: z.array(z.unknown()) })

/** Slot by slot and row by row, so one an older version wrote differently costs only itself. */
function load(owner: string): Slot[] {
  const raw = read(keyOf(owner))
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((entry) => {
    const slot = slotSchema.safeParse(entry)
    if (!slot.success) return []
    const trips = slot.data.trips.flatMap((trip) => {
      const kept = keptSchema.safeParse(trip)
      if (!kept.success) return []
      const items = kept.data.items.flatMap((row) => {
        const item = catalogueEntryCodec.safeDecode(row as never)
        return item.success ? [item.data] : []
      })
      return [{ tripId: kept.data.tripId, at: kept.data.at, items }]
    })
    return [{ slot: slot.data.slot, trips, none: slot.data.none }]
  })
}

/** Storage refusing it costs nothing but the next group with no signal. */
function save(owner: string, slots: readonly Slot[]): void {
  write(
    keyOf(owner),
    JSON.stringify(
      slots.map((slot) => ({
        ...slot,
        trips: slot.trips.map((trip) => ({
          ...trip,
          items: trip.items.map((item) => catalogueEntryCodec.encode(item)),
        })),
      })),
    ),
  )
}

/** The slot changed, put first — the most recently used — and the oldest let go. */
function put(owner: string, place: HerePlace, change: (slot: Slot) => Slot): void {
  const key = slotOf(place)
  const slots = load(owner)
  const current = slots.find((slot) => slot.slot === key) ?? { slot: key, trips: [], none: null }
  const changed = change(current)
  const trips = [...changed.trips].sort((a, b) => b.at - a.at).slice(0, TRIPS_PER_PLACE)
  save(owner, [
    { ...changed, trips },
    ...slots.filter((slot) => slot.slot !== key).slice(0, HERE_LAST_PLACES - 1),
  ])
}

/**
 * What was taken the last time at this place, as the device remembers it (MOL-209): the newest trip
 * of the place but the one going on — and, for a finished trip, only one before it. `[]` when the
 * server said there is none; `null` when nothing is known, and then the screen waits for the
 * server a moment rather than show «Часто берёте» the answer would push down (В-2).
 */
export function recallHereLast(
  owner: string | null,
  place: HerePlace,
  tripId: string,
  before: Date | null = null,
): readonly CatalogueEntry[] | null {
  if (owner === null) return null
  const id = tripId.toLowerCase()
  const slot = load(owner).find((kept) => kept.slot === slotOf(place))
  if (!slot) return null
  const last = slot.trips.find(
    (trip) => trip.tripId !== id && (before === null || trip.at < before.getTime()),
  )
  if (last) return last.items
  return slot.none === id ? [] : null
}

/**
 * The server's answer for a trip at this place: its last time there, which takes the place of what
 * the device wrote into that same trip itself — the server knows what was removed since.
 */
export function rememberHereLast(
  owner: string,
  place: HerePlace,
  tripId: string,
  answer: PreviousItemsResponse,
): void {
  const id = tripId.toLowerCase()
  const { previous } = answer
  put(owner, place, (slot) => {
    if (previous === null) return { ...slot, none: id }
    const named = previous.tripId.toLowerCase()
    return {
      ...slot,
      none: slot.none === id ? null : slot.none,
      trips: [
        { tripId: named, at: previous.at.getTime(), items: answer.items.slice(0, ITEMS_PER_TRIP) },
        ...slot.trips.filter((trip) => trip.tripId !== named),
      ],
    }
  })
}

/**
 * An item that went into a trip at this place on this phone (В-1 «а»): the trip is the place's
 * newest, so with no signal the next trip there finds it as the last time — where the server's
 * answer, which names the trip before the one it was asked about, is a trip behind.
 */
export function rememberBoughtHere(
  owner: string,
  place: HerePlace,
  tripId: string,
  item: CatalogueEntry,
  /** A finished trip's moment in «Записаны», which it keeps; `null` for the one going on — now. */
  finishedAt: Date | null = null,
): void {
  const id = tripId.toLowerCase()
  const at = finishedAt ?? new Date()
  put(owner, place, (slot) => {
    const own = slot.trips.find((trip) => trip.tripId === id)
    // A finished trip the device does not hold — a receipt's, another phone's — it does not know
    // whole: the one item added would stand for all of it (adversarial А1г). It stays out.
    if (finishedAt !== null && !own) return slot
    // In the order first bought, as the server answers: a second milk leaves the milk where it was.
    const items = own?.items.some((kept) => kept.id === item.id)
      ? own.items
      : [...(own?.items ?? []), item].slice(0, ITEMS_PER_TRIP)
    return {
      ...slot,
      trips: [
        { tripId: id, at: at.getTime(), items },
        ...slot.trips.filter((trip) => trip.tripId !== id),
      ],
    }
  })
}
