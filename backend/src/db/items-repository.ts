import { randomUUID } from 'node:crypto'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import { itemSchema, toSearchKey } from '@molvia/model'
import type { Item, NewItem } from '@molvia/model'
import { quantityFrom, quantityTo } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, rowLimit, theRow } from './rows'
import { itemBarcodes, items } from './schema'

export interface ItemRepository {
  /** `createdBy` is null for a seeded item — it belongs to nobody. */
  create(input: NewItem, createdBy: string | null): Promise<Item>
  byId(id: string): Promise<Item | null>
  byIds(ids: readonly string[]): Promise<Item[]>
  /**
   * The catalogue lookup behind «что взяли?». No owner in the signature on purpose: the
   * catalogue is shared by everyone, so this is the one listing of 0.1 without an `actorId`.
   */
  search(query: string, limit: number): Promise<Item[]>
}

/**
 * The lowest `word_similarity` a candidate may score. Not 0.3, which the plan once said: a
 * two-vowel typo — «малако» against «Молоко Ашхар» — scores 0.167 and at 0.3 never even
 * becomes a candidate, so ranking has nothing to rank. Measured in MOL-10; tuning it on a
 * real catalogue is MOL-14's.
 */
const CANDIDATE_THRESHOLD = 0.15

/** How many candidates the trigram pass hands to ranking — a bound on the work, not a result size. */
const CANDIDATE_CEILING = 200

type ItemRow = typeof items.$inferSelect

/**
 * The only place a name is written — and the key is taken right here, not by the caller.
 * MOL-5 left this to the repository because the column does not fill itself, and MOL-6
 * found the wider hole: on a *rename* the key goes stale silently, with no error and no log
 * line. There is deliberately no method that takes a name past this function, so a rename
 * would have to come through it too.
 */
function nameColumns(name: string) {
  return { name, searchKey: toSearchKey(name) }
}

function toItem(row: ItemRow, barcodes: readonly string[]): Item {
  return itemSchema.parse({
    ...row,
    barcodes,
    typicalQuantity: quantityFrom(row.typicalQtyMilli, row.typicalQtyUnit),
  })
}

export function createItemRepository(db: Conn): ItemRepository {
  /** One query for the items and one for every barcode of them — never one per item. */
  async function load(ids: readonly string[]): Promise<Item[]> {
    // A malformed identifier matches nothing and would meet `22P02` — a 500 where «nothing
    // found» is the honest answer — so it is dropped before the query rather than sent.
    const known = ids.map(idOrNull).filter((id): id is string => id !== null)
    if (known.length === 0) return []

    // Ordered by id rather than left to the planner: a read whose order depends on the
    // physical layout is a test that passes until it does not.
    const rows = await db
      .select()
      .from(items)
      .where(inArray(items.id, known))
      .orderBy(asc(items.id))
    if (rows.length === 0) return []

    const codes = await db
      .select()
      .from(itemBarcodes)
      .where(
        inArray(
          itemBarcodes.itemId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(itemBarcodes.code))

    const byItem = new Map<string, string[]>()
    for (const { itemId, code } of codes) {
      const known = byItem.get(itemId)
      if (known) known.push(code)
      else byItem.set(itemId, [code])
    }

    return rows.map((row) => toItem(row, byItem.get(row.id) ?? []))
  }

  return {
    async create(input, createdBy) {
      const typical = quantityTo(input.typicalQuantity)

      // Both tables or neither: an item whose barcodes failed to land is an item nobody can
      // scan, and it would look exactly like one that never had any.
      return translateFailures(async () =>
        db.transaction(async (tx) => {
          const id = randomUUID()
          const [row] = await tx
            .insert(items)
            .values({
              id,
              kind: input.kind,
              ...nameColumns(input.name),
              note: input.note ?? null,
              defaultUnit: input.defaultUnit,
              typicalQtyMilli: typical.milli,
              typicalQtyUnit: typical.unit,
              createdBy,
            })
            .returning()

          if (input.barcodes.length > 0) {
            await tx
              .insert(itemBarcodes)
              .values(input.barcodes.map((code) => ({ code, itemId: id })))
          }

          // Sorted the way a later read returns them, so create and read agree.
          return toItem(theRow(row, 'items'), [...input.barcodes].sort())
        }),
      )
    },

    async byId(id) {
      if (idOrNull(id) === null) return null

      const [row] = await db.select().from(items).where(eq(items.id, id)).limit(1)
      if (!row) return null

      const codes = await db
        .select()
        .from(itemBarcodes)
        .where(eq(itemBarcodes.itemId, id))
        .orderBy(asc(itemBarcodes.code))

      return toItem(
        row,
        codes.map((code) => code.code),
      )
    },

    byIds: load,

    async search(query, limit) {
      // The same function the name went through on write: the key is compared with itself.
      const key = toSearchKey(query)
      // A query of nothing but separators leaves no key, and an empty key would match
      // every row — the function guarantees content only for names, never for queries.
      if (key === '') return []

      const ids = await db.transaction(async (tx) => {
        /*
         * The threshold of `%>` is a setting of the connection, not a value in the query —
         * `set_limit()` governs `%` and leaves this one at its default of 0.6. Connections
         * live in a pool, so a plain SET would leak into whatever runs on this connection
         * next. `set_config(…, true)` is SET LOCAL in a form that takes a bound parameter: it
         * ends with the transaction, which is why a read opens one — outside a transaction
         * it would end with the statement and the threshold would silently stay at 0.6.
         */
        await tx.execute(
          sql`select set_config('pg_trgm.word_similarity_threshold', ${String(CANDIDATE_THRESHOLD)}, true)`,
        )

        /*
         * The column goes first, and that is not style: `search_key %> $1` is the only form
         * the GIN index serves. `$1 %> search_key`, `search_key <% $1` and
         * `word_similarity($1, search_key) > t` mean the same and all fall back to a Seq Scan
         * — invisible on a test's handful of rows, fatal on a catalogue.
         */
        const rows = await tx.execute<{ id: string }>(sql`
          select ${items.id} as id
          from ${items}
          where ${items.searchKey} %> ${key}
          order by word_similarity(${key}, ${items.searchKey}) desc, ${items.id}
          limit ${Math.min(rowLimit(limit), CANDIDATE_CEILING)}
        `)
        return rows.map((row) => row.id)
      })

      // `load` answers in id order; the ranking is this query's, so it is restored here.
      const found = new Map((await load(ids)).map((item) => [item.id, item]))
      return ids.flatMap((id) => found.get(id) ?? [])
    },
  }
}
