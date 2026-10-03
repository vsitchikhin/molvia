import { and, asc, desc, eq, sql } from 'drizzle-orm'
import {
  DomainError,
  ERROR,
  RECEIPT_CURRENCY,
  RECEIPT_KEEP_DAYS,
  RECEIPT_READ_ATTEMPTS,
  RECEIPT_UNDO_MINUTES,
} from '@molvia/model'
import type {
  Currency,
  ReceiptBody,
  ReceiptDetail,
  ReceiptFailure,
  ReceiptLine,
  ReceiptParsedMatch,
  ReceiptSummary,
  SettingsCity,
} from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn, Db } from './index'
import { idOrNull, theRow } from './rows'
import { receiptLineImages, receiptLines, receiptParts, receipts } from './schema'

export interface ReceiptPart {
  readonly photo: Buffer
  readonly width: number
  readonly height: number
}

/** A receipt taken from the queue to be read: where it was bought and its photo, part by part. */
export interface ClaimedReceipt {
  readonly id: string
  readonly actorId: string
  readonly country: ReceiptSummary['country']
  readonly language: ReceiptSummary['language']
  readonly parts: readonly { readonly position: number; readonly photo: Buffer }[]
}

/** What the reader made of the head of a receipt. */
export interface ReceiptHead {
  readonly tin: string | null
  readonly printedOn: string | null
  readonly printedTime: string | null
  readonly receiptNo: string | null
  readonly totalMinor: bigint | null
  readonly balanced: boolean
  readonly layout: 'card' | 'table'
  /** The city of the settings its address prints (MOL-126, Р-6). */
  readonly city: SettingsCity | null
}

/** What the parse found a line to be (MOL-126): an item and how, and the line word by word. */
export interface LineBinding {
  readonly itemId: string | null
  readonly match: ReceiptParsedMatch
  readonly translation: string | null
}

export interface LineImage {
  readonly position: number
  readonly piece: number
  readonly image: Buffer
  readonly readText: string
}

/** How a reading ended: laid out into lines, or failed with what could be read of the head. */
export type ReadOutcome =
  | {
      readonly kind: 'parsed'
      readonly readerVersion: string
      readonly head: ReceiptHead
      readonly lines: readonly ReceiptLine[]
      /** One for each line, in their order. */
      readonly bindings: readonly LineBinding[]
      readonly images: readonly LineImage[]
    }
  | {
      readonly kind: 'failed'
      readonly failure: ReceiptFailure
      readonly readerVersion: string | null
      readonly head: ReceiptHead | null
    }

export interface ReceiptRepository {
  /** «Отправить чек»: a new receipt, or the same one sent again; anything else under its id is a 409. */
  create(actorId: string, body: ReceiptBody): Promise<{ receipt: ReceiptSummary; created: boolean }>
  /**
   * A part of the photo: the same part again is the same write, another photo under its place is a
   * 409. The last part puts the receipt in the queue — `queued` says this write did.
   */
  putPart(
    actorId: string,
    id: string,
    position: number,
    part: ReceiptPart,
  ): Promise<{ receipt: ReceiptSummary; queued: boolean }>
  list(actorId: string): Promise<ReceiptSummary[]>
  one(actorId: string, id: string): Promise<ReceiptDetail | null>
  remove(actorId: string, id: string): Promise<void>
  /** «Вернуть»: `false` for anything that is not the owner's receipt removed within the window. */
  restore(actorId: string, id: string): Promise<boolean>
  /**
   * The minute timer's (П-8, В-3): a removal final after its ten minutes, a receipt not recorded
   * 28 days after it arrived, a recorded one's photo, a line cut out 28 days after it was confirmed.
   */
  purgeStale(): Promise<void>

  /** At boot: a reading the last process did not finish is begun again, or fails after its attempts. */
  requeueInterrupted(): Promise<void>
  /**
   * The next receipt for the reader, now `reading`; `null` for an empty queue. People in turn, the one
   * read least in the last hour first (review А10): fifty receipts of one person do not hold
   * another's behind them.
   */
  claimNext(): Promise<ClaimedReceipt | null>
  /** Back to the queue, its attempt not counted: the reader was not there, the receipt not at fault. */
  release(id: string): Promise<void>
  /**
   * The reader dropped this photo: its attempt counted, back to the end of the queue — or failed as
   * `unreadable` once it has had its attempts (`RECEIPT_READ_ATTEMPTS`).
   */
  retry(id: string): Promise<void>
  /**
   * The end of a reading. Written into a receipt removed meanwhile too — «Вернуть» brings it back
   * read; nothing happens to one no longer `reading`, or no longer there after the final purge.
   */
  finish(id: string, outcome: ReadOutcome): Promise<void>
}

