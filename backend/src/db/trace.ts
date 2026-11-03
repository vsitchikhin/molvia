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
  /** `before` of the move; `into`: under the one merge of the way into that item, not every step. */
  extra: { readonly before?: Record<string, unknown>; readonly into?: string } = {},
): Promise<void> {
  await conn.execute(sql`
    ${wayOf(subject, asked)}
    insert into catalogue_merge_moves (merge_id, what, key, before, actor_id)
    select id, ${what}, ${JSON.stringify(key)}::jsonb,
           ${extra.before === undefined ? null : JSON.stringify(extra.before)}::jsonb, ${actorId}::uuid
    from way
    where ${extra.into === undefined ? sql`true` : sql`next = ${extra.into}::uuid`}`)
}

/**
 * A row a merge on the trace's way moved — or a trace's id wrote — written again by the trace's id: a pick
 * repeated from a phone's queue, a verdict given again by a bot's button (MOL-299, adversarial В1, В2). It
 * is still the person's word about the trace, so its moves take the row's new moment, and the undo takes
 * it home; touched by the survivor's id it keeps the old one and stays. `refers` picks the moves out by
 * `mv`; a row no move of the way names — the survivor's own from before — is left as it is.
 */
export async function restampTraceWrite(
  conn: Conn,
  subject: MergeSubject,
  asked: string,
  refers: SQL,
  at: string,
  /** What the latest write did, for a verdict written over (Г1, Г2): withdrew it, changed its text. */
  how: WriteHow | null = null,
): Promise<number> {
  const restamped = await conn.execute(sql`
    ${wayOf(subject, asked)}
    update catalogue_merge_moves mv
    set key = jsonb_set(mv.key, '{at}', to_jsonb(${at}::text)),
        before = case when mv.what = 'verdict_overwritten' and ${how !== null}
                      then mv.before || jsonb_build_object(
                             'withdrew', ${how?.withdrew ?? false},
                             'reviewChanged', (mv.before->>'reviewChanged')::boolean or ${how?.reviewChanged ?? false},
                             'rated', coalesce((mv.before->>'rated')::boolean, false) or ${how !== null && ratedBy(how)})
                      else mv.before end
    where mv.merge_id in (select id from way) and ${refers}
    returning 1`)
  return restamped.length
}

/** Every merge still standing on the trace's way to its survivor, as the CTE `way`. */
function wayOf(subject: MergeSubject, asked: string): SQL {
  const from = sql.raw(subject === 'item' ? 'from_item' : 'from_place')
  const into = sql.raw(subject === 'item' ? 'into_item' : 'into_place')
  return sql`
    with recursive way (id, next, depth) as (
      select m.id, m.${into}, 1 from catalogue_merges m
      where m.undone_at is null and m.${from} = ${asked}::uuid
      union all
      select m.id, m.${into}, w.depth + 1 from catalogue_merges m join way w on m.${from} = w.next
      where m.undone_at is null
    )`
}

/** The moves that name a verdict row: moved home whole, the survivor's side of a swap, written over. */
export function verdictMoves(id: string): SQL {
  return sql`((mv.what in ('verdict', 'verdict_overwritten') and mv.key->>'id' = ${id}::text)
           or (mv.what = 'verdict_swapped' and mv.key->>'kept' = ${id}::text))`
}

/**
 * What a trace's id did to a verdict written over: the latest write withdrew it, any changed its text, any
 * rated it — rated and taken back is a withdrawn verdict of its own (MOL-27, И2 of round 9), a withdrawal
 * alone none. `rated` absent: this write rated it unless it withdrew.
 */
export interface WriteHow {
  readonly withdrew: boolean
  readonly reviewChanged: boolean
  readonly rated?: boolean
}

function ratedBy(how: WriteHow): boolean {
  return how.rated ?? !how.withdrew
}

/** A verdict row as it stood before a write by a trace's id, never its text (MOL-299, Г1, Г2). */
export interface VerdictBefore {
  readonly score: number
  readonly ratedAt: string
  readonly updatedAt: string
  readonly deletedAt: string | null
}

/**
 * A verdict a trace's id wrote again after its merge (MOL-299). A row whose first move on the way came from
 * the trace itself is the trace's: its moves take the write's moment and the undo takes it home (В1, В2).
 * Any other holds a word about another item — the survivor's own from before, or one a merge of the way
 * brought from the middle of a chain — which the write just put the trace's word over (Г1, Г2): its moves
 * take the moment too, so they still carry it home, and the merge into the survivor keeps what it said.
 * That undo puts it back and gives the word to its younger, and where that is not yet the trace, writes it
 * there as the trace's id would, so the chain's next undo carries it on (№11, Д1 of round 5). The person's
 * id goes with it, so the move goes with the person, and the copy carries it.
 */
