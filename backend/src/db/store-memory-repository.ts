import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { storeMemoryWords } from '@molvia/model'
import type { Currency, Money, StoreMemoryKind, StoreMemoryWord } from '@molvia/model'
import type { Conn, Db } from './index'
import { storeMemory } from './schema'
import { liveItemId } from './trace'

/**
 * What the memory says a key is: the item, and whether it is the person's own word; the shelf price of
 * their own word; and of everyone's words for that item, how many carry a price and the lower median of
 * those prices — other people's figures open from three of them, as the prices of places do (MOL-166).
 */
export interface Recalled {
  readonly itemId: string
  readonly own: boolean
  readonly ownPrice: Money | null
  /** Words for the item that carry a price, the person's own included. */
  readonly priced: number
  readonly sharedPrice: Money | null
}

/** A word to remember: this key at this seller is this item, at this shelf price. */
export interface MemoryWord extends StoreMemoryWord {
  readonly itemId: string
  readonly price: Money | null
}

export interface StoreMemoryRepository {
  /**
   * What the shop's memory says each key is, for this person (MOL-126, Р-2): their own word first;
   * else the item most people said — the erased count — and on a tie the one said last; with the
   * person's own price and everyone's priced words for that item in `currency` — the receipt's: prices
   * of two currencies are never one median (MOL-166). Keyed `kind:key`.
   */
  recall(
    actorId: string,
    tin: string,
    words: readonly StoreMemoryWord[],
    currency: Currency,
  ): Promise<Map<string, Recalled>>
  /** The person's word on each key, written over their earlier one: a receipt recorded, a line corrected. */
  remember(actorId: string, tin: string, words: readonly MemoryWord[]): Promise<void>
}

export const memoryKey = (word: StoreMemoryWord): string => `${word.kind}:${word.key}`

/**
 * The lines that say a person's words: their recorded lines of purchases at a seller, with the item each
 * went to, its shelf price when «Записать» recorded it as read (`receipt_lines.as_read`, round 4, Р4-1:
 * never taken away by the purchase as it is now — a sum put right later is what was paid, not the
 * shelf; a line an image rolled back left unjudged, `null`, keeps it while its purchase is as the line
 * was read, round 5, Р5-1 — one judged not as read never does, round 6, Р6-1), and its order of saying, the order `remember` wrote them in.
 */
function spokenLines(db: Conn, actor: string, where: SQL = sql`true`) {
  return db.execute<{
    tin: string
    printed: string
    sku: string | null
    item: string
    price_minor: string | null
    currency: Currency
    recorded_at: Date
    receipt: string
    position: number
  }>(sql`
    select r.tin, l.printed, l.sku, ${liveItemId(sql`e.item_id`)} as item,
      case when l.as_read
        -- a line an image rolled back recorded was never judged, null (round 5, Р5-1): the one way
        -- left, as 0061 judged the lines before it — the purchase still as the line was read. A line
        -- «Записать» judged not as read is false, and keeps no price (round 6, Р6-1)
        or (l.as_read is null and l.settled
          and e.qty_milli is not distinct from l.qty_milli and e.qty_unit is not distinct from l.qty_unit
          and e.amount_minor = l.sum_minor and e.amount_currency = r.currency)
      then l.price_minor end as price_minor,
      r.currency, r.recorded_at, l.receipt_id as receipt, l.position
    from receipt_lines l
    join receipts r on r.id = l.receipt_id
    join expenses e on e.id = l.expense_id
    where r.actor_id = ${actor}::uuid and r.status = 'recorded' and r.tin is not null and ${where}
    order by r.recorded_at, l.receipt_id, l.position`)
}

/** At most this many words in one statement: a list of tuples is a tree the parser walks (Р4-2). */
const SETTLE_BATCH = 500

/**
 * One person's word on each key is what their last line still there says (MOL-240, adversarial А1 and
 * round 3): its item, its shelf price and the moment of its record — or no word, once no line says it.
 * A word is one row per person and key that every record writes over, so the line that goes may be the
 * one that wrote it while an older one still stands behind the key: kept as it was, the word carried the
 * removed purchase's item, price and moment (Р3-1, Р3-2). Only `keys` are settled — every word of the
 * person when none are named; `leaving` — lines about to be deleted — say nothing. Never inserts: what no
 * record taught, settling does not invent. One person at a time, by their id alone (round 4, Р4-2: every
 * pair of person and seller in one `in (…)` overflowed the parser's stack). Returns the words changed.
 */