const undoFrom = () => sql`clock_timestamp() - make_interval(mins => ${RECEIPT_UNDO_MINUTES})`

// The parts held and the lines read, beside the row: what «Покупки» shows of a receipt.
const received = sql<number>`(select count(*)::int from ${receiptParts} where ${receiptParts.receiptId} = ${receipts.id})`
const lineCount = sql<number>`(select count(*)::int from ${receiptLines} where ${receiptLines.receiptId} = ${receipts.id})`
const unsettled = sql<number>`(select count(*)::int from ${receiptLines} where ${receiptLines.receiptId} = ${receipts.id} and not ${receiptLines.settled})`

const summaryColumns = { row: receipts, received, lineCount, unsettled }

interface SummaryRow {
  row: typeof receipts.$inferSelect
  received: number
  lineCount: number
  unsettled: number
}

function toSummary({
  row,
  received: held,
  lineCount: lines,
  unsettled: off,
}: SummaryRow): ReceiptSummary {
  // a head is what a reading found; a receipt failed before any reading has none (review А11)
  const read = [row.tin, row.printedOn, row.printedTime, row.receiptNo].some((v) => v !== null)
  return {
    id: row.id,
    status: row.status,
    failure: row.failure,
    parts: row.parts,
    received: held,
    capturedAt: row.capturedAt,
    country: row.country,
    language: row.language,
    header: read
      ? {
          tin: row.tin,
          date: row.printedOn,
          time: row.printedTime,
          receiptNo: row.receiptNo,
        }
      : null,
    total: row.totalMinor === null ? null : { minor: row.totalMinor, currency: row.currency },
    balanced: row.balanced,
    lineCount: lines,
    unsettled: off,
  }
}

function toLine(row: typeof receiptLines.$inferSelect, currency: Currency): ReceiptLine {
  const cash = (minor: bigint | null) => (minor === null ? null : { minor, currency })
  return {
    printed: row.printed,
    hs: row.hs,
    sku: row.sku,
    quantity:
      row.qtyMilli === null || row.qtyUnit === null
        ? null
        : { milli: row.qtyMilli, unit: row.qtyUnit },
    price: cash(row.priceMinor),
    sum: cash(row.sumMinor),
    discount: cash(row.discountMinor),
    settled: row.settled,
  }
}

const capturedSame = (a: Date, b: Date) => a.getTime() === b.getTime()

