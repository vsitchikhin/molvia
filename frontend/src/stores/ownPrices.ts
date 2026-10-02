import { z } from 'zod'
import { ownPricesSchema, placeNameIdentity, settingsGeographySchema } from '@molvia/model'
import type { OwnPrices, SettingsGeography } from '@molvia/model'
import { read, write } from '@/stores/storage'

/** How many items' answers the device keeps (MOL-92, В-5): the oldest asked goes first. */
export const OWN_PRICES_REMEMBERED = 100

/** How many records' cities it keeps: a record is written into for a day or two, not a hundred. */
export const RECORD_CITIES_REMEMBERED = 20

/** Per identity, and so swept by «Выйти» with the rest of the drawer (MOL-57). */
function keyOf(owner: string): string {
  return `molvia.own-prices.${owner}`
}

/**
 * One answer per item and city: the same milk is another history in another city (В-4). The city
 * by the fold places are stored under (review №7): an answer is kept under the spelling of the
 * record's place, and a record still queued is looked up by the spelling of its settings.
 */
function slotOf(itemId: string, where: SettingsGeography): string {
  return `${itemId.toLowerCase()}|${where.country}|${placeNameIdentity(where.city)}`
}

interface Entry {
  readonly slot: string
  readonly prices: OwnPrices
}

interface Memory {
  readonly entries: readonly Entry[]
  /** The city each record was answered in, newest first: what a record the server holds is, offline. */
  readonly records: readonly { readonly tripId: string; readonly where: SettingsGeography }[]
  /**
   * When an item was last let go of (adversarial В): an answer asked before it is older than the
   * verdict that let it go, and is not remembered whenever it arrives.
   */
  readonly forgotAt: number
}

const EMPTY: Memory = { entries: [], records: [], forgotAt: 0 }

const recordSchema = z.object({ tripId: z.string(), where: settingsGeographySchema })
const storedSchema = z.object({
  entries: z.array(z.unknown()).catch([]),
  records: z.array(z.unknown()).catch([]),
  forgotAt: z.number().catch(0),
})
const entrySchema = z.object({ slot: z.string(), prices: z.unknown() })

/** Entry by entry, so one an older version wrote differently costs that entry and not the rest. */
function load(owner: string): Memory {
  const raw = read(keyOf(owner))
  if (!raw) return EMPTY
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY
  }
  const stored = storedSchema.safeParse(parsed)
  if (!stored.success) return EMPTY
  return {
    entries: stored.data.entries.flatMap((entry) => {
      const kept = entrySchema.safeParse(entry)
      if (!kept.success) return []
      const prices = ownPricesSchema.safeDecode(kept.data.prices as never)
      return prices.success ? [{ slot: kept.data.slot, prices: prices.data }] : []
    }),
    records: stored.data.records.flatMap((record) => {
      const kept = recordSchema.safeParse(record)
      return kept.success ? [kept.data] : []
    }),
    forgotAt: stored.data.forgotAt,
  }
}

function save(owner: string, memory: Memory): void {
  write(
    keyOf(owner),
    JSON.stringify({
      entries: memory.entries.map((entry) => ({
        slot: entry.slot,
        prices: z.encode(ownPricesSchema, entry.prices),
      })),
      records: memory.records,
      forgotAt: memory.forgotAt,
    }),
  )
}

/** Whether `prices` says anything about `itemIds` — as the item asked about or as another of its kind. */
function names(prices: OwnPrices, itemIds: ReadonlySet<string>): boolean {
  if (itemIds.has(prices.itemId)) return true
  return prices.level !== 'never' && prices.alternatives.some((other) => itemIds.has(other.itemId))
}

/**
 * The last answer of «Тут дешевле» for an item in a city, kept for a shelf with no signal (MOL-92,
 * В-5): «из того, что уже есть на устройстве, или не показывается». Only what the person may see
 * anyway — their own prices and the ratings «Что брать» shows them.
 */
export function recallOwnPrices(
  owner: string | null,
  itemId: string,
  where: SettingsGeography,
): OwnPrices | null {
  if (owner === null) return null
  const slot = slotOf(itemId, where)
  return load(owner).entries.find((entry) => entry.slot === slot)?.prices ?? null
}

/**
 * Newest first; storage refusing it costs nothing but the next offline hint. An answer asked before
 * the memory last let something go is dropped: it was read before the verdict that did it.
 */
export function rememberOwnPrices(
  owner: string,
  itemId: string,
  where: SettingsGeography,
  prices: OwnPrices,
  askedAt: number,
): void {
  const memory = load(owner)
  if (askedAt < memory.forgotAt) return
  const slot = slotOf(itemId, where)
  const kept = memory.entries.filter((entry) => entry.slot !== slot)
  save(owner, {
    ...memory,
    entries: [{ slot, prices }, ...kept].slice(0, OWN_PRICES_REMEMBERED),
  })
}

/** The city the server answered a record in (review №1). */
export function rememberRecordCity(owner: string, tripId: string, where: SettingsGeography): void {
  const memory = load(owner)
  const id = tripId.toLowerCase()
  const kept = memory.records.filter((record) => record.tripId !== id)
  save(owner, {
    ...memory,
    records: [{ tripId: id, where }, ...kept].slice(0, RECORD_CITIES_REMEMBERED),
  })
}

/** The city of a record the server holds, as it last answered — with no signal, nothing else knows it. */
export function recallRecordCity(owner: string | null, tripId: string): SettingsGeography | null {
  if (owner === null) return null
  const id = tripId.toLowerCase()
  return load(owner).records.find((record) => record.tripId === id)?.where ?? null
}

/**
 * Every remembered answer naming one of `itemIds` — as itself or as another of its kind — let go
 * once the phone hears it rated: rated on this phone, answered «не брать нигде» by the server, or
 * listed so on «Что брать» (adversarial Б). A memory older than a verdict of «не брать нигде» would
 * otherwise put a price beside it with no signal (Т-3), or offer it as the cheaper milk.
 */
export function forgetOwnPrices(
  owner: string | null,
  itemIds: readonly string[],
  { rated = true }: { readonly rated?: boolean } = {},
): void {
  if (owner === null || itemIds.length === 0) return
  const ids = new Set(itemIds.map((id) => id.toLowerCase()))
  const memory = load(owner)
  const entries = memory.entries.filter((entry) => !names(entry.prices, ids))
  // A list read is no verdict given now: it lets go of what it names, and leaves alone the answers
  // still on their way — on every opening of «Что брать» it would otherwise drop them all.
  if (!rated && entries.length === memory.entries.length) return
  save(owner, { ...memory, entries, forgotAt: rated ? Date.now() : memory.forgotAt })
}