async function settleWords(
  db: Conn,
  actor: string,
  keys: readonly { readonly tin: string; readonly kind: string; readonly key: string }[] | null,
  leaving: ReadonlySet<string>,
): Promise<number> {
  const wordOf = (tin: string, kind: string, key: string) => `${tin} ${kind}:${key}`
  // the sellers of the keys named — a removal reads its shop, not every shop of the person
  const tins = keys === null ? null : [...new Set(keys.map((one) => one.tin))]
  const ofTins = (column: SQL) =>
    tins === null
      ? sql`true`
      : sql`${column} in (${sql.join(
          tins.map((tin) => sql`${tin}`),
          sql`, `,
        )})`
  const words = await db.execute<{
    tin: string
    kind: string
    key: string
    item: string
    price_minor: string | null
    written_at: Date
  }>(sql`
    select tin, kind, key, item_id as item, price_minor, written_at
    from ${storeMemory} where actor_id = ${actor}::uuid and ${ofTins(sql`tin`)}`)
  const wanted =
    keys === null ? null : new Set(keys.map((one) => wordOf(one.tin, one.kind, one.key)))
  const settling = words.filter(
    (word) => wanted === null || wanted.has(wordOf(word.tin, word.kind, word.key)),
  )
  if (settling.length === 0) return 0
  // in the order said: the last line of a key is its word
  const last = new Map<string, Awaited<ReturnType<typeof spokenLines>>[number]>()
  for (const line of await spokenLines(db, actor, ofTins(sql`r.tin`))) {
    if (leaving.has(`${line.receipt} ${String(line.position)}`)) continue
    for (const word of storeMemoryWords(line)) last.set(wordOf(line.tin, word.kind, word.key), line)
  }
  const gone: SQL[] = []
  let settled = 0
  for (const word of settling) {
    const line = last.get(wordOf(word.tin, word.kind, word.key))
    if (line === undefined) {
      gone.push(sql`(${word.tin}, ${word.kind}, ${word.key})`)
      continue
    }
    if (
      word.item === line.item &&
      word.price_minor === line.price_minor &&
      new Date(word.written_at).getTime() === new Date(line.recorded_at).getTime()
    ) {
      continue
    }
    await db.execute(sql`
      update ${storeMemory} set
        item_id = ${line.item}::uuid,
        price_minor = ${line.price_minor}::bigint,
        price_currency = ${line.price_minor === null ? null : line.currency},
        written_at = ${new Date(line.recorded_at).toISOString()}::timestamptz
      where actor_id = ${actor}::uuid and tin = ${word.tin} and kind = ${word.kind} and key = ${word.key}`)
    settled += 1
  }
  for (let at = 0; at < gone.length; at += SETTLE_BATCH) {
    await db.execute(sql`
      delete from ${storeMemory}
      where actor_id = ${actor}::uuid
        and (tin, kind, key) in (${sql.join(gone.slice(at, at + SETTLE_BATCH), sql`, `)})`)
  }
  return settled + gone.length
}

