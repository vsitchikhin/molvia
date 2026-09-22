import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { z } from 'zod'
import { currencySchema, tripHistoryCodec, tripViewCodec } from '@molvia/model'
import type { Currency, TripHistory, TripHistoryEntry, TripView } from '@molvia/model'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import { read, writeEverywhere } from '@/stores/storage'

const date = z.codec(z.iso.datetime(), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
})
const localCodec = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  startedAt: date,
  completedAt: date,
  currency: currencySchema,
  view: tripViewCodec.nullable(),
})
export type LocalFinishedTrip = z.output<typeof localCodec>
const cacheCodec = z.strictObject({
  page: tripHistoryCodec,
  selected: tripViewCodec.nullable(),
  local: z.array(localCodec),
})
const KEY = 'molvia.trip-history'
const empty = (): TripHistory => ({ trips: [], nextCursor: null })

/** A bounded read cache. Only unsynchronised completions keep additional full snapshots. */
export const useTripHistoryStore = defineStore('tripHistory', () => {
  const actor = useActorStore()
  const page = ref<TripHistory>(empty())
  const selected = ref<TripView | null>(null)
  const local = ref<LocalFinishedTrip[]>([])
  const stale = ref(true)
  let firstPage: TripHistory = empty()
  let generation = 0
  let selection = 0
  let ahead = false
  const revisions = new Map<string, number>()

  function recall(): z.output<typeof cacheCodec> | null {
    try {
      const raw = actor.id ? read(`${KEY}.${actor.id}`) : null
      const parsed = raw ? cacheCodec.safeParse(JSON.parse(raw)) : null
      return parsed?.success ? parsed.data : null
    } catch {
      return null
    }
  }

  // Storage events may arrive after a tap in another window. Read its pending snapshots first.
  function syncLocal(): void {
    if (!ahead) local.value = recall()?.local ?? []
  }

  function restore(): void {
    generation += 1
    selection += 1
    ahead = false
    const held = recall()
    firstPage = held?.page ?? empty()
    page.value = firstPage
    selected.value = held?.selected ?? null
    local.value = held?.local ?? []
    stale.value = true
  }
  restore()
  watch(() => actor.id, restore)
  window.addEventListener('storage', (event) => {
    if (event.key !== `${KEY}.${actor.id ?? ''}` || ahead) return
    const viewing = selected.value
    restore()
    // A different window selecting B does not replace A on this window's screen.
    if (viewing && selected.value?.id !== viewing.id) {
      selected.value = local.value.find((row) => row.id === viewing.id)?.view ?? viewing
    }
  })

  function persist(): void {
    if (!actor.id) return
    ahead = !writeEverywhere(
      `${KEY}.${actor.id}`,
      JSON.stringify(
        cacheCodec.encode({
          page: firstPage,
          selected: selected.value,
          local: local.value,
        }),
      ),
      (past) => {
        try {
          const held = cacheCodec.parse(JSON.parse(past))
          held.local = held.local.filter((row) => local.value.some((now) => now.id === row.id))
          return JSON.stringify(cacheCodec.encode(held))
        } catch {
          return null
        }
      },
    )
  }

  function capture(
    id: string,
    name: string,
    startedAt: Date,
    completedAt: Date,
    currency: Currency,
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
        }
      : null
  }

  /** Every write updates its own selection; it never chooses the current trip. */
  function apply(trip: TripView): void {
    syncLocal()
    revisions.set(trip.id, (revisions.get(trip.id) ?? 0) + 1)
    generation += 1
    if (selected.value?.id === trip.id) {
      selection += 1
      selected.value = trip
    }
    local.value = local.value.map((held) => (held.id === trip.id ? { ...held, view: trip } : held))
    const row = summary(trip)
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
    }
    persist()
  }

  function forgetLocal(id: string): void {
    syncLocal()
    local.value = local.value.filter((held) => held.id !== id)
    generation += 1
    persist()
  }

  async function load(more = false): Promise<void> {
    const owner = actor.id
    const version = generation
    const cursor = more ? page.value.nextCursor : null
    if (more && !cursor) return
    const answer = await api.tripHistory(cursor ?? undefined)
    if (owner !== actor.id || version !== generation) return
    syncLocal()
    if (!more) firstPage = answer
    local.value = local.value.filter((held) => !answer.trips.some((row) => row.id === held.id))
    const existing = more ? page.value.trips : []
    page.value = {
      trips: [
        ...existing,
        ...answer.trips.filter((row) => !existing.some((held) => held.id === row.id)),
      ],
      nextCursor: answer.nextCursor,
    }
    stale.value = false
    persist()
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
    selected.value = known(id)
    const answer = await api.trip(id)
    if (owner !== actor.id || token !== selection || revision !== (revisions.get(id) ?? 0)) return
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

  return { page, selected, local, stale, capture, apply, forgetLocal, load, known, open, completed }
})
