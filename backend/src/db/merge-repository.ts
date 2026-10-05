import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { ITEM_BARCODES_MAX } from '@molvia/model'
import { catalogueMergedNoticeSchema } from '@molvia/model'
import type { CatalogueMergedNotice, MergeSubject } from '@molvia/model'
import type { Conn } from './index'
import { idOrNull } from './rows'
import type { MergeBy, MergeMove } from './schema'
import { liveItemId, livePlaceId } from './trace'

/** How a pair came to be merged, and the figures the night judged it by; none by hand. */
export interface MergeHow {
  readonly by: MergeBy
  readonly edits?: number
  readonly worst?: number
  readonly meaning?: number
}

/**
 * Why a pair was not merged: one of the two is not there, they are one, of two kinds or two places
 * of a city, one is a trace already, the pair was undone before (the night never merges it again),
 * or the codes of both would pass what one item holds.
 */
export type MergeRefusal = 'missing' | 'same' | 'kind' | 'trace' | 'undone' | 'barcodes' | 'city'

export type MergeOutcome = { readonly id: number } | { readonly refused: MergeRefusal }

export type UnmergeOutcome =
  | { readonly subject: MergeSubject; readonly from: string; readonly into: string }
  | { readonly refused: 'missing' | 'undone' }

export interface MergeRepository {
  /**
   * The younger item into the older, in one transaction (MOL-106): every row that names it moves, one
   * person's two verdicts keep the one that wins and the other withdrawn on the trace, and the item
   * stays as a trace whose name the search finds the survivor by. Each row moved is written down.
   */
  mergeItems(from: string, into: string, how: MergeHow): Promise<MergeOutcome>
  /** The same for two places of one kind, country and city (MOL-50). */
  mergePlaces(from: string, into: string, how: MergeHow): Promise<MergeOutcome>
  /** Everything a merge moved, moved back, and its pair never merged by the night again. */
  unmerge(id: number): Promise<UnmergeOutcome>
  /**
   * What reached a trace after its merge — a write that read the id a moment before the merge took
   * it — moved to the survivor under the merge's own number. How many rows.
   */
  sweep(): Promise<number>
  /**
   * The pairs of live items the night looks at: each item's nearest names by meaning, as close as
   * `minMeaning` or closer, of one kind — and every pair of one search key, however far by meaning,
   * since one key in two scripts is the one pair the model cannot judge. Each pair once.
   */
  itemPairs(model: string, minMeaning: number): Promise<TwinRow[]>
  /** The live places of one kind, country and city where there are two or more, by group. */
  placeGroups(): Promise<PlaceRow[][]>
  /** Whether a pair was merged once and undone: the night never merges it or names it again. */
  undonePairs(subject: MergeSubject): Promise<ReadonlySet<string>>
  /**
   * The candidates of these never named before, now marked named on `day` — the morning names only
   * new ones (Р-11). A pair by its ids in order.
   */
  firstNamed(
    subject: MergeSubject,
    pairs: readonly (readonly [string, string])[],
    day: string,
  ): Promise<ReadonlySet<string>>
  /** The night of `day` claimed by this instance, or false when another has it — or had it. */
  claimRun(day: string, mode: 'on' | 'report', at: Date): Promise<boolean>
  finishRun(day: string, report: CatalogueMergedNotice, at: Date): Promise<void>
  /** The report of a night finished and not yet handed to the owner, marked handed in one statement. */
  takeReport(day: string, at: Date): Promise<CatalogueMergedNotice | null>
}

/** One side of a pair the night looks at. */
export interface TwinSide {
  readonly id: string
  readonly name: string
  readonly unit: string
  readonly createdAt: Date
}

export interface TwinRow {
  readonly a: TwinSide
  readonly b: TwinSide
  /** The cosine of the two names; null when either has no vector of the model. */
  readonly meaning: number | null
}

export interface PlaceRow {
  readonly id: string
  readonly name: string
  readonly city: string
  readonly createdAt: Date
}

/** A pair by its two ids in order — how the journal and the named candidates key it. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`
}

/** How many nearest names by meaning the night asks the index for, each item. */
const NEIGHBOURS = 10