/** One person's words are settled one at a time (MOL-240, round 3, Р3-3): a write skew otherwise. */
async function lockWords(db: Conn, actors: readonly string[]): Promise<void> {
  for (const actor of [...new Set(actors)].sort()) {
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtext('store_memory'), hashtext(${actor}))`,
    )
  }
}

/**
 * The lines `going` take the person's words they said with them (MOL-240, owner's В-1 «а» on
 * adversarial А1): a purchase removed, or its trip removed for good. Kept, the word was the person's own,
 * first on the next review of that shop, and «удалите и внесите заново» brought the wrong item back. A
 * key another line of the same person at the same seller still says is written over from the last such
 * line instead (`settleWords`). Called inside the transaction that deletes, before it does: `going` is a
 * condition on `receipt_lines` aliased `l`, `receipts` aliased `r`, `expenses` aliased `e`. Under the
 * person's lock, which «Записать» takes too (`remember`): two removals at once each saw the other's line
 * still there, and the word outlived both (Р3-3). The erased keep their words without a name (MOL-126):
 * erasure is not this.
 */
export async function forgetWordsOf(db: Conn, going: SQL): Promise<void> {
  const lines = await db.execute<{
    actor: string
    tin: string
    printed: string
    sku: string | null
    receipt: string
    position: number
  }>(sql`
    select r.actor_id as actor, r.tin, l.printed, l.sku, l.receipt_id as receipt, l.position
    from receipt_lines l
    join receipts r on r.id = l.receipt_id
    join expenses e on e.id = l.expense_id
    where r.status = 'recorded' and r.tin is not null and ${going}`)
  if (lines.length === 0) return
  const actors = [...new Set(lines.map((line) => line.actor))].sort()
  await lockWords(db, actors)
  const leaving = new Set(lines.map((line) => `${line.receipt} ${String(line.position)}`))
  for (const actor of actors) {
    const keys = lines
      .filter((line) => line.actor === actor)
      .flatMap((line) => storeMemoryWords(line).map((word) => ({ tin: line.tin, ...word })))
    await settleWords(db, actor, keys, leaving)
  }
}

/**
 * Every person's word settled (MOL-240, round 3, Р3-4): 0061 deleted the lines of purchases removed before
 * it and the receipts of trips removed for good, and the words they taught had no line left to be found
 * by — a text key is `toSearchKey`, which SQL cannot compute; an image rolled back onto this schema deletes
 * without settling too. Run once the API listens, never on its way there (round 4, Р4-2): a person at a
 * time, each in a transaction of their own under their lock, beside whatever writes meanwhile. Returns the
 * words changed or removed.
 */
export async function settleStoreMemory(db: Db): Promise<number> {
  const actors = await db.execute<{ actor: string }>(sql`
    select distinct actor_id as actor from ${storeMemory} where actor_id is not null`)
  let settled = 0
  for (const { actor } of actors) {
    settled += await db.transaction(async (tx) => {
      await lockWords(tx, [actor])
      return settleWords(tx, actor, null, new Set())
    })
  }
  return settled
}

export function createStoreMemoryRepository(db: Conn): StoreMemoryRepository {
  return {
    async recall(actorId, tin, words, currency) {
      if (words.length === 0) return new Map()
      const rows = await db.execute<{
        kind: StoreMemoryKind
        key: string
        item_id: string
        own: boolean
        own_minor: string | null
        own_currency: Currency | null
        priced: number
        median_minor: string | null
        median_currency: Currency | null
      }>(sql`
        with words as (
          select m.*, coalesce(m.actor_id = ${actorId}, false) as own
          from ${storeMemory} m
          where m.tin = ${tin}
            and (m.kind, m.key) in (${sql.join(
              words.map((word) => sql`(${word.kind}, ${word.key})`),
              sql`, `,
            )})
        ), winners as (
          select distinct on (kind, key) kind, key, item_id, own,
            price_minor as own_minor, price_currency as own_currency
          from (
            select w.*,
              count(*) over item as voters,
              max(w.written_at) over item as latest
            from words w
            window item as (partition by w.kind, w.key, w.item_id)
          ) ranked
          order by kind, key, own desc, voters desc, latest desc, written_at desc, id
        )
        select v.kind, v.key, v.item_id, v.own,
          case when v.own then v.own_minor end::text as own_minor,
          case when v.own then v.own_currency end as own_currency,
          p.priced, p.median_minor::text as median_minor, p.median_currency
        from winners v
        cross join lateral (
          select count(*)::int as priced,
            percentile_disc(0.5) within group (order by w.price_minor) as median_minor,
            ${currency}::text as median_currency
          from words w
          where w.kind = v.kind and w.key = v.key and w.item_id = v.item_id
            and w.price_minor is not null and w.price_currency = ${currency}
        ) p`)
      const money = (minor: string | null, currency: Currency | null): Money | null =>
        minor === null || currency === null ? null : { minor: BigInt(minor), currency }
      return new Map(
        rows.map((row) => [
          memoryKey(row),
          {
            itemId: row.item_id,
            own: row.own,
            ownPrice: money(row.own_minor, row.own_currency),
            priced: row.priced,
            sharedPrice: money(row.median_minor, row.median_currency),
          },
        ]),
      )
    },

    async remember(actorId, tin, words) {
      // one word per key, the last said: a receipt may print one article on two lines
      const last = [...new Map(words.map((word) => [memoryKey(word), word])).values()]
      if (last.length === 0) return
      // the lock the removals settle the person's words under (MOL-240, round 3, Р3-3)
      await lockWords(db, [actorId])
      await db
        .insert(storeMemory)
        .values(
          last.map((word) => ({
            id: randomUUID(),
            tin,
            kind: word.kind,
            key: word.key,
            actorId,
            // A word about an item from before a merge is about the survivor (MOL-106).
            itemId: liveItemId(word.itemId),
            priceMinor: word.price?.minor ?? null,
            priceCurrency: word.price?.currency ?? null,
            // a new word too, not only one written over (round 5, Р4-1б): the column's default is the
            // clock, a moment after the record's `recorded_at`
            writtenAt: sql`now()`,
          })),
        )
        .onConflictDoUpdate({
          target: [storeMemory.tin, storeMemory.kind, storeMemory.key, storeMemory.actorId],
          set: {
            itemId: sql`excluded.item_id`,
            priceMinor: sql`excluded.price_minor`,
            priceCurrency: sql`excluded.price_currency`,
            // the record's own moment, as its `recorded_at` (round 4, Р4-1б): a word settled later from
            // the same line then finds nothing to move
            writtenAt: sql`now()`,
          },
        })
    },
  }
}
