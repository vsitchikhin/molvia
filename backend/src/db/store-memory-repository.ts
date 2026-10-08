import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { storeMemoryWords } from '@molvia/model'
import type { Currency, Money, StoreMemoryKind, StoreMemoryWord } from '@molvia/model'
import type { Conn } from './index'
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
 * The lines that say a person's words: a recorded line of a purchase at a seller, with the item it went
 * to, its shelf price when it was recorded as read — read, figures and sum unchanged, as «Записать»
 * judged it (`asRead`) — and its order of saying, the order `remember` wrote them in.
 */
function spokenLines(db: Conn, where: SQL) {
  return db.execute<{
    actor: string
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
    select r.actor_id as actor, r.tin, l.printed, l.sku, ${liveItemId(sql`e.item_id`)} as item,
      case when l.settled
        and e.qty_milli is not distinct from l.qty_milli and e.qty_unit is not distinct from l.qty_unit
        and e.amount_minor = l.sum_minor and e.amount_currency = r.currency
      then l.price_minor end as price_minor,
      r.currency, r.recorded_at, l.receipt_id as receipt, l.position
    from receipt_lines l
    join receipts r on r.id = l.receipt_id
    join expenses e on e.id = l.expense_id
    where r.status = 'recorded' and r.tin is not null and r.actor_id is not null and ${where}
    order by r.recorded_at, l.receipt_id, l.position`)
}

/**
 * The person's word on each key is what their last line still there says (MOL-240, adversarial А1 and
 * round 3): its item, its shelf price and the moment of its record — or no word, once no line says it.
 * A word is one row per person and key that every record writes over, so the line that goes may be the
 * one that wrote it while an older one still stands behind the key: kept as it was, the word carried the
 * removed purchase's item, price and moment (Р3-1, Р3-2). Only `keys` are settled; `leaving` — lines
 * about to be deleted — say nothing. Never inserts: what no record taught, settling does not invent.
 * Returns the words changed or removed.
 */
async function settleWords(
  db: Conn,
  keys: readonly {
    readonly actor: string
    readonly tin: string
    readonly kind: string
    readonly key: string
  }[],
  leaving: ReadonlySet<string>,
): Promise<number> {
  if (keys.length === 0) return 0
  const wordOf = (actor: string, tin: string, kind: string, key: string) =>
    `${actor} ${tin} ${kind}:${key}`
  const pairs = [...new Map(keys.map((one) => [`${one.actor} ${one.tin}`, one])).values()]
  const lines = await spokenLines(
    db,
    sql`(r.actor_id, r.tin) in (${sql.join(
      pairs.map((one) => sql`(${one.actor}::uuid, ${one.tin})`),
      sql`, `,
    )})`,
  )
  // in the order said: the last line of a key is its word
  const last = new Map<string, (typeof lines)[number]>()
  for (const line of lines) {
    if (leaving.has(`${line.receipt} ${String(line.position)}`)) continue
    for (const word of storeMemoryWords(line)) {
      last.set(wordOf(line.actor, line.tin, word.kind, word.key), line)
    }
  }
  const words = await db.execute<{
    actor: string
    tin: string
    kind: string
    key: string
    item: string
    price_minor: string | null
    written_at: Date
  }>(sql`
    select actor_id as actor, tin, kind, key, item_id as item, price_minor, written_at
    from ${storeMemory}
    where (actor_id, tin) in (${sql.join(
      pairs.map((one) => sql`(${one.actor}::uuid, ${one.tin})`),
      sql`, `,
    )})`)
  const now = new Map(
    words.map((word) => [wordOf(word.actor, word.tin, word.kind, word.key), word]),
  )
  let settled = 0
  for (const one of keys) {
    const at = wordOf(one.actor, one.tin, one.kind, one.key)
    const word = now.get(at)
    if (word === undefined) continue
    const line = last.get(at)
    const which = sql`actor_id = ${one.actor}::uuid and tin = ${one.tin} and kind = ${one.kind} and key = ${one.key}`
    if (line === undefined) {
      await db.execute(sql`delete from ${storeMemory} where ${which}`)
    } else if (
      word.item !== line.item ||
      word.price_minor !== line.price_minor ||
      new Date(word.written_at).getTime() !== new Date(line.recorded_at).getTime()
    ) {
      await db.execute(sql`
        update ${storeMemory} set
          item_id = ${line.item}::uuid,
          price_minor = ${line.price_minor}::bigint,
          price_currency = ${line.price_minor === null ? null : line.currency},
          written_at = ${new Date(line.recorded_at).toISOString()}::timestamptz
        where ${which}`)
    } else continue
    settled += 1
    now.delete(at)
  }
  return settled
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
 * condition on `receipt_lines` aliased `l`. Under the person's lock, which «Записать» takes too
 * (`remember`): two removals at once each saw the other's line still there, and the word outlived both
 * (Р3-3). The erased keep their words without a name (MOL-126): erasure is not this.
 */
export async function forgetWordsOf(db: Conn, going: SQL): Promise<void> {
  const lines = await spokenLines(db, going)
  if (lines.length === 0) return
  await lockWords(
    db,
    lines.map((line) => line.actor),
  )
  const keys = lines.flatMap((line) =>
    storeMemoryWords(line).map((word) => ({ actor: line.actor, tin: line.tin, ...word })),
  )
  await settleWords(
    db,
    keys,
    new Set(lines.map((line) => `${line.receipt} ${String(line.position)}`)),
  )
}

/**
 * Every person's word settled at the API's start (MOL-240, round 3, Р3-4), as `rekeyItems` brings the
 * keys: 0060 deleted the lines of purchases removed before it and the receipts of trips removed for good,
 * and the words they taught had no line left to be found by — a text key is `toSearchKey`, which SQL
 * cannot compute. It also settles what an image rolled back onto this schema removed without forgetting.
 * Before the server listens, so no lock. Returns the words changed or removed.
 */
export async function settleStoreMemory(db: Conn): Promise<number> {
  const keys = await db.execute<{ actor: string; tin: string; kind: string; key: string }>(sql`
    select actor_id as actor, tin, kind, key from ${storeMemory} where actor_id is not null`)
  return settleWords(db, keys, new Set())
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
          })),
        )
        .onConflictDoUpdate({
          target: [storeMemory.tin, storeMemory.kind, storeMemory.key, storeMemory.actorId],
          set: {
            itemId: sql`excluded.item_id`,
            priceMinor: sql`excluded.price_minor`,
            priceCurrency: sql`excluded.price_currency`,
            writtenAt: sql`clock_timestamp()`,
          },
        })
    },
  }
}
