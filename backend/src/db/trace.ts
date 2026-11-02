import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { MergeSubject } from '@molvia/model'
import type { Conn } from './index'
import type { MergeMove } from './schema'

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

/**
 * A row written by a trace's id after its merge — a purchase queued before the night, a bot's button —
 * lands on the survivor by `liveItemId`, past the journal, and `unmerge` left it there for good (MOL-299,
 * adversarial А2). So it is written down under every merge on the trace's way to the survivor, as the
 * merge writes down what it moved: undone from the end, each step takes it one merge back, and the row
 * goes home with the rest. Called only where the id asked for is not the row's now; an id of no trace has
 * no way, and nothing is written.
 */
export async function noteTraceWrite(
  conn: Conn,
  subject: MergeSubject,
  asked: string,
  what: MergeMove,
  key: Record<string, unknown>,
  actorId: string | null = null,
): Promise<void> {
  const from = sql.raw(subject === 'item' ? 'from_item' : 'from_place')
  const into = sql.raw(subject === 'item' ? 'into_item' : 'into_place')
  await conn.execute(sql`
    with recursive way (id, next) as (
      select m.id, m.${into} from catalogue_merges m
      where m.undone_at is null and m.${from} = ${asked}::uuid
      union all
      select m.id, m.${into} from catalogue_merges m join way w on m.${from} = w.next
      where m.undone_at is null
    )
    insert into catalogue_merge_moves (merge_id, what, key, actor_id)
    select id, ${what}, ${JSON.stringify(key)}::jsonb, ${actorId}::uuid from way`)
}