interface Moved {
  readonly what: MergeMove
  readonly key: Record<string, unknown>
  readonly before?: Record<string, unknown>
  readonly actorId?: string
}

/** The setting the verdicts' trigger reads: a merge is no new opinion, `updated_at` stays (0052). */
const MERGING = sql`select set_config('molvia.merging', 'on', true)`

export function createMergeRepository(db: Conn): MergeRepository {
  async function journal(tx: Conn, mergeId: number, moved: readonly Moved[]): Promise<void> {
    if (moved.length === 0) return
    await tx.execute(sql`
      insert into catalogue_merge_moves (merge_id, what, key, before, actor_id)
      select ${mergeId}, m.what, m.key, m.before, m.actor_id
      from jsonb_to_recordset(${JSON.stringify(
        moved.map((one) => ({
          what: one.what,
          key: one.key,
          before: one.before ?? null,
          actor_id: one.actorId ?? null,
        })),
      )}::jsonb) as m(what text, key jsonb, before jsonb, actor_id uuid)`)
  }

  async function wasUndone(
    tx: Conn,
    subject: MergeSubject,
    a: string,
    b: string,
  ): Promise<boolean> {
    const [from, into] =
      subject === 'item' ? ['from_item', 'into_item'] : ['from_place', 'into_place']
    const rows = await tx.execute(sql`
      select 1 from catalogue_merges
      where undone_at is not null
        and ((${sql.raw(from)} = ${a} and ${sql.raw(into)} = ${b})
          or (${sql.raw(from)} = ${b} and ${sql.raw(into)} = ${a}))
      limit 1`)
    return rows.length > 0
  }

  async function opened(
    tx: Conn,
    subject: MergeSubject,
    from: string,
    into: string,
    how: MergeHow,
  ): Promise<number> {
    // bigint comes over the wire as a string
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into catalogue_merges
        (subject, from_item, into_item, from_place, into_place, by, edits, worst, meaning)
      values (
        ${subject},
        ${subject === 'item' ? from : null}::uuid, ${subject === 'item' ? into : null}::uuid,
        ${subject === 'place' ? from : null}::uuid, ${subject === 'place' ? into : null}::uuid,
        ${how.by}, ${how.edits ?? null}::smallint, ${how.worst ?? null}::smallint,
        ${how.meaning ?? null}::real)
      returning id`)
    if (!row) throw new Error('a merge was not written')
    return Number(row.id)
  }

  /**
   * One person's two verdicts on one «item + place», after the pair is one (Т-5): a live one beats a
   * withdrawn one, of two alike the later rating — the survivor's on a tie. The one that wins ends on
   * the survivor; the other stays a row on the trace, withdrawn — the 0.2 gate counts rows, and a merge
   * must give nobody a rating or take one away (Т-6).
   */
  async function settleVerdicts(tx: Conn, pairs: SQL): Promise<Moved[]> {
    const moved: Moved[] = []
    const rows = await tx.execute<{
      trace: string
      kept: string
      trace_wins: boolean
    }>(sql`
      select t.id as trace, k.id as kept,
             (t.deleted_at is null and k.deleted_at is not null)
               or ((t.deleted_at is null) = (k.deleted_at is null) and t.rated_at > k.rated_at)
               as trace_wins
      from (${pairs}) p
      join verdicts t on t.id = p.trace
      join verdicts k on k.id = p.kept
      order by t.id
      for update of t, k`)
    for (const row of rows) {
      if (row.trace_wins) {
        // The rows stay where they are and trade what they say: the winner's words, score and moments
        // go to the survivor's row, the loser's to the trace's. Moved as rows, the two would cross
        // through the unique key, which holds row by row.
        await tx.execute(sql`
          update verdicts v
          set score = o.score, review = o.review, rated_at = o.rated_at,
              updated_at = o.updated_at, deleted_at = o.deleted_at
          from verdicts o
          where (v.id, o.id) in ((${row.trace}::uuid, ${row.kept}::uuid),
                                 (${row.kept}::uuid, ${row.trace}::uuid))`)
        moved.push({ what: 'verdict_swapped', key: { kept: row.kept, trace: row.trace } })
      }
      const withdrawn = await tx.execute(sql`
        update verdicts set deleted_at = greatest(clock_timestamp(), rated_at), review = null
        where id = ${row.trace} and deleted_at is null
        returning id`)
      if (withdrawn.length > 0) moved.push({ what: 'verdict_withdrawn', key: { id: row.trace } })
    }
    return moved
  }

  /** Every row that names the item `from`, moved to `into`; what moved. */
  async function moveItemRows(tx: Conn, from: string, into: string): Promise<Moved[]> {
    const moved: Moved[] = []
    const ids = (rows: readonly { id: string }[], what: MergeMove): void => {
      for (const row of rows) moved.push({ what, key: { id: row.id } })
    }

    ids(
      await tx.execute<{ id: string }>(
        sql`update expenses set item_id = ${into} where item_id = ${from} returning id`,
      ),
      'expense',
    )

    moved.push(
      ...(await settleVerdicts(
        tx,
        sql`select t.id as trace, k.id as kept
            from verdicts t
            join verdicts k on k.actor_id = t.actor_id and k.item_id = ${into}
                           and k.place_id is not distinct from t.place_id
            where t.item_id = ${from}`,
      )),
    )
    ids(
      await tx.execute<{ id: string }>(sql`
        update verdicts t set item_id = ${into}
        where t.item_id = ${from}
          and not exists (select 1 from verdicts k
                          where k.actor_id = t.actor_id and k.item_id = ${into}
                            and k.place_id is not distinct from t.place_id)
        returning id`),
      'verdict',
    )

    // A pick of the same query on both: one row, the counts added and «own word» kept if either was;
    // the trace's figures written down, so the undo can take them off again.
    const added = await tx.execute<{
      actor_id: string
      query_key: string
      picks: number
      last_picked_at: string
      admits: boolean
    }>(sql`
      with gone as (
        delete from search_picks t
        where t.item_id = ${from}
          and exists (select 1 from search_picks k
                      where k.actor_id = t.actor_id and k.query_key = t.query_key
                        and k.item_id = ${into})
        returning t.actor_id, t.query_key, t.picks, t.last_picked_at, t.admits
      ),
      kept as (
        update search_picks k
        set picks = k.picks + g.picks,
            last_picked_at = greatest(k.last_picked_at, g.last_picked_at),
            admits = k.admits or g.admits
        from gone g
        where k.actor_id = g.actor_id and k.query_key = g.query_key and k.item_id = ${into}
        returning 1
      )
      select actor_id, query_key, picks, last_picked_at::text, admits from gone`)
    for (const row of added) {
      moved.push({
        what: 'pick_added',
        key: { queryKey: row.query_key },
        before: { picks: row.picks, lastPickedAt: row.last_picked_at, admits: row.admits },
        actorId: row.actor_id,
      })
    }
    const picks = await tx.execute<{ actor_id: string; query_key: string }>(sql`
      update search_picks set item_id = ${into} where item_id = ${from}
      returning actor_id, query_key`)
    for (const row of picks) {
      moved.push({ what: 'pick', key: { queryKey: row.query_key }, actorId: row.actor_id })
    }

    for (const row of await tx.execute<{ code: string }>(
      sql`update item_barcodes set item_id = ${into} where item_id = ${from} returning code`,
    )) {
      moved.push({ what: 'barcode', key: { code: row.code } })
    }
    // A name or a heading both items have stays with the trace: the survivor has it already.
    for (const row of await tx.execute<{ language: string; name: string }>(sql`
      update item_names t set item_id = ${into}
      where t.item_id = ${from}
        and not exists (select 1 from item_names k
                        where k.item_id = ${into} and k.language = t.language and k.name = t.name)
      returning language, name`)) {
      moved.push({ what: 'item_name', key: { language: row.language, name: row.name } })
    }
    for (const row of await tx.execute<{ hs: string }>(sql`
      update item_hs t set item_id = ${into}
      where t.item_id = ${from}
        and not exists (select 1 from item_hs k where k.item_id = ${into} and k.hs = t.hs)
      returning hs`)) {
      moved.push({ what: 'item_hs', key: { hs: row.hs } })
    }
    ids(
      await tx.execute<{ id: string }>(
        sql`update store_memory set item_id = ${into} where item_id = ${from} returning id`,
      ),
      'store_memory',
    )
    for (const row of await tx.execute<{ receipt_id: string; position: number }>(sql`
      update receipt_lines set item_id = ${into} where item_id = ${from}
      returning receipt_id, position`)) {
      moved.push({
        what: 'receipt_line',
        key: { receiptId: row.receipt_id, position: row.position },
      })
    }
    // Traces of the item follow it: a trace always points at a live item.
    ids(
      await tx.execute<{ id: string }>(
        sql`update items set merged_into = ${into} where merged_into = ${from} returning id`,
      ),
      'trace',
    )
    return moved
  }

  /** Every row that names the place `from`, moved to `into`; what moved. */
  async function movePlaceRows(tx: Conn, from: string, into: string): Promise<Moved[]> {
    const moved: Moved[] = []
    for (const row of await tx.execute<{ id: string }>(
      sql`update trips set place_id = ${into} where place_id = ${from} returning id`,
    )) {
      moved.push({ what: 'trip', key: { id: row.id } })
    }
    moved.push(
      ...(await settleVerdicts(
        tx,
        sql`select t.id as trace, k.id as kept
            from verdicts t
            join verdicts k on k.actor_id = t.actor_id and k.item_id = t.item_id
                           and k.place_id = ${into}
            where t.place_id = ${from}`,
      )),
    )
    for (const row of await tx.execute<{ id: string }>(sql`
      update verdicts t set place_id = ${into}
      where t.place_id = ${from}
        and not exists (select 1 from verdicts k
                        where k.actor_id = t.actor_id and k.item_id = t.item_id
                          and k.place_id = ${into})
      returning id`)) {
      moved.push({ what: 'verdict', key: { id: row.id } })
    }
    for (const row of await tx.execute<{ id: string }>(
      sql`update places set merged_into = ${into} where merged_into = ${from} returning id`,
    )) {
      moved.push({ what: 'trace', key: { id: row.id } })
    }
    return moved
  }

  return {
    async mergeItems(from, into, how) {
      if (idOrNull(from) === null || idOrNull(into) === null) return { refused: 'missing' }
      if (from.toLowerCase() === into.toLowerCase()) return { refused: 'same' }
      return db.transaction(async (tx): Promise<MergeOutcome> => {
        await tx.execute(MERGING)
        // Both rows locked in one order, so two merges of one item wait rather than cross.
        const rows = await tx.execute<{ id: string; kind: string; merged_into: string | null }>(sql`
          select id, kind, merged_into from items where id in (${from}::uuid, ${into}::uuid)
          order by id for update`)
        const a = rows.find((row) => row.id === from.toLowerCase())
        const b = rows.find((row) => row.id === into.toLowerCase())
        if (!a || !b) return { refused: 'missing' }
        if (a.kind !== b.kind) return { refused: 'kind' }
        if (a.merged_into !== null || b.merged_into !== null) return { refused: 'trace' }
        if (how.by === 'night' && (await wasUndone(tx, 'item', a.id, b.id))) {
          return { refused: 'undone' }
        }
        const [codes] = await tx.execute<{ n: number }>(sql`
          select count(*)::int as n from item_barcodes where item_id in (${a.id}::uuid, ${b.id}::uuid)`)
        if ((codes?.n ?? 0) > ITEM_BARCODES_MAX) return { refused: 'barcodes' }

        const id = await opened(tx, 'item', a.id, b.id, how)
        await journal(tx, id, await moveItemRows(tx, a.id, b.id))
        await tx.execute(sql`update items set merged_into = ${b.id} where id = ${a.id}`)
        return { id }
      })
    },

    async mergePlaces(from, into, how) {
      if (idOrNull(from) === null || idOrNull(into) === null) return { refused: 'missing' }
      if (from.toLowerCase() === into.toLowerCase()) return { refused: 'same' }
      return db.transaction(async (tx): Promise<MergeOutcome> => {
        await tx.execute(MERGING)
        const rows = await tx.execute<{
          id: string
          kind: string
          country: string
          city: string
          merged_into: string | null
        }>(sql`
          select id, kind, country, city, merged_into from places
          where id in (${from}::uuid, ${into}::uuid)
          order by id for update`)
        const a = rows.find((row) => row.id === from.toLowerCase())
        const b = rows.find((row) => row.id === into.toLowerCase())
        if (!a || !b) return { refused: 'missing' }
        if (a.kind !== b.kind) return { refused: 'kind' }
        // One name in two cities is two places (MOL-120): never merged, by night or by hand.
        if (a.country !== b.country || a.city !== b.city) return { refused: 'city' }
        if (a.merged_into !== null || b.merged_into !== null) return { refused: 'trace' }
        if (how.by === 'night' && (await wasUndone(tx, 'place', a.id, b.id))) {
          return { refused: 'undone' }
        }

        const id = await opened(tx, 'place', a.id, b.id, how)
        await journal(tx, id, await movePlaceRows(tx, a.id, b.id))
        await tx.execute(sql`update places set merged_into = ${b.id} where id = ${a.id}`)
        return { id }
      })
    },

    async unmerge(id) {
      return db.transaction(async (tx): Promise<UnmergeOutcome> => {
        await tx.execute(MERGING)
        const [merge] = await tx.execute<{
          subject: MergeSubject
          from_item: string | null
          into_item: string | null
          from_place: string | null
          into_place: string | null
          undone_at: string | null
        }>(sql`
          select subject, from_item, into_item, from_place, into_place, undone_at
          from catalogue_merges where id = ${id} for update`)
        if (!merge) return { refused: 'missing' }
        if (merge.undone_at !== null) return { refused: 'undone' }
        const item = merge.subject === 'item'
        const from = (item ? merge.from_item : merge.from_place) ?? ''
        const into = (item ? merge.into_item : merge.into_place) ?? ''
        // Where the moved rows stand now: the survivor, or whatever it was merged into since.
        const now = item ? liveItemId(into) : livePlaceId(into)

        const moves = await tx.execute<{
          what: MergeMove
          key: Record<string, string | number>
          before: { picks: number; lastPickedAt: string; admits: boolean } | null
          actor_id: string | null
        }>(sql`
          select what, key, before, actor_id from catalogue_merge_moves
          where merge_id = ${id}
          -- withdrawn before swapped back: the withdrawal was made on the row's swapped contents
          order by case what when 'verdict_withdrawn' then 0 when 'verdict_swapped' then 1 else 2 end`)

        for (const move of moves) {
          const key = move.key
          switch (move.what) {
            case 'expense':
              await tx.execute(sql`update expenses set item_id = ${from} where id = ${key.id}`)
              break
            case 'trip':
              await tx.execute(sql`update trips set place_id = ${from} where id = ${key.id}`)
              break
            case 'verdict': {
              const column = sql.raw(item ? 'item_id' : 'place_id')
              // Skipped when the trace has got a verdict of the same person since: never two.
              await tx.execute(sql`
                update verdicts v set ${column} = ${from}
                where v.id = ${key.id}
                  and not exists (
                    select 1 from verdicts o
                    where o.actor_id = v.actor_id and o.id <> v.id
                      and o.item_id = ${item ? sql`${from}::uuid` : sql`v.item_id`}
                      and o.place_id is not distinct from ${item ? sql`v.place_id` : sql`${from}::uuid`})`)
              break
            }
            case 'verdict_withdrawn':
              await tx.execute(sql`update verdicts set deleted_at = null where id = ${key.id}`)
              break
            case 'verdict_swapped':
              await tx.execute(sql`
                update verdicts v
                set score = o.score, review = o.review, rated_at = o.rated_at,
                    updated_at = o.updated_at, deleted_at = o.deleted_at
                from verdicts o
                where (v.id, o.id) in ((${key.kept}::uuid, ${key.trace}::uuid),
                                       (${key.trace}::uuid, ${key.kept}::uuid))`)
              break
            case 'pick':
              await tx.execute(sql`
                update search_picks set item_id = ${from}
                where actor_id = ${move.actor_id} and query_key = ${key.queryKey}
                  and item_id = ${now}
                  and not exists (select 1 from search_picks o
                                  where o.actor_id = ${move.actor_id}
                                    and o.query_key = ${key.queryKey} and o.item_id = ${from})`)
              break
            case 'pick_added': {
              const before = move.before
              if (before === null) break
              await tx.execute(sql`
                with taken as (
                  update search_picks set picks = picks - ${before.picks}
                  where actor_id = ${move.actor_id} and query_key = ${key.queryKey}
                    and item_id = ${now} and picks > ${before.picks}
                  returning 1
                )
                insert into search_picks (actor_id, query_key, item_id, picks, last_picked_at, admits)
                values (${move.actor_id}, ${key.queryKey}, ${from}, ${before.picks},
                        ${before.lastPickedAt}::timestamptz, ${before.admits})
                on conflict do nothing`)
              break
            }
            case 'barcode':
              await tx.execute(
                sql`update item_barcodes set item_id = ${from} where code = ${key.code}`,
              )
              break
            case 'item_name':
              await tx.execute(sql`
                update item_names set item_id = ${from}
                where item_id = ${now} and language = ${key.language} and name = ${key.name}`)
              break
            case 'item_hs':
              await tx.execute(
                sql`update item_hs set item_id = ${from} where item_id = ${now} and hs = ${key.hs}`,
              )
              break
            case 'store_memory':
              await tx.execute(sql`update store_memory set item_id = ${from} where id = ${key.id}`)
              break
            case 'receipt_line':
              await tx.execute(sql`
                update receipt_lines set item_id = ${from}
                where receipt_id = ${key.receiptId} and position = ${key.position}`)
              break
            case 'trace':
              await tx.execute(
                item
                  ? sql`update items set merged_into = ${from} where id = ${key.id}`
                  : sql`update places set merged_into = ${from} where id = ${key.id}`,
              )
              break
          }
        }
        await tx.execute(
          item
            ? sql`update items set merged_into = null where id = ${from}`
            : sql`update places set merged_into = null where id = ${from}`,
        )
        await tx.execute(
          sql`update catalogue_merges set undone_at = clock_timestamp() where id = ${id}`,
        )
        return { subject: merge.subject, from, into }
      })
    },

    async sweep() {
      return db.transaction(async (tx) => {
        await tx.execute(MERGING)
        const merges = await tx.execute<{
          id: string
          subject: MergeSubject
          from: string
          into: string
        }>(sql`
          select m.id, m.subject,
                 coalesce(m.from_item, m.from_place) as "from",
                 coalesce(i.merged_into, p.merged_into) as "into"
          from catalogue_merges m
          left join items i on i.id = m.from_item
          left join places p on p.id = m.from_place
          where m.undone_at is null
            and (exists (select 1 from expenses where item_id = m.from_item)
              or exists (select 1 from verdicts where item_id = m.from_item and deleted_at is null)
              or exists (select 1 from search_picks where item_id = m.from_item)
              or exists (select 1 from item_barcodes where item_id = m.from_item)
              or exists (select 1 from store_memory where item_id = m.from_item)
              or exists (select 1 from trips where place_id = m.from_place)
              or exists (select 1 from verdicts where place_id = m.from_place and deleted_at is null))
          order by m.id`)
        let count = 0
        for (const merge of merges) {
          const moved =
            merge.subject === 'item'
              ? await moveItemRows(tx, merge.from, merge.into)
              : await movePlaceRows(tx, merge.from, merge.into)
          await journal(tx, Number(merge.id), moved)
          count += moved.length
        }
        return count
      })
    },

    async itemPairs(model, minMeaning) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('hnsw.ef_search', ${String(NEIGHBOURS * 4)}, true)`)
        const rows = await tx.execute<{
          a: string
          b: string
          meaning: number | null
          a_name: string
          a_unit: string
          a_created: Date
          b_name: string
          b_unit: string
          b_created: Date
        }>(sql`
          with pairs as (
            select least(a.id, n.item_id) as a, greatest(a.id, n.item_id) as b
            from items a
            join item_embeddings ae on ae.item_id = a.id and ae.model = ${model}
            cross join lateral (
              select e.item_id, 1 - (e.embedding <=> ae.embedding) as meaning
              from item_embeddings e
              where e.model = ${model}
              order by e.embedding <=> ae.embedding
              limit ${NEIGHBOURS + 1}
            ) n
            where a.merged_into is null and n.item_id <> a.id and n.meaning >= ${minMeaning}
            union
            select a.id, b.id
            from items a
            join items b on b.search_key = a.search_key and b.kind = a.kind and a.id < b.id
            where a.merged_into is null and b.merged_into is null
          )
          select p.a, p.b,
                 1 - (ae.embedding <=> be.embedding) as meaning,
                 a.name as a_name, a.default_unit as a_unit, a.created_at as a_created,
                 b.name as b_name, b.default_unit as b_unit, b.created_at as b_created
          from pairs p
          join items a on a.id = p.a
          join items b on b.id = p.b
          left join item_embeddings ae on ae.item_id = a.id and ae.model = ${model}
          left join item_embeddings be on be.item_id = b.id and be.model = ${model}
          where a.kind = b.kind and a.merged_into is null and b.merged_into is null
          order by meaning desc nulls last, p.a, p.b`)
        return rows.map((row) => ({
          a: { id: row.a, name: row.a_name, unit: row.a_unit, createdAt: new Date(row.a_created) },
          b: { id: row.b, name: row.b_name, unit: row.b_unit, createdAt: new Date(row.b_created) },
          meaning: row.meaning,
        }))
      })
    },

    async placeGroups() {
      const rows = await db.execute<{
        id: string
        name: string
        city: string
        created_at: Date
        grp: string
      }>(sql`
        select id, name, city, created_at,
               kind || ' ' || country || ' ' || city as grp
        from places p
        where merged_into is null
          and exists (select 1 from places o
                      where o.merged_into is null and o.id <> p.id and o.kind = p.kind
                        and o.country = p.country and o.city = p.city)
        order by grp, created_at, id`)
      const groups = new Map<string, PlaceRow[]>()
      for (const row of rows) {
        const place = {
          id: row.id,
          name: row.name,
          city: row.city,
          createdAt: new Date(row.created_at),
        }
        groups.set(row.grp, [...(groups.get(row.grp) ?? []), place])
      }
      return [...groups.values()]
    },

    async undonePairs(subject) {
      const rows = await db.execute<{ a: string; b: string }>(
        subject === 'item'
          ? sql`select from_item as a, into_item as b from catalogue_merges
                where subject = 'item' and undone_at is not null`
          : sql`select from_place as a, into_place as b from catalogue_merges
                where subject = 'place' and undone_at is not null`,
      )
      return new Set(rows.map((row) => pairKey(row.a, row.b)))
    },

    async firstNamed(subject, pairs, day) {
      if (pairs.length === 0) return new Set()
      const ordered = pairs.map(([a, b]) => (a < b ? [a, b] : [b, a]))
      const rows = await db.execute<{ a: string; b: string }>(sql`
        insert into catalogue_merge_candidates (subject, a, b, named_on)
        select ${subject}, p.a, p.b, ${day}::date
        from jsonb_to_recordset(${JSON.stringify(ordered.map(([a, b]) => ({ a, b })))}::jsonb)
             as p(a uuid, b uuid)
        on conflict do nothing
        returning a, b`)
      return new Set(rows.map((row) => pairKey(row.a, row.b)))
    },

    async claimRun(day, mode, at) {
      const rows = await db.execute(sql`
        insert into catalogue_merge_runs (day, mode, started_at)
        values (${day}::date, ${mode}, ${at})
        on conflict do nothing
        returning day`)
      return rows.length > 0
    },

    async finishRun(day, report, at) {
      await db.execute(sql`
        update catalogue_merge_runs set finished_at = ${at}, report = ${JSON.stringify(report)}::jsonb
        where day = ${day}::date`)
    },

    async takeReport(day, at) {
      const [row] = await db.execute<{ report: unknown }>(sql`
        update catalogue_merge_runs set reported_at = ${at}
        where day = ${day}::date and finished_at is not null and reported_at is null
        returning report`)
      return row ? catalogueMergedNoticeSchema.parse(row.report) : null
    },
  }
}
