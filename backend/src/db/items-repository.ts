import { randomUUID } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import { itemSchema, toSearchKey } from '@molvia/model'
import type { Item, NewItem } from '@molvia/model'
import { quantityFrom, quantityTo } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { theRow } from './rows'
import { itemBarcodes, items } from './schema'

export interface ItemRepository {
  /** `createdBy` is null for a seeded item — it belongs to nobody. */
  create(input: NewItem, createdBy: string | null): Promise<Item>
  byId(id: string): Promise<Item | null>
  byIds(ids: readonly string[]): Promise<Item[]>
}

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
    if (ids.length === 0) return []

    // Ordered by id rather than left to the planner: a read whose order depends on the
    // physical layout is a test that passes until it does not.
    const rows = await db
      .select()
      .from(items)
      .where(inArray(items.id, [...ids]))
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
  }
}
