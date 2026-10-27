import { asc, inArray, like, sql } from 'drizzle-orm'
import type { Conn } from './index'
import { receiptMissParts, receiptMisses, receiptReasonDays } from './schema'
import { yerevanDay } from './yerevan-week'

/** One count of `receipt_reason_days` summed over a window (MOL-309). */
export interface ReasonCount {
  readonly reader: 'model' | 'ocr'
  readonly country: string
  readonly scope: 'read' | 'receipt' | 'line'
  readonly reason: string
  readonly n: number
}

/** A receipt kept for the review (MOL-309): what was read, why, and its photo. */
export interface KeptMiss {
  readonly receipt: string
  /** «Переснять» replaced its receipt: the review stays past it (MOL-309, В-6 «а»). */
  readonly retakenAt: Date | null
  readonly readAt: Date
  readonly keepUntil: Date
  readonly readerVersion: string
  readonly reasons: {
    readonly receipt: string | null
    readonly lines: readonly (string | null)[]
    readonly partly?: boolean
  }
  readonly reading: unknown
  readonly parts: readonly { readonly position: number; readonly photo: Buffer }[]
}

/** Which receipts kept for the review to let go: one by its id's start, or every one read before a day. */
export type MissesToForget = { readonly id: string } | { readonly readBefore: string }

/** A dry run's rollback: what would have gone, gone nowhere. */
class DryRun extends Error {
  constructor(readonly ids: readonly string[]) {
    super('dry run')
  }
}

export interface ReceiptMissesRepository {
  /** The reasons of the days `from` to `to`, both in whole, by reader, country, scope and reason. */
  reasons(from: string, to: string): Promise<readonly ReasonCount[]>
  /** The receipts kept whose id starts so; more than one says the start is too short. */
  kept(idStart: string): Promise<readonly KeptMiss[]>
  /** The receipts kept for the review now, by their ids: what a copy under the root may still stand for. */
  keptIds(): Promise<readonly string[]>
  /** Lets the receipts go, or — a dry run — says which would go, in a transaction rolled back. */
  forget(which: MissesToForget, dryRun: boolean): Promise<readonly string[]>
}

/**
 * The developer's side of receipts read not whole (MOL-309), for `dist/receipt-misses.js`: the reasons by day,
 * one receipt kept for the review with its photo, and letting go what the fortnightly review (MOL-310) took.
 */
export function createReceiptMissesRepository(db: Conn): ReceiptMissesRepository {
  return {
    async reasons(from, to) {
      const rows = await db
        .select({
          reader: receiptReasonDays.reader,
          country: receiptReasonDays.country,
          scope: receiptReasonDays.scope,
          reason: receiptReasonDays.reason,
          n: sql<number>`sum(${receiptReasonDays.n})::int`,
        })
        .from(receiptReasonDays)
        .where(sql`${receiptReasonDays.day} between ${from}::date and ${to}::date`)
        .groupBy(
          receiptReasonDays.reader,
          receiptReasonDays.country,
          receiptReasonDays.scope,
          receiptReasonDays.reason,
        )
      return rows
    },

    async kept(idStart) {
      const misses = await db
        .select()
        .from(receiptMisses)
        .where(like(sql`${receiptMisses.receipt}::text`, `${idStart.toLowerCase()}%`))
        .orderBy(asc(receiptMisses.readAt))
      if (misses.length === 0) return []
      const parts = await db
        .select()
        .from(receiptMissParts)
        .where(
          inArray(
            receiptMissParts.receipt,
            misses.map((miss) => miss.receipt),
          ),
        )
        .orderBy(asc(receiptMissParts.position))
      return misses.map((miss) => ({
        receipt: miss.receipt,
        retakenAt: miss.retakenAt,
        readAt: miss.readAt,
        keepUntil: miss.keepUntil,
        readerVersion: miss.readerVersion,
        reasons: miss.reasons,
        reading: miss.reading,
        parts: parts
          .filter((part) => part.receipt === miss.receipt)
          .map(({ position, photo }) => ({ position, photo })),
      }))
    },

    async keptIds() {
      const rows = await db.select({ receipt: receiptMisses.receipt }).from(receiptMisses)
      return rows.map((row) => row.receipt)
    },

    async forget(which, dryRun) {
      try {
        return await db.transaction(async (tx) => {
          const gone = await tx
            .delete(receiptMisses)
            .where(
              'id' in which
                ? like(sql`${receiptMisses.receipt}::text`, `${which.id.toLowerCase()}%`)
                : // the day in Yerevan, as every day of a receipt's
                  sql`${yerevanDay(receiptMisses.readAt)} < ${which.readBefore}::date`,
            )
            .returning({ id: receiptMisses.receipt })
          const ids = gone.map((row) => row.id)
          if (dryRun) throw new DryRun(ids)
          return ids
        })
      } catch (error) {
        if (error instanceof DryRun) return error.ids
        throw error
      }
    },
  }
}
