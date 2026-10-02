import { sql } from 'drizzle-orm'
import type { Conn } from './index'
import { itemEmbeddings, items } from './schema'

export interface UnembeddedItem {
  readonly id: string
  readonly name: string
}

export interface ItemEmbedding {
  readonly itemId: string
  readonly embedding: readonly number[]
}

/** The vectors of item names (MOL-105): read by the search, written by one writer. */
export interface ItemEmbeddingRepository {
  /** Items without a vector of this model, the oldest first — a fresh seed fills in its order. */
  missing(model: string, limit: number): Promise<UnembeddedItem[]>
  /**
   * The vectors of this model, replacing a vector of another one. An item gone meanwhile is
   * skipped rather than refused: the writer works between reads and writes of other people.
   */
  write(model: string, rows: readonly ItemEmbedding[]): Promise<void>
}

/** The text form pgvector reads a vector in. Exported for the search, which sends one too. */
export function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`
}

export function createItemEmbeddingRepository(db: Conn): ItemEmbeddingRepository {
  return {
    async missing(model, limit) {
      const rows = await db.execute<{ id: string; name: string }>(
        sql`select ${items.id} as id, ${items.name} as name
            from ${items}
            left join ${itemEmbeddings}
              on ${itemEmbeddings.itemId} = ${items.id} and ${itemEmbeddings.model} = ${model}
            where ${itemEmbeddings.itemId} is null
            order by ${items.createdAt}, ${items.id}
            limit ${limit}`,
      )
      return rows.map((row) => ({ id: row.id, name: row.name }))
    },

    async write(model, rows) {
      if (rows.length === 0) return
      // Two parallel lists rather than an array parameter, as the search passes its synonyms: a
      // uuid holds no space, a vector's text no semicolon.
      const ids = rows.map((row) => row.itemId).join(' ')
      const vectors = rows.map((row) => vectorLiteral(row.embedding)).join(';')
      await db.execute(
        sql`insert into ${itemEmbeddings} (item_id, model, embedding)
            select v.id, ${model}, v.embedding::halfvec
            from unnest(string_to_array(${ids}, ' ')::uuid[],
                        string_to_array(${vectors}, ';')) as v(id, embedding)
            join ${items} on ${items.id} = v.id
            on conflict (item_id) do update
              set model = excluded.model, embedding = excluded.embedding, created_at = now()`,
      )
    },
  }
}
