import { defineStore } from 'pinia'
import { ref, toRaw, watch } from 'vue'
import { z } from 'zod'
import {
  currencySchema,
  tripHistoryCodec,
  tripHistoryEntryCodec,
  tripViewCodec,
} from '@molvia/model'
import type { Currency, TripHistory, TripHistoryEntry, TripView } from '@molvia/model'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import { forget, read, write, writeEverywhere } from '@/stores/storage'

const date = z.codec(z.iso.datetime(), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
})
const localCodec = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  startedAt: date,
  completedAt: date,
  // Unknown rather than invented: without a trip and before the owner is read there is no
  // currency to name, and a made-up one is a number in the wrong money (З-9).
  currency: currencySchema.nullable(),
  view: tripViewCodec.nullable(),
})
export type LocalFinishedTrip = z.output<typeof localCodec>
const cacheCodec = z.strictObject({
  page: tripHistoryCodec,
  selected: tripViewCodec.nullable(),
  local: z.array(localCodec),
})
/**
 * Fields of a trip this cache does not keep yet (MOL-115, review Р-1, adversarial Д9): a window
 * still on the previous build reads the cache with a strict codec, took a cache holding them for
 * no cache at all, and wrote its own over a finish made with no signal. Left out on the way in and
 * filled with what their absence means on the way out; they go in with the next release, once no
 * build without them is left.
 */
const NOT_CACHED_YET = new Set(['accountId', 'debited', 'receipt', 'prices', 'gap'])
const TRIP_KEYS = new Set(Object.keys(tripViewCodec.def.shape))
/**
 * The same for a row of the history page (MOL-128): «12 позиций · 9 870 ֏» is not kept yet, for
 * the same reason, and a row read back from the phone says only where and when.
 */
const ENTRY_NOT_CACHED_YET = new Set(['itemCount', 'total'])
const ENTRY_KEYS = new Set(Object.keys(tripHistoryEntryCodec.def.shape))

/** A trip view on the shelf, with only the keys `keep` says — and never anything but a record. */
function shelved(view: unknown, keep: (key: string) => boolean): unknown {
  if (typeof view !== 'object' || view === null || Array.isArray(view)) return view
  return Object.fromEntries(Object.entries(view).filter(([key]) => keep(key)))
}

/**
 * Every trip view of a cache, rewritten by `keep`: the selected one and each local one's — and
 * every row of the page, by `keepEntry`.
 */
function everyView(
  held: unknown,
  keep: (key: string) => boolean,
  keepEntry: (key: string) => boolean,
): unknown {
  if (typeof held !== 'object' || held === null) return held
  const cache = held as { page?: unknown; selected?: unknown; local?: unknown }
  const page = cache.page as { trips?: unknown } | null | undefined
  return {
    ...cache,
    page:
      typeof page === 'object' && page !== null && Array.isArray(page.trips)
        ? { ...page, trips: page.trips.map((row: unknown) => shelved(row, keepEntry)) }
        : cache.page,
    selected: shelved(cache.selected, keep),
    local: Array.isArray(cache.local)
      ? cache.local.map((row: unknown) =>
          typeof row === 'object' && row !== null
            ? { ...row, view: shelved((row as { view?: unknown }).view, keep) }
            : row,
        )
      : cache.local,
  }
}

/** Read by both builds: a field of a later one is dropped rather than failing the whole cache. */
function fromShelf(raw: string): unknown {
  return everyView(
    JSON.parse(raw),
    (key) => TRIP_KEYS.has(key),
    (key) => ENTRY_KEYS.has(key),
  )
}

/** Written as the previous build reads it. */
function toShelf(cache: z.output<typeof cacheCodec>): string {
  return JSON.stringify(
    everyView(
      cacheCodec.encode(cache),
      (key) => !NOT_CACHED_YET.has(key),
      (key) => !ENTRY_NOT_CACHED_YET.has(key),
    ),
  )
}

/**
 * A trip as the shelf keeps it: what two copies are compared by when another window writes the
 * shelf. The fields the shelf does not keep yet are left out, so an answer and its own shelf copy
 * say the same (MOL-78, review Е2).
 */
function asShelved(trip: TripView): string {
  return JSON.stringify(shelved(tripViewCodec.encode(trip), (key) => !NOT_CACHED_YET.has(key)))
}