export async function verdictWrittenByTrace(
  conn: Conn,
  asked: string,
  row: { readonly id: string; readonly actorId: string; readonly touched: string },
  before: VerdictBefore,
  how: WriteHow,
): Promise<void> {
  const [first] = await conn.execute<{ what: string; home: string }>(sql`
    ${wayOf('item', asked)}
    select mv.what, m.from_item as home
    from way w
    join catalogue_merges m on m.id = w.id
    join catalogue_merge_moves mv on mv.merge_id = w.id
    where ${verdictMoves(row.id)}
    -- a word written over already beside the move that brought the row, on the same step (№13)
    order by w.depth, mv.what = 'verdict_overwritten' desc
    limit 1`)
  await restampTraceWrite(conn, 'item', asked, verdictMoves(row.id), row.touched, how)
  // written over once already, its first `before` stands; or the trace's own
  if (first?.what === 'verdict_overwritten' || first?.home === asked.toLowerCase()) return
  const [survivor] = await conn.execute<{ id: string }>(sql`
    select coalesce(merged_into, id) as id from items where id = ${asked}::uuid`)
  await noteTraceWrite(
    conn,
    'item',
    asked,
    'verdict_overwritten',
    { id: row.id, at: row.touched, asked: asked.toLowerCase() },
    row.actorId,
    { before: { ...before, ...how, rated: ratedBy(how) }, into: survivor?.id ?? asked },
  )
}

/**
 * The «own word» a person's row of `into` goes back to once every share standing on it goes home, as those
 * shares keep it — null with none (MOL-299, С1 of round 18). Every share of a row keeps the same one, never
 * the row's whole flag: that holds the words of the shares below, and the undo of one left it in the rest.
 */
export const keptAdmitsOf = (into: SQL, actorId: SQL, queryKey: SQL): SQL => sql`(
  select bool_and((mv.before->>'keptAdmits')::boolean)
  from catalogue_merge_moves mv
  join catalogue_merges m on m.id = mv.merge_id
  where m.undone_at is null and m.into_item = ${into} and mv.what in ('pick_added', 'pick_written')
    and mv.actor_id = ${actorId} and mv.key->>'queryKey' = ${queryKey})`

/** A pick row as it stood before a trace's id added to it (MOL-299, К1). */
export interface PickBefore {
  readonly lastPickedAt: string
  readonly admits: boolean
}

/**
 * A pick a trace's id wrote after its merge. A new row is the trace's, noted under every merge of its way
 * (А2); one a move of the way names is the trace's too, and takes the moment (В1). Any other — the survivor's
 * own from before, or one another merge brought into it — got the trace's picks added (К1, owner's В-11 «б»):
 * the merge into the survivor keeps the trace's share and what the row held before it, the share growing with
 * every later pick by that id, and the undo takes the share home. A row the merge added the trace's own picks
 * to (`pick_added`) grows that share instead: one snapshot of the row before the trace, never two (Л1).
 */
export async function pickWrittenByTrace(
  conn: Conn,
  asked: string,
  actorId: string,
  queryKey: string,
  at: string,
  prior: PickBefore | null,
  share: { readonly picks: number; readonly admits: boolean },
): Promise<void> {
  if (prior === null) {
    await noteTraceWrite(conn, 'item', asked, 'pick', { queryKey, at }, actorId)
    return
  }
  const mine = sql`mv.actor_id = ${actorId}::uuid and mv.key->>'queryKey' = ${queryKey}`
  if ((await restampTraceWrite(conn, 'item', asked, sql`mv.what = 'pick' and ${mine}`, at)) > 0)
    return
  const added = await conn.execute(sql`
    ${wayOf('item', asked)}
    update catalogue_merge_moves mv
    set key = jsonb_set(mv.key, '{at}', to_jsonb(${at}::text)),
        before = mv.before || jsonb_build_object(
          'picks', (mv.before->>'picks')::int + ${share.picks},
          'lastPickedAt', ${at}::text,
          'admits', (mv.before->>'admits')::boolean or ${share.admits})
    where mv.merge_id in (select id from way) and mv.what in ('pick_added', 'pick_written') and ${mine}
    returning 1`)
  if (added.length > 0) return
  const [survivor] = await conn.execute<{ id: string; kept: boolean | null }>(sql`
    select coalesce(i.merged_into, i.id) as id,
           ${keptAdmitsOf(sql`coalesce(i.merged_into, i.id)`, sql`${actorId}::uuid`, sql`${queryKey}`)} as kept
    from items i where i.id = ${asked}::uuid`)
  await noteTraceWrite(
    conn,
    'item',
    asked,
    'pick_written',
    { queryKey, at, asked: asked.toLowerCase() },
    actorId,
    {
      before: {
        picks: share.picks,
        lastPickedAt: at,
        admits: share.admits,
        keptLastPickedAt: prior.lastPickedAt,
        keptAdmits: survivor?.kept ?? prior.admits,
      },
      into: survivor?.id ?? asked,
    },
  )
}

/**
 * A pick by the survivor's own id of a row traces' shares stand on (MOL-299, М1, Н1): the row's own is that
 * one now, so every share of a merge into it keeps it as what the row goes back to once the share goes home.
 * Read from no moment of the row: in a fan, another trace's pick moves it as well.
 */
export async function pickWrittenBySurvivor(
  conn: Conn,
  itemId: string,
  actorId: string,
  queryKey: string,
  at: string,
  admits: boolean,
): Promise<void> {
  await conn.execute(sql`
    update catalogue_merge_moves mv
    set before = mv.before || jsonb_build_object(
          'keptLastPickedAt', ${at}::text,
          'keptAdmits', coalesce((mv.before->>'keptAdmits')::boolean, false) or ${admits})
    from catalogue_merges m
    where m.id = mv.merge_id and m.undone_at is null and m.into_item = ${itemId}::uuid
      and mv.what in ('pick_added', 'pick_written') and mv.actor_id = ${actorId}::uuid
      and mv.key->>'queryKey' = ${queryKey}`)
}
