import { z } from 'zod'
import { api } from '@/api'
import { read, write } from '@/stores/storage'

/**
 * The category of the person's last trip at each place (MOL-400, Р-6): what a receipt's review and «Закончить»
 * start on there. The server's answer (`GET /trips/place-categories`) is every phone's; what this phone recorded
 * since stands beside it until the next answer, so a receipt recorded offline at the same café starts on «Кафе»
 * the next time too. `molvia.place-categories.<owner>`, gone with «Выйти» as the owner's other drawers.
 */
const KEY = 'molvia.place-categories'

const memoryCodec = z.record(z.uuid(), z.uuid())

type Memory = Readonly<Record<string, string>>

function recall(owner: string): Memory {
  const raw = read(`${KEY}.${owner}`)
  if (!raw) return {}
  try {
    const parsed = memoryCodec.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

/** Place by place, as the domain's guess reads them (`guessedTripCategory`). */
export function placeCategoriesOf(
  owner: string | null,
): { readonly placeId: string; readonly categoryId: string }[] {
  if (!owner) return []
  return Object.entries(recall(owner)).map(([placeId, categoryId]) => ({ placeId, categoryId }))
}

/** A trip recorded at a place in a category: the next one there starts on it. */
export function rememberPlaceCategory(
  owner: string | null,
  placeId: string | null,
  categoryId: string | null,
): void {
  if (!owner || !placeId || !categoryId) return
  write(`${KEY}.${owner}`, JSON.stringify({ ...recall(owner), [placeId]: categoryId }))
}

/**
 * The server's answer laid over what the phone keeps. **The price, named:** a choice made here and not yet
 * landed, at a place the server answers for, gives way to the server's older one until it lands.
 */
export async function refreshPlaceCategories(owner: string | null): Promise<void> {
  if (!owner) return
  try {
    const { places } = await api.placeCategories()
    const answered = Object.fromEntries(places.map((one) => [one.placeId, one.categoryId]))
    write(`${KEY}.${owner}`, JSON.stringify({ ...recall(owner), ...answered }))
  } catch {
    // what the phone keeps stands; a guess is never worth a refusal
  }
}