const KEY = 'molvia.trip-history'
/**
 * Whether the server's last first page for this owner was empty — now or on an earlier launch.
 * Every write to a trip persists the cache, so a stored empty page may be one nobody asked for,
 * and the home screen must not greet a person with a history as a newcomer (MOL-77).
 *
 * A key of its own, not a field of the cache: the cache codec is strict, and a window still on
 * the previous version read a cache with an unknown field as no cache at all, then wrote its
 * empty one over it — a finish made with no signal went with it (adversarial Е).
 *
 * «Empty», not «answered»: the flag and the page now live apart and can outlive each other — a
 * shelf that refused the new page keeps an old empty one — and «answered» beside a stale empty
 * page said «newcomer» to a person the server had just named two trips for (round 2, Ж1). An
 * answer with trips removes the flag from every shelf, which needs no room.
 */
const EMPTY_KEY = 'molvia.trip-history-empty'
const empty = (): TripHistory => ({ trips: [], nextCursor: null })

/**
 * A bounded read cache. A full snapshot is kept only for a completion the server has not
 * confirmed: the first answer about that trip takes it away, wherever the answer comes from —
 * the read after «Завершить», a purchase written into it later, or the row being opened. A
 * completion whose confirming read was lost keeps its snapshot until the trip is read again,
 * which is the first tap on its row (А6).
 */
