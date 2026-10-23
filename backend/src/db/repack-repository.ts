import { and, asc, eq } from 'drizzle-orm'
import { linePack, packedQuantity } from '@molvia/model'
import type { BaseUnit, Quantity } from '@molvia/model'
import type { Conn } from './index'
import { expenses, items, receiptLines, receipts } from './schema'

/** A purchase recorded in the till's pieces that its line's package makes litres or kilograms of. */
export interface RepackedPurchase {
  readonly receiptId: string
  readonly printed: string
  readonly from: Quantity
  readonly to: Quantity
}

/** An item a record made of such a line, given the package's unit and one package as its usual quantity. */
export interface RepackedItem {
  readonly name: string
  readonly from: BaseUnit
  readonly to: Quantity
}

export interface RepackReport {
  readonly purchases: readonly RepackedPurchase[]
  readonly items: readonly RepackedItem[]
}

export interface RepackRepository {
  /**
   * Puts the purchases recorded from receipts before MOL-264 into the package their line prints (owner's В-3 «а»),
   * in one transaction: a purchase only while its quantity is still the till's pieces as read — one the person changed
   * stays theirs — and an item only where that very record made it, by this person, still in pieces with no usual
   * quantity. A second run finds nothing. A dry run is the real run, rolled back, as the seed's is.
   */
  repack(options: { readonly dryRun: boolean }): Promise<RepackReport>
}

class DryRun extends Error {
  constructor(readonly report: RepackReport) {
    super('dry run')
  }
}

export function createRepackRepository(db: Conn): RepackRepository {
  return {
    async repack({ dryRun }) {
      try {
        return await db.transaction(async (tx) => {
          const rows = await tx
            .select({
              receiptId: receipts.id,
              country: receipts.country,
              actorId: receipts.actorId,
              recordedAt: receipts.recordedAt,
              printed: receiptLines.printed,
              tillMilli: receiptLines.qtyMilli,
              expenseId: expenses.id,
              itemId: items.id,
              itemName: items.name,
              itemUnit: items.defaultUnit,
              itemTypical: items.typicalQtyMilli,
              itemBy: items.createdBy,
              itemAt: items.createdAt,
            })
            .from(receiptLines)
            .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
            .innerJoin(expenses, eq(expenses.id, receiptLines.expenseId))
            .innerJoin(items, eq(items.id, expenses.itemId))
            .where(
              and(
                eq(receipts.status, 'recorded'),
                eq(receiptLines.qtyUnit, 'piece'),
                eq(expenses.qtyUnit, 'piece'),
                eq(expenses.qtyMilli, receiptLines.qtyMilli),
              ),
            )
            .orderBy(asc(receipts.recordedAt), asc(receipts.id), asc(receiptLines.position))
            .for('update', { of: expenses })

          const purchases: RepackedPurchase[] = []
          const repacked: RepackedItem[] = []
          const seen = new Set<string>()
          for (const row of rows) {
            if (row.tillMilli === null) continue
            const till: Quantity = { milli: row.tillMilli, unit: 'piece' }
            const pack = linePack({ printed: row.printed, quantity: till }, row.country)
            const to = packedQuantity(till, pack)
            if (
              pack === null ||
              to === null ||
              (to.milli === till.milli && to.unit === till.unit)
            ) {
              continue
            }
            await tx
              .update(expenses)
              .set({ qtyMilli: to.milli, qtyUnit: to.unit })
              .where(eq(expenses.id, row.expenseId))
            purchases.push({ receiptId: row.receiptId, printed: row.printed, from: till, to })
            // made by this very record: an item's moment and the record's are one transaction's `now()`
            const made =
              row.itemBy === row.actorId &&
              row.recordedAt !== null &&
              row.itemAt.getTime() === row.recordedAt.getTime()
            if (
              seen.has(row.itemId) ||
              !made ||
              row.itemUnit !== 'piece' ||
              row.itemTypical !== null
            ) {
              continue
            }
            seen.add(row.itemId)
            repacked.push({ name: row.itemName, from: row.itemUnit, to: pack })
            await tx
              .update(items)
              .set({
                defaultUnit: pack.unit,
                typicalQtyMilli: pack.milli,
                typicalQtyUnit: pack.unit,
              })
              .where(eq(items.id, row.itemId))
          }

          const report: RepackReport = { purchases, items: repacked }
          if (dryRun) throw new DryRun(report)
          return report
        })
      } catch (error) {
        if (error instanceof DryRun) return error.report
        throw error
      }
    },
  }
}
