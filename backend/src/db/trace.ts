import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

/**
 * The item an id stands for now (MOL-106): the survivor of the merge it went into, else itself. An id a
 * phone queued before the night, a bot's button sent the day before, a receipt's draft — each lands on
 * the survivor rather than on a trace nobody reads. One step is enough: a trace never points at a
 * trace. An id of nothing stays itself, so «not found» is still answered where it was.
 */
export function liveItemId(id: string | SQL): SQL {
  return sql`coalesce((select merged_into from items where id = ${id}::uuid), ${id}::uuid)`
}

/** The place an id stands for now — a trace's survivor, as an item's (MOL-106). */
export function livePlaceId(id: string | SQL): SQL {
  return sql`coalesce((select merged_into from places where id = ${id}::uuid), ${id}::uuid)`
}
