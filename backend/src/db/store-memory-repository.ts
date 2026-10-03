import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Currency, Money, StoreMemoryKind, StoreMemoryWord } from '@molvia/model'
import type { Conn } from './index'
import { storeMemory } from './schema'

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
   * person's own price and everyone's priced words for that item. Keyed `kind:key`.
   */
  recall(
    actorId: string,
    tin: string,
    words: readonly StoreMemoryWord[],
  ): Promise<Map<string, Recalled>>
  /** The person's word on each key, written over their earlier one: a receipt recorded, a line corrected. */
  remember(actorId: string, tin: string, words: readonly MemoryWord[]): Promise<void>
}

export const memoryKey = (word: StoreMemoryWord): string => `${word.kind}:${word.key}`

export function createStoreMemoryRepository(db: Conn): StoreMemoryRepository {
  return {
    async recall(actorId, tin, words) {
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
            min(w.price_currency) as median_currency
          from words w
          where w.kind = v.kind and w.key = v.key and w.item_id = v.item_id
            and w.price_minor is not null
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
      await db
        .insert(storeMemory)
        .values(
          last.map((word) => ({
            id: randomUUID(),
            tin,
            kind: word.kind,
            key: word.key,
            actorId,
            itemId: word.itemId,
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
