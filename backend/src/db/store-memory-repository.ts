import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Currency, Money, StoreMemoryKind, StoreMemoryWord } from '@molvia/model'
import type { Conn } from './index'
import { storeMemory } from './schema'

/** What the memory says a key is: the item, and the shelf price it had. */
export interface Recalled {
  readonly itemId: string
  readonly price: Money | null
}

/** A word to remember: this key at this seller is this item, at this shelf price. */
export interface MemoryWord extends StoreMemoryWord {
  readonly itemId: string
  readonly price: Money | null
}

export interface StoreMemoryRepository {
  /**
   * What the shop's memory says each key is, for this person (MOL-126, Р-2): their own word first;
   * else the item most people said — the erased count — and on a tie the one said last, with the price
   * of the latest word for it. Keyed `kind:key`.
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
        price_minor: string | null
        price_currency: Currency | null
      }>(sql`
        select distinct on (kind, key) kind, key, item_id, price_minor::text, price_currency
        from (
          select m.*,
            coalesce(m.actor_id = ${actorId}, false) as own,
            count(*) over (partition by m.kind, m.key, m.item_id) as votes,
            max(m.written_at) over (partition by m.kind, m.key, m.item_id) as latest
          from ${storeMemory} m
          where m.tin = ${tin}
            and (m.kind, m.key) in (${sql.join(
              words.map((word) => sql`(${word.kind}, ${word.key})`),
              sql`, `,
            )})
        ) words
        order by kind, key, own desc, votes desc, latest desc, written_at desc, id`)
      return new Map(
        rows.map((row) => [
          memoryKey(row),
          {
            itemId: row.item_id,
            price:
              row.price_minor === null || row.price_currency === null
                ? null
                : { minor: BigInt(row.price_minor), currency: row.price_currency },
          },
        ]),
      )
    },

    async remember(actorId, tin, words) {
      if (words.length === 0) return
      await db
        .insert(storeMemory)
        .values(
          words.map((word) => ({
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