export function createReceiptRepository(db: Db): ReceiptRepository {
  async function summaryOf(conn: Conn, id: string): Promise<ReceiptSummary> {
    const [found] = await conn
      .select(summaryColumns)
      .from(receipts)
      .where(eq(receipts.id, id))
      .limit(1)
    return toSummary(theRow(found, 'receipts'))
  }

  return {
    async create(actorId, body) {
      return translateFailures(() =>
        db.transaction(async (tx) => {
          // Past its ten minutes a removal is final whether or not the timer has come round: the same
          // name is then a new receipt, not a conflict — as a spending's (MOL-73).
          await tx
            .delete(receipts)
            .where(
              and(
                eq(receipts.id, body.id),
                eq(receipts.actorId, actorId),
                sql`${receipts.deletedAt} <= ${undoFrom()}`,
              ),
            )
          const [inserted] = await tx
            .insert(receipts)
            .values({
              id: body.id,
              actorId,
              status: 'uploading',
              parts: body.parts,
              country: body.country,
              language: body.language,
              currency: RECEIPT_CURRENCY[body.country],
              capturedAt: body.capturedAt,
            })
            .onConflictDoNothing({ target: receipts.id })
            .returning({ id: receipts.id })
          if (inserted) return { receipt: await summaryOf(tx, body.id), created: true }

          const [held] = await tx.select().from(receipts).where(eq(receipts.id, body.id)).limit(1)
          // every field the body names, the country too — there will be more than one (MOL-89)
          const fields = ['parts', 'country', 'language'] as const
          const same =
            held?.actorId === actorId &&
            held.deletedAt === null &&
            fields.every((field) => held[field] === body[field]) &&
            capturedSame(held.capturedAt, body.capturedAt)
          if (!same) throw new DomainError(ERROR.CONFLICT)
          return { receipt: await summaryOf(tx, body.id), created: false }
        }),
      )
    },

    async putPart(actorId, id, position, part) {
      const own = idOrNull(id)
      if (own === null) throw new DomainError(ERROR.NOT_FOUND)
      return translateFailures(() =>
        db.transaction(async (tx) => {
          const [held] = await tx
            .select()
            .from(receipts)
            .where(
              and(
                eq(receipts.id, own),
                eq(receipts.actorId, actorId),
                sql`${receipts.deletedAt} is null`,
              ),
            )
            .for('update')
          if (held === undefined || position > held.parts) throw new DomainError(ERROR.NOT_FOUND)

          const [existing] = await tx
            .select({ same: sql<boolean>`${receiptParts.photo} = ${part.photo}` })
            .from(receiptParts)
            .where(and(eq(receiptParts.receiptId, own), eq(receiptParts.position, position)))
          if (existing !== undefined) {
            // the queue sending a part twice; another photo in its place is another receipt (П-3)
            if (!existing.same) throw new DomainError(ERROR.CONFLICT)
            return { receipt: await summaryOf(tx, own), queued: false }
          }
          if (held.status !== 'uploading') throw new DomainError(ERROR.CONFLICT)

          await tx.insert(receiptParts).values({ receiptId: own, position, ...part })
          const [{ n } = { n: 0 }] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(receiptParts)
            .where(eq(receiptParts.receiptId, own))
          const whole = n === held.parts
          if (whole) {
            await tx
              .update(receipts)
              .set({ status: 'queued', queuedAt: sql`clock_timestamp()` })
              .where(eq(receipts.id, own))
          }
          return { receipt: await summaryOf(tx, own), queued: whole }
        }),
      )
    },

    async list(actorId) {
      const rows = await db
        .select(summaryColumns)
        .from(receipts)
        .where(and(eq(receipts.actorId, actorId), sql`${receipts.deletedAt} is null`))
        .orderBy(desc(receipts.createdAt), desc(receipts.id))
      return rows.map(toSummary)
    },

    async one(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return null
      const [found] = await db
        .select(summaryColumns)
        .from(receipts)
        .where(
          and(
            eq(receipts.id, own),
            eq(receipts.actorId, actorId),
            sql`${receipts.deletedAt} is null`,
          ),
        )
      if (found === undefined) return null
      const lines = await db
        .select()
        .from(receiptLines)
        .where(eq(receiptLines.receiptId, own))
        .orderBy(asc(receiptLines.position))
      return {
        receipt: toSummary(found),
        lines: lines.map((line) => toLine(line, found.row.currency)),
      }
    },

    async remove(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return
      await db
        .update(receipts)
        .set({ deletedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(receipts.id, own),
            eq(receipts.actorId, actorId),
            sql`${receipts.deletedAt} is null`,
          ),
        )
    },

    async restore(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return false
      const restored = await db
        .update(receipts)
        .set({ deletedAt: null })
        .where(
          and(
            eq(receipts.id, own),
            eq(receipts.actorId, actorId),
            // Past its time a removal is final even before the timer comes round.
            sql`(${receipts.deletedAt} is null or ${receipts.deletedAt} > ${undoFrom()})`,
          ),
        )
        .returning({ id: receipts.id })
      return restored.length > 0
    },

    async purgeStale() {
      await db.delete(receipts).where(sql`${receipts.deletedAt} <= ${undoFrom()}`)
      // Not recorded in its days, by the server's clock: the phone's moment of the shot may lie.
      await db
        .delete(receipts)
        .where(
          sql`${receipts.status} <> 'recorded' and ${receipts.createdAt} <= clock_timestamp() - make_interval(days => ${RECEIPT_KEEP_DAYS})`,
        )
      // A recorded receipt keeps no photo (В-4): recording deletes it (MOL-126), and this holds the
      // promise if a write ever leaves one behind.
      await db
        .delete(receiptParts)
        .where(
          sql`${receiptParts.receiptId} in (select ${receipts.id} from ${receipts} where ${receipts.status} = 'recorded')`,
        )
      await db
        .delete(receiptLineImages)
        .where(
          sql`${receiptLineImages.confirmedAt} <= clock_timestamp() - make_interval(days => ${RECEIPT_KEEP_DAYS})`,
        )
    },

    async requeueInterrupted() {
      await db
        .update(receipts)
        .set({
          status: sql`case when ${receipts.attempts} >= ${RECEIPT_READ_ATTEMPTS} then 'failed' else 'queued' end`,
          failure: sql`case when ${receipts.attempts} >= ${RECEIPT_READ_ATTEMPTS} then 'unreadable' end`,
          readAt: sql`case when ${receipts.attempts} >= ${RECEIPT_READ_ATTEMPTS} then clock_timestamp() end`,
        })
        .where(eq(receipts.status, 'reading'))
    },

    async claimNext() {
      return db.transaction(async (tx) => {
        // each person in turn: the one read least in the last hour first, then the oldest receipt —
        // a person's next receipt waits behind everyone else's first (review А10)
        const [next] = await tx.execute<{ id: string }>(sql`
          select waiting.id from ${receipts} waiting
          where waiting.status = 'queued' and waiting.deleted_at is null
          order by (
            select count(*) from ${receipts} served
            where served.actor_id = waiting.actor_id
              and served.reading_at > clock_timestamp() - interval '1 hour'
          ), waiting.queued_at, waiting.id
          limit 1`)
        if (next !== undefined) {
          // one runner reads, so the row is ours; the lock keeps a second process from it all the same
          const [locked] = await tx
            .select({ id: receipts.id })
            .from(receipts)
            .where(sql`${receipts.id} = ${next.id} and ${receipts.status} = 'queued'`)
            .for('update', { skipLocked: true })
          if (locked === undefined) return null
        }
        if (next === undefined) return null
        const [claimed] = await tx
          .update(receipts)
          .set({
            status: 'reading',
            readingAt: sql`clock_timestamp()`,
            attempts: sql`${receipts.attempts} + 1`,
          })
          .where(eq(receipts.id, next.id))
          .returning({
            id: receipts.id,
            actorId: receipts.actorId,
            country: receipts.country,
            language: receipts.language,
          })
        const parts = await tx
          .select({ position: receiptParts.position, photo: receiptParts.photo })
          .from(receiptParts)
          .where(eq(receiptParts.receiptId, next.id))
          .orderBy(asc(receiptParts.position))
        const row = theRow(claimed, 'receipts')
        return { ...row, parts }
      })
    },

    async release(id) {
      await db
        .update(receipts)
        .set({ status: 'queued', attempts: sql`greatest(${receipts.attempts} - 1, 0)` })
        .where(and(eq(receipts.id, id), eq(receipts.status, 'reading')))
    },

    async retry(id) {
      await db
        .update(receipts)
        .set({
          status: sql`case when ${receipts.attempts} >= ${RECEIPT_READ_ATTEMPTS} then 'failed' else 'queued' end`,
          failure: sql`case when ${receipts.attempts} >= ${RECEIPT_READ_ATTEMPTS} then 'unreadable' end`,
          readAt: sql`case when ${receipts.attempts} >= ${RECEIPT_READ_ATTEMPTS} then clock_timestamp() end`,
          queuedAt: sql`clock_timestamp()`,
        })
        .where(and(eq(receipts.id, id), eq(receipts.status, 'reading')))
    },

    async finish(id, outcome) {
      await db.transaction(async (tx) => {
        const head = outcome.head
        const [done] = await tx
          .update(receipts)
          .set({
            status: outcome.kind,
            failure: outcome.kind === 'failed' ? outcome.failure : null,
            readAt: sql`clock_timestamp()`,
            readerVersion: outcome.readerVersion,
            layout: head?.layout ?? null,
            tin: head?.tin ?? null,
            printedOn: head?.printedOn ?? null,
            printedTime: head?.printedTime ?? null,
            receiptNo: head?.receiptNo ?? null,
            totalMinor: head?.totalMinor ?? null,
            balanced: head?.balanced ?? false,
            city: head?.city ?? null,
          })
          .where(and(eq(receipts.id, id), eq(receipts.status, 'reading')))
          .returning({ id: receipts.id })
        if (done === undefined) return
        // a reading is written whole: what an earlier one left goes first
        await tx.delete(receiptLines).where(eq(receiptLines.receiptId, id))
        await tx.delete(receiptLineImages).where(eq(receiptLineImages.receiptId, id))
        if (outcome.kind !== 'parsed') return
        if (outcome.lines.length > 0) {
          await tx.insert(receiptLines).values(
            outcome.lines.map((line, position) => ({
              receiptId: id,
              position,
              printed: line.printed,
              hs: line.hs,
              sku: line.sku,
              qtyMilli: line.quantity?.milli ?? null,
              qtyUnit: line.quantity?.unit ?? null,
              priceMinor: line.price?.minor ?? null,
              sumMinor: line.sum?.minor ?? null,
              discountMinor: line.discount?.minor ?? null,
              settled: line.settled,
              itemId: outcome.bindings[position]?.itemId ?? null,
              match: outcome.bindings[position]?.match ?? null,
              translation: outcome.bindings[position]?.translation ?? null,
            })),
          )
        }
        if (outcome.images.length > 0) {
          await tx
            .insert(receiptLineImages)
            .values(outcome.images.map((image) => ({ receiptId: id, ...image })))
        }
      })
    },
  }
}