export const useTripHistoryStore = defineStore('tripHistory', () => {
  const actor = useActorStore()
  const page = ref<TripHistory>(empty())
  const selected = ref<TripView | null>(null)
  /**
   * The trips as the server answered them, as against those read back from the shelf (MOL-78,
   * review Е): the shelf does not keep `receipt`, `prices` and `gap` yet, so only an answer knows
   * whether a finished record has a receipt's sum — and another window writing the shelf puts a
   * read-back trip in `selected` with no request of this window's own.
   */
  const answers = new WeakSet<TripView>()
  function answered(trip: TripView | null): boolean {
    return trip !== null && answers.has(toRaw(trip))
  }
  const local = ref<LocalFinishedTrip[]>([])
  const stale = ref(true)
  /** The server's last first page for this owner was empty (`EMPTY_KEY`). */
  const answeredEmpty = ref(false)
  let firstPage: TripHistory = empty()
  // What «Показать ещё» brought, and the cursor standing after it. Only the first page is
  // remembered on the phone; these live for as long as the screen does.
  let deeper: TripHistoryEntry[] = []
  let deepCursor: TripHistory['nextCursor'] = null
  let generation = 0
  let selection = 0
  let ahead = false
  const revisions = new Map<string, number>()

  const beyond = (rows: TripHistoryEntry[], row: TripHistoryEntry): boolean =>
    !rows.some((held) => held.id === row.id)

  /** Where a page ended: the same row and the same microsecond, or a different boundary. */
  const sameCursor = (a: TripHistory['nextCursor'], b: TripHistory['nextCursor']): boolean =>
    a === null || b === null ? a === b : a.at === b.at && a.id === b.id

  /** The first page, then what was loaded past it — and the deepest cursor of the two. */
  function spread(): TripHistory {
    return {
      trips: [...firstPage.trips, ...deeper],
      nextCursor: deeper.length > 0 ? deepCursor : firstPage.nextCursor,
    }
  }

  function recall(): z.output<typeof cacheCodec> | null {
    try {
      const raw = actor.id ? read(`${KEY}.${actor.id}`) : null
      const parsed = raw ? cacheCodec.safeParse(fromShelf(raw)) : null
      return parsed?.success ? parsed.data : null
    } catch {
      return null
    }
  }

  // Storage events may arrive after a tap in another window. Read its pending snapshots first.
  function syncLocal(): void {
    if (!ahead) local.value = recall()?.local ?? []
  }

  /**
   * `keepDeeper` is for a write by another window: the list is read from the top down, and a
   * background success must not take «Показать ещё» back from under the thumb (А4). A change of
   * owner keeps nothing — those rows are someone else's.
   */
  function restore(keepDeeper = false): void {
    generation += 1
    selection += 1
    ahead = false
    const held = recall()
    firstPage = held?.page ?? empty()
    deeper = keepDeeper ? deeper.filter((row) => beyond(firstPage.trips, row)) : []
    if (!keepDeeper) deepCursor = null
    page.value = spread()
    selected.value = held?.selected ?? null
    local.value = held?.local ?? []
    answeredEmpty.value = actor.id !== null && read(`${EMPTY_KEY}.${actor.id}`) === '1'
    stale.value = true
  }
  restore()
  watch(
    () => actor.id,
    () => {
      restore()
    },
  )
  window.addEventListener('storage', (event) => {
    if (event.key !== `${KEY}.${actor.id ?? ''}` || ahead) return
    const viewing = selected.value
    restore(true)
    // A different window selecting B does not replace A on this window's screen.
    if (viewing && selected.value?.id !== viewing.id) {
      selected.value = local.value.find((row) => row.id === viewing.id)?.view ?? viewing
    } else if (
      viewing &&
      selected.value &&
      answered(viewing) &&
      asShelved(selected.value) === asShelved(viewing)
    ) {
      // The same trip, and the shelf says nothing the answer on screen does not: the answer stays,
      // with the receipt's sum the shelf does not keep yet (MOL-78, review Е2). A copy that says
      // more — another purchase, another total — is fresher, and taken as it is. The server is not
      // asked again from here: two windows on one trip would ask each other in a circle.
      selected.value = viewing
    }
  })

  function persist(): void {
    if (!actor.id) return
    let shelf: string
    try {
      shelf = toShelf({ page: firstPage, selected: selected.value, local: local.value })
    } catch {
      // A moment no ISO date writes — a clock past 9999 — cannot go on the shelf. The cache stays in
      // memory, and the start or finish it came with is queued all the same (MOL-121, round 3 С).
      return
    }
    ahead = !writeEverywhere(`${KEY}.${actor.id}`, shelf, (past) => {
      try {
        const held = cacheCodec.parse(fromShelf(past))
        held.local = held.local.filter((row) => local.value.some((now) => now.id === row.id))
        return toShelf(held)
      } catch {
        return null
      }
    })
  }

  function capture(
    id: string,
    name: string,
    startedAt: Date,
    completedAt: Date,
    currency: Currency | null,
    view: TripView | null,
  ): void {
    syncLocal()
    if (!local.value.some((trip) => trip.id === id)) {
      local.value = [...local.value, { id, name, startedAt, completedAt, currency, view }]
      generation += 1
      persist()
    }
  }

  function summary(trip: TripView): TripHistoryEntry | null {
    return trip.finishedAt
      ? {
          id: trip.id,
          place: trip.place,
          startedAt: trip.startedAt,
          finishedAt: trip.finishedAt,
          finishedOnDeviceAt: trip.finishedOnDeviceAt ?? null,
          itemCount: trip.expenses.length,
          total: [...trip.total],
        }
      : null
  }

  /** Every write updates its own selection; it never chooses the current trip. */
  function apply(trip: TripView): void {
    answers.add(toRaw(trip))
    syncLocal()
    revisions.set(trip.id, (revisions.get(trip.id) ?? 0) + 1)
    // `generation` cancels a history answer that arrived after this window changed the list
    // under it — so it is raised by a change and not by a write. A purchase sent to the trip
    // going on touches neither the page nor the local completions, and used to throw away the
    // page the screen was waiting for, leaving «походов ещё нет» over a full history (А1).
    let moved = false
    if (selected.value?.id === trip.id) {
      selection += 1
      selected.value = trip
    }
    const row = summary(trip)
    if (local.value.some((held) => held.id === trip.id)) {
      // While the server does not hold the trip finished, the snapshot is refreshed; once it
      // does, the snapshot has nothing left to stand in for. Only `load()` used to drop it, and
      // only for a completion the first page still carries — one sent after twenty fresher ones
      // kept its own full `TripView` for ever (А6).
      //
      // The **row** stays until a page carries it: `apply` puts it in `page.value`, but what is
      // written to the phone is `firstPage`, which only `load()` moves. Dropping the row here
      // left the trip in one place that the next `restore()` or `load()` rebuilds from
      // `spread()` — so a completion whose follow-up list was lost vanished from the phone
      // altogether (В1).
      local.value = local.value.map((held) =>
        held.id === trip.id ? { ...held, view: row ? null : trip } : held,
      )
      moved = true
    }
    if (row) {
      selected.value ??= trip
      page.value = {
        ...page.value,
        trips: [...page.value.trips.filter((held) => held.id !== trip.id), row].sort(
          (a, b) =>
            (b.finishedOnDeviceAt ?? b.finishedAt).getTime() -
              (a.finishedOnDeviceAt ?? a.finishedAt).getTime() || b.id.localeCompare(a.id),
        ),
      }
      // Kept in place rather than dropped: a row of a page already loaded stays on that page.
      deeper = deeper.map((held) => (held.id === row.id ? row : held))
      moved = true
    }
    if (moved) generation += 1
    persist()
  }

  function forgetLocal(id: string): void {
    syncLocal()
    if (!local.value.some((held) => held.id === id)) return
    local.value = local.value.filter((held) => held.id !== id)
    generation += 1
    persist()
  }

  /**
   * A trip removed (MOL-76): out of every page, the selection and the completions still waiting,
   * here and on the shelf — a cached page drew it back at the next launch otherwise. Raises the
   * generation and the trip's revision, so a list or a read already on its way cannot put it back.
   */
  function drop(id: string): void {
    syncLocal()
    const other = (row: { id: string }) => row.id !== id
    firstPage = { ...firstPage, trips: firstPage.trips.filter(other) }
    deeper = deeper.filter(other)
    page.value = { ...page.value, trips: page.value.trips.filter(other) }
    local.value = local.value.filter(other)
    if (selected.value?.id === id) {
      selection += 1
      selected.value = null
    }
    revisions.set(id, (revisions.get(id) ?? 0) + 1)
    generation += 1
    persist()
  }

  /**
   * Whether the answer was taken. A false one is not a failure: the list changed under the
   * request — another window wrote the cache, a finish was taken back — and the answer may no
   * longer be true. The caller asks again rather than wait for a reconnect that may never come:
   * treated as a success, it left the home screen on a skeleton for good (adversarial А).
   */
  async function load(more = false): Promise<boolean> {
    const owner = actor.id
    const version = generation
    const cursor = more ? page.value.nextCursor : null
    if (more && !cursor) return true
    const answer = await api.tripHistory(cursor ?? undefined)
    // A next page cannot be cancelled by a change somewhere else: it lies deeper than anything
    // held, and it is merged by id. Under the shared guard a correction sent to a trip finished
    // last week threw it away, and «Показать ещё» did nothing at all (В5).
    //
    // What it cannot survive is the boundary it was read from moving while it was in flight: a
    // completion landing in the first page pushes its last row out, and the page that comes back
    // starts below where that row now is. Appended, it left the row in no page at all and the
    // list called itself complete — the hole `sameCursor` closes below, reached by a race (Д2).
    if (owner !== actor.id || (!more && version !== generation)) return false
    if (more && !sameCursor(cursor, page.value.nextCursor)) return false
    syncLocal()
    local.value = local.value.filter((held) => !answer.trips.some((row) => row.id === held.id))
    if (more) {
      const added = answer.trips.filter((row) => beyond(page.value.trips, row))
      deeper = [...deeper, ...added]
      deepCursor = answer.nextCursor
      page.value = { trips: [...page.value.trips, ...added], nextCursor: answer.nextCursor }
    } else {
      // A refresh of the first page does not take back the pages already loaded (А4): the list
      // is read from the top down, and a background success used to collapse it under the thumb
      // and put «Показать ещё» back. It also keeps a row the newest page pushed off the first
      // one — before, that row simply disappeared from the screen.
      //
      // Unless the boundary itself moved. The cursor of what was loaded past it points deeper
      // than the new first page ends, so the rows in between could never be read: the list kept
      // a hole and, once the tail had reached the end, claimed to be complete (В-1). Then the
      // tail is read again from the new boundary — the data under it really did change.
      const boundary = firstPage.nextCursor
      firstPage = answer
      if (deeper.length > 0 && !sameCursor(boundary, answer.nextCursor)) {
        deeper = []
        deepCursor = null
      } else {
        deeper = deeper.filter((row) => beyond(answer.trips, row))
      }
      page.value = spread()
      answeredEmpty.value = answer.trips.length === 0
      if (owner && answeredEmpty.value) write(`${EMPTY_KEY}.${owner}`, '1')
      else if (owner) forget(`${EMPTY_KEY}.${owner}`)
    }
    stale.value = false
    persist()
    return true
  }

  function known(id: string): TripView | null {
    return selected.value?.id === id
      ? selected.value
      : (local.value.find((row) => row.id === id)?.view ?? null)
  }

  async function open(id: string): Promise<void> {
    const owner = actor.id
    const token = ++selection
    const revision = revisions.get(id) ?? 0
    // Only what there is to show: a tap on a trip this phone has never read must not take away
    // the one it holds. Without a connection the read fails and nothing puts the old snapshot
    // back — and the next write would save the emptiness over it (А2). The screen reads through
    // `known(id)`, so someone else's trip is not shown by this either.
    const held = known(id)
    if (held) selected.value = held
    const answer = await api.trip(id)
    if (owner !== actor.id || token !== selection || revision !== (revisions.get(id) ?? 0)) return
    answers.add(answer)
    selected.value = answer
    apply(answer)
  }

  /** 204 has no snapshot. A lost follow-up read keeps the local completion available. */
  async function completed(id: string): Promise<void> {
    const owner = actor.id
    const version = generation
    try {
      const trip = await api.trip(id)
      if (owner === actor.id && version === generation) {
        apply(trip)
        await load()
      }
    } catch {
      /* Completion succeeded; reconnect or opening history will refresh the snapshot. */
    }
  }

  return {
    page,
    selected,
    local,
    stale,
    answeredEmpty,
    capture,
    apply,
    forgetLocal,
    drop,
    load,
    known,
    answered,
    open,
    completed,
  }
})
