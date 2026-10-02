import { z } from 'zod'
import { ownPricesResponseSchema } from '@molvia/model'
import type { OwnPricesResponse, SettingsGeography } from '@molvia/model'
import { read, write } from '@/stores/storage'

/** How many items' answers the device keeps (MOL-92, В-5): the oldest asked goes first. */
export const OWN_PRICES_REMEMBERED = 100

/** Per identity, and so swept by «Выйти» with the rest of the drawer (MOL-57). */
function keyOf(owner: string): string {
  return `molvia.own-prices.${owner}`
}

/** One answer per item and city: the same milk is another history in another city (В-4). */
function slotOf(itemId: string, where: SettingsGeography): string {
  return `${itemId.toLowerCase()}|${where.country}|${where.city}`
}

const storedSchema = z.object({ slot: z.string(), answer: z.unknown() })

/** Entry by entry, so one an older version wrote differently costs that entry and not the rest. */
function load(owner: string): { slot: string; answer: OwnPricesResponse }[] {
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
    const stored = storedSchema.safeParse(entry)
    if (!stored.success) return []
    const answer = ownPricesResponseSchema.safeDecode(stored.data.answer as never)
    return answer.success ? [{ slot: stored.data.slot, answer: answer.data }] : []
  })
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
): OwnPricesResponse | null {
  if (owner === null) return null
  const slot = slotOf(itemId, where)
  return load(owner).find((entry) => entry.slot === slot)?.answer ?? null
}

/** Newest first; storage refusing it costs nothing but the next offline hint. */
export function rememberOwnPrices(
  owner: string,
  itemId: string,
  where: SettingsGeography,
  answer: OwnPricesResponse,
): void {
  const slot = slotOf(itemId, where)
  const kept = load(owner)
    .filter((entry) => entry.slot !== slot)
    .slice(0, OWN_PRICES_REMEMBERED - 1)
    .map((entry) => ({ slot: entry.slot, answer: z.encode(ownPricesResponseSchema, entry.answer) }))
  const fresh = { slot, answer: z.encode(ownPricesResponseSchema, answer) }
  write(keyOf(owner), JSON.stringify([fresh, ...kept]))
}
