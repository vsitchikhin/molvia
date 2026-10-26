import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm'
import { nameIdentity, toSearchKey } from '@molvia/model'
import type { ReceiptCountry } from '@molvia/model'
import type { Conn } from './index'
import { lockItemKey } from './items-repository'
import { expenses, itemEmbeddings, items, receiptLines, receipts } from './schema'

/** An item a receipt's record made, and the name it takes now. */
export interface RenamedItem {
  readonly from: string
  readonly to: string
}

export interface RenameReport {
  readonly renamed: readonly RenamedItem[]
  /** The name another item holds already: left as it was, for the owner to look at. */
  readonly taken: readonly RenamedItem[]
}

/** The name a line would propose today, or none. */
export type LineNamer = (printed: string, country: ReceiptCountry) => string | null

export interface RenameRepository {
  /**
   * Gives the items recorded from receipts before MOL-261 the name a line proposes now (owner's В-3 «а»), in one
   * transaction: an item only where that very record made it, by that person, under the name the line proposed —
   * one the person named themselves stays theirs — and not merged since. A name another item holds is not taken:
   * the two would be one item, which is the night's to decide. The key is the name's, the vector goes, so the
   * API's writer reads the name again. A second run finds nothing. A dry run is the real run, rolled back.
   */
  rename(options: { readonly dryRun: boolean; readonly nameOf: LineNamer }): Promise<RenameReport>
}

class DryRun extends Error {
  constructor(readonly report: RenameReport) {
    super('dry run')
  }
}

export function createRenameRepository(db: Conn): RenameRepository {
  return {
    async rename({ dryRun, nameOf }) {
      try {
        return await db.transaction(async (tx) => {
          const rows = await tx
            .select({
              country: receipts.country,
              actorId: receipts.actorId,
              recordedAt: receipts.recordedAt,
              printed: receiptLines.printed,
              proposed: receiptLines.translation,
              itemId: items.id,
              kind: items.kind,
              name: items.name,
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
                isNotNull(receiptLines.translation),
                isNull(items.mergedInto),
              ),
            )
            .orderBy(asc(receipts.recordedAt), asc(receipts.id), asc(receiptLines.position))
            .for('update', { of: items })

          const renamed: RenamedItem[] = []
          const taken: RenamedItem[] = []
          const seen = new Set<string>()
          for (const row of rows) {
            if (seen.has(row.itemId)) continue
            // made by this very record: an item's moment and the record's are one transaction's `now()`
            const made =
              row.itemBy === row.actorId &&
              row.recordedAt !== null &&
              row.itemAt.getTime() === row.recordedAt.getTime()
            if (!made || row.proposed === null) continue
            if (nameIdentity(row.name) !== nameIdentity(row.proposed)) continue
            seen.add(row.itemId)
            const to = nameOf(row.printed, row.country)
            if (to === null || nameIdentity(to) === nameIdentity(row.name)) continue

            const key = toSearchKey(to)
            await lockItemKey(tx, row.kind, key)
            const holders = await tx
              .select({ name: items.name })
              .from(items)
              .where(
                and(eq(items.kind, row.kind), eq(items.searchKey, key), ne(items.id, row.itemId)),
              )
            if (holders.some((holder) => nameIdentity(holder.name) === nameIdentity(to))) {
              taken.push({ from: row.name, to })
              continue
            }
            await tx.update(items).set({ name: to, searchKey: key }).where(eq(items.id, row.itemId))
            await tx.delete(itemEmbeddings).where(eq(itemEmbeddings.itemId, row.itemId))
            renamed.push({ from: row.name, to })
          }

          const report: RenameReport = { renamed, taken }
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
