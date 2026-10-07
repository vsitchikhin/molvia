import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  DomainError,
  ERROR,
  placeSchema,
  RECEIPT_CURRENCY,
  RECEIPT_KEEP_DAYS,
  RECEIPT_LINK_WAIT_HOURS,
  RECEIPT_READ_ATTEMPTS,
  RECEIPT_TELL_AFTER_SECONDS,
  RECEIPT_TELL_WITHIN_HOURS,
  RECEIPT_UNDO_MINUTES,
  receiptClockOf,
  serbianReceiptLink,
  withoutItems,
} from '@molvia/model'
import type {
  Currency,
  Money,
  Place,
  ReceiptBody,
  ReceiptFailure,
  ReceiptLinkBody,
  ReceiptSource,
  ReceiptVia,
  ReceiptHeard,
  ReceiptLayout,
  ReceiptLine,
  ReceiptParsedMatch,
  ReceiptPlace,
  ReceiptSummary,
  ReceiptCity,
  TelegramUserId,
  TripReceiptSource,
} from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, theRow } from './rows'
import {
  actors,
  expenses,
  places,
  receiptLineImages,
  receiptLines,
  receiptLinks,
  receiptDays,
  receiptParts,
  receipts,
  taxReceiptDays,
  trips,
} from './schema'
import { yerevanDay } from './yerevan-week'

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

/**
 * A receipt by its link taken to be asked of the tax office (MOL-232): whose, the link, when it
 * arrived — the two days it is asked for run from it — and the asks so far, this one included.
 */
export interface ClaimedLink {
  readonly id: string
  readonly actorId: string
  readonly country: ReceiptSummary['country']
  readonly language: ReceiptSummary['language']
  readonly link: string
  readonly attempts: number
}

/** What the reader made of the head of a receipt, or the tax office said of it (MOL-232). */
export interface ReceiptHead {
  readonly tin: string | null
  readonly printedOn: string | null
  readonly printedTime: string | null
  readonly receiptNo: string | null
  readonly totalMinor: bigint | null
  readonly balanced: boolean
  /** How a photo's lines were laid out; a receipt by its link has none. */
  readonly layout: ReceiptLayout | null
  /** The city of the settings its address prints (MOL-126, Р-6). */
  readonly city: ReceiptCity | null
  /** A Serbian seller's premises: its code and the shop's name (MOL-232); a photo's head reads none. */
  readonly shopUnit?: string | null
  readonly shop?: string | null
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
      /** The lines make up too little of the receipt (`readPartly`, MOL-222): counted, never stored. */
      readonly partly: boolean
      /** One for each line, in their order. */
      readonly bindings: readonly LineBinding[]
      readonly images: readonly LineImage[]
      /**
       * A receipt from the tax office (MOL-234): each line's code from its specification, in the lines'
       * order, and how the specification went — `skipped`, not asked for want of the person's share.
       */
      readonly codes?: readonly (string | null)[]
      readonly specification?: 'ok' | 'failed' | 'skipped'
    }
  | {
      readonly kind: 'failed'
      readonly failure: ReceiptFailure
      readonly readerVersion: string | null
      readonly head: ReceiptHead | null
      /** A receipt from the tax office whose journal holds no list: the office's answer, not ours (А7). */
      readonly journalEmpty?: boolean
    }

/** A line as stored: as read, and what the parse found it to be (MOL-126). */
export interface StoredReceiptLine extends ReceiptLine {
  readonly itemId: string | null
  /** `null` for a line read before MOL-126: nothing was looked for. */
  readonly match: ReceiptParsedMatch | null
  readonly translation: string | null
  /** The package's code the tax office's specification gave the line (MOL-234). */
  readonly gtin: string | null
}

/** A receipt as stored, with what the review is built from beside its summary. */
export interface StoredReceipt {
  readonly receipt: ReceiptSummary
  readonly currency: Currency
  readonly city: ReceiptCity | null
  /** The premises of a Serbian seller, where its place is looked for first (MOL-232, Р-7). */
  readonly shopUnit: string | null
  /** A photo read by our reader, or a Serbian receipt's link asked of the tax office (MOL-232). */
  readonly source: ReceiptSource
  /** How the person learned it was read (MOL-129); `null` — not yet, or not read. */
  readonly heard: ReceiptHeard | null
}

/**
 * A place a seller's receipts were recorded at (MOL-126): who said so — the person, how many people —
 * and when last. The place of a tax number is what recorded receipts say, never a column of the place:
 * one wrong choice of place would otherwise name it for everyone, for good.
 */
export interface TinPlace {
  readonly tin: string
  /** The premises the receipts were of, a Serbian seller's (MOL-232); `null` for a photo's. */
  readonly shopUnit: string | null
  readonly place: Place
  /** When the person last recorded this seller's receipt here; `null` — never. */
  readonly ownLatest: Date | null
  /** How many people recorded this seller's receipts here. */
  readonly voters: number
  readonly latest: Date
}

/** A receipt read that the bot is to tell of (MOL-129), with whose it is. */
export interface UntoldReceipt extends StoredReceipt {
  readonly actor: {
    readonly id: string
    readonly telegramUserId: TelegramUserId
    readonly country: string
    readonly city: string
  }
}

/** The same receipt — tax number and number — recorded before, its purchases not removed (Т-11). */
export interface RecordedTwin {
  readonly receiptId: string
  readonly tripId: string
  readonly recordedAt: Date
}

/** A receipt taken to be recorded (MOL-126): locked until the transaction ends. */
export interface ReceiptToRecord {
  readonly id: string
  readonly status: ReceiptSummary['status']
  /** A photo read by our reader, or a Serbian receipt's link asked of the tax office (MOL-232). */
  readonly source: ReceiptSource
  readonly country: ReceiptSummary['country']
  readonly currency: Currency
  readonly tin: string | null
  readonly receiptNo: string | null
  readonly printedOn: string | null
  readonly printedTime: string | null
  readonly total: Money | null
  readonly city: ReceiptCity | null
  /** The trip it was recorded as, until that trip is removed for good. */
  readonly tripId: string | null
  /** That trip is there and not marked removed. */
  readonly tripAlive: boolean
  readonly lines: StoredReceiptLine[]
}

/** What recording a receipt writes back to it (MOL-126). */
export interface RecordedReceipt {
  readonly tripId: string
  /** The purchase each recorded line became. */
  readonly expenses: readonly { readonly position: number; readonly expenseId: string }[]
  /** Lines recorded as read: their cut-out rows are confirmed, every other one goes (В-4). */
  readonly confirmed: readonly number[]
  /** What the person put right before recording, counted in `receipt_days` (MOL-222). */
  readonly edits: ReceiptEdits
  /**
   * Counted in `receipt_days` — or, of a receipt from the tax office, in `tax_receipt_days` (MOL-234):
   * the first record of the receipt, never one after its trip went.
   */
  readonly counted: boolean
  readonly source: ReceiptSource
  /** Codes of the lines bound to items at this record (MOL-234, В-2). */
  readonly codesWritten: number
}

/**
 * The lines of a receipt recorded and those the person put right against what the review showed: left
 * out, another item, the quantity or the sum changed. A line is edited once however many of the three.
 */
export interface ReceiptEdits {
  readonly lines: number
  readonly edited: number
  readonly skipped: number
  readonly item: number
  readonly figures: number
  /** The total was put right: one edit of the receipt (review 2). */
  readonly totalCorrected: boolean
}

/** What a reading or a record adds to its day of `receipt_days`, by column. */
type ReceiptDayCounts = Partial<Record<Exclude<keyof typeof receiptDays.$inferInsert, 'day'>, SQL>>
/** The same of `tax_receipt_days` (MOL-234). */
type TaxReceiptDayCounts = Partial<
  Record<Exclude<keyof typeof taxReceiptDays.$inferInsert, 'day'>, SQL | undefined>
>

/**
 * Adds to the row of `day` of a table of days (MOL-222), read from `source` as `login_days` is counted
 * (MOL-68): in the transaction of what it counts, the last statement of it, so what is rolled back is
 * not counted.
 */
async function addToDay(
  db: Conn,
  table: typeof receiptDays | typeof taxReceiptDays,
  counts: Readonly<Record<string, SQL | undefined>>,
  day: SQL,
  source: SQL,
) {
  const columns = table as unknown as Readonly<Record<string, AnyPgColumn>>
  const entries = Object.entries(counts).flatMap(([key, value]) => {
    const column = columns[key]
    if (column === undefined) throw new Error(`no column ${key} to count in`)
    return value === undefined ? [] : [{ name: sql.identifier(column.name), value }]
  })
  if (entries.length === 0) return
  const key = sql.identifier(table.day.name)
  await db.execute(sql`
    insert into ${table} (${key}, ${sql.join(
      entries.map((entry) => entry.name),
      sql`, `,
    )})
    select ${day}, ${sql.join(
      entries.map((entry) => entry.value),
      sql`, `,
    )} ${source}
    on conflict (${key}) do update set ${sql.join(
      entries.map(({ name }) => sql`${name} = ${table}.${name} + excluded.${name}`),
      sql`, `,
    )}`)
}

/** Adds to `receipt_days`: the reader's measure, photos only. */
const tally = (db: Conn, counts: ReceiptDayCounts, day: SQL, source: SQL = sql``) =>
  addToDay(db, receiptDays, counts, day, source)

/** Adds to `tax_receipt_days`: the receipts by their link (MOL-234). */
const tallyTax = (db: Conn, counts: TaxReceiptDayCounts, day: SQL, source: SQL = sql``) =>
  addToDay(db, taxReceiptDays, counts, day, source)

/** Today in Yerevan, by the database's clock: the day a reading ended on. */
const today = (): SQL => yerevanDay(sql`clock_timestamp()`)

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
  list(actorId: string): Promise<StoredReceipt[]>
  one(
    actorId: string,
    id: string,
  ): Promise<(StoredReceipt & { readonly lines: StoredReceiptLine[] }) | null>
  /**
   * The phone was handed these receipts read (MOL-129): nobody will be told of them in Telegram. The
   * first word stands — one the bot already told of stays `bot`, and a repeat moves no moment.
   */
  heardInApp(actorId: string, ids: readonly string[]): Promise<void>
  /**
   * «Чек разобран» (MOL-129): receipts read `RECEIPT_TELL_AFTER_SECONDS` to `RECEIPT_TELL_WITHIN_HOURS`
   * ago that no phone was handed, not removed, of someone who has neither blocked the bot
   * (`bot_blocked_at`, whatever the reminders say) nor turned these messages off — marked as told
   * by the bot in the same statement that picks them (at most once, MOL-101 Р-2), the oldest first.
   */
  claimUntold(limit: number): Promise<UntoldReceipt[]>
  /**
   * Whether the person turned «Сообщать, что чек разобран» off (MOL-129, В-2), and whether the bot is
   * blocked — which silences it whatever the switch says (review №1).
   */
  noticesOf(actorId: string): Promise<{ off: boolean; blocked: boolean }>
  /** «Сообщать, что чек разобран» on the tap; what is stored after it. */
  chooseNotices(actorId: string, off: boolean): Promise<{ off: boolean; blocked: boolean }>
  /** The owner's receipt, locked for recording: `null` for a missing, removed or someone else's one. */
  lockForRecord(actorId: string, id: string): Promise<ReceiptToRecord | null>
  /**
   * The receipt recorded (MOL-126): its trip and purchases, its photo deleted (Т-9 of MOL-125), the
   * rows cut out of the lines recorded as read confirmed with the text read, every other row deleted.
   */
  markRecorded(id: string, recorded: RecordedReceipt): Promise<void>
  /** The receipt a trip was recorded from, with each purchase's line as printed (MOL-126). */
  sourceOf(tripId: string): Promise<TripReceiptSource | null>
  /** Where these sellers' receipts were recorded, in a country, by anyone, the purchases still there. */
  placesOfTins(actorId: string, tins: readonly string[], country: string): Promise<TinPlace[]>
  /** The person's receipt of this tax number and number, recorded as purchases still there (Т-11). */
  recordedTwin(
    actorId: string,
    tin: string,
    receiptNo: string,
    except: string,
  ): Promise<RecordedTwin | null>
  /**
   * «Удалить чек»: a mark. A receipt recorded as purchases still there is refused (409): the trip is
   * dated, named «из чека» and guarded against a second record by this row (MOL-126) — it goes with
   * its trip.
   */
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
  /** Receipts by their link the last round did not finish asking about: queued again, the ask not counted. */
  requeueInterruptedLinks(): Promise<void>
  /** The item each recorded line of a receipt went to, by position (MOL-234, adversarial А2). */
  recordedItems(id: string): Promise<ReadonlyMap<number, string>>
  /**
   * The next receipt by its link whose ask is due, now `reading`; `null` for none. People in turn, the
   * one asked about least in the last hour first, as the reader's queue (MOL-232).
   */
  claimLink(): Promise<ClaimedLink | null>
  /** Not asked — over the limit: back as it was, the ask not counted. */
  releaseLink(id: string): Promise<void>
  /**
   * The tax office does not show it yet: asked again in `minutes`, or failed as `missing` once
   * `RECEIPT_LINK_WAIT_HOURS` have passed since it arrived — its link gone then (Р-2, Р-4).
   */
  askLater(id: string, minutes: number): Promise<'queued' | 'failed'>
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

// The purchases it was recorded as and their place, while they are there (MOL-126): a trip removed,
// even within its «Вернуть», is no record of the receipt.
const recorded = sql<{ tripId: string; place: ReceiptPlace } | null>`(
  select json_build_object(
    'tripId', t.id,
    'place', json_build_object('id', p.id, 'name', p.name, 'city', p.city, 'tin', ${receipts.tin}))
  from trips t join places p on p.id = t.place_id
  where t.id = ${receipts.tripId} and t.deleted_at is null)`

const summaryColumns = { row: receipts, received, lineCount, unsettled, recorded }

interface SummaryRow {
  row: typeof receipts.$inferSelect
  received: number
  lineCount: number
  unsettled: number
  recorded: { tripId: string; place: ReceiptPlace } | null
}

function toSummary({
  row,
  received: held,
  lineCount: lines,
  unsettled: off,
  recorded: trip,
}: SummaryRow): ReceiptSummary {
  // a head is what a reading found; a receipt failed before any reading has none (review А11)
  const read = [row.tin, row.printedOn, row.printedTime, row.receiptNo, row.shop].some(
    (v) => v !== null,
  )
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
          shop: row.shop,
        }
      : null,
    total: row.totalMinor === null ? null : { minor: row.totalMinor, currency: row.currency },
    balanced: row.balanced,
    lineCount: lines,
    unsettled: off,
    place: trip?.place ?? null,
    tripId: trip?.tripId ?? null,
  }
}

function toStored(found: SummaryRow): StoredReceipt {
  return {
    receipt: toSummary(found),
    currency: found.row.currency,
    city: found.row.city,
    shopUnit: found.row.shopUnit,
    source: found.row.source,
    heard: found.row.heard,
  }
}

function toLine(row: typeof receiptLines.$inferSelect, currency: Currency): StoredReceiptLine {
  const cash = (minor: bigint | null) => (minor === null ? null : { minor, currency })
  return {
    itemId: row.itemId,
    match: row.match,
    translation: row.translation,
    gtin: row.gtin,
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

/**
 * A receipt by its link as it is taken (MOL-232): straight into the tax office's queue, asked at once,
 * with what the link itself says — its total, its moment on Belgrade's clock and its number — as its
 * head. The body was checked at the door; a link that does not read here is a defect, not a refusal.
 */
function linkReceipt(body: ReceiptLinkBody) {
  const read = serbianReceiptLink(body.link)
  if (!read.ok) throw new Error(`a receipt's link passed the door and did not read: ${read.reason}`)
  const clock = receiptClockOf(read.at, body.country)
  const row = {
    status: 'queued' as const,
    source: 'tax' as const,
    parts: 0,
    queuedAt: sql`clock_timestamp()`,
    nextAttemptAt: sql`clock_timestamp()`,
    printedOn: clock.day,
    printedTime: clock.time,
    receiptNo: read.number,
    totalMinor: read.total.minor,
    // whether the camera missed is said only with how the link came (MOL-234, Р-3)
    via: body.via ?? null,
    qrMissed: body.via === undefined ? null : (body.missed ?? false),
  }
  return { link: read.link, row }
}

/** The column of `tax_receipt_days` a receipt's arrival is counted in (MOL-234, owner's В-3 «а»). */
function sentColumn(row: { via: ReceiptVia | null; qrMissed: boolean | null }) {
  if (row.via === null) return 'sentUnnamed'
  if (row.via === 'qr') return row.qrMissed === true ? 'sentQrMissed' : 'sentQr'
  return row.qrMissed === true ? 'sentPasteMissed' : 'sentPaste'
}

export function createReceiptRepository(db: Conn): ReceiptRepository {
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
              country: body.country,
              language: body.language,
              currency: RECEIPT_CURRENCY[body.country],
              capturedAt: body.capturedAt,
              ...('link' in body
                ? linkReceipt(body).row
                : { status: 'uploading', parts: body.parts }),
            })
            .onConflictDoNothing({ target: receipts.id })
            .returning({ id: receipts.id })
          if (inserted) {
            // the link in a table of its own, out of the nightly copy (adversarial А4)
            if ('link' in body) {
              const { link, row } = linkReceipt(body)
              await tx.insert(receiptLinks).values({ receiptId: body.id, link })
              // counted when the server takes it, and only then: a repeat is the same receipt
              await tallyTax(tx, { [sentColumn(row)]: sql`1` }, today())
            }
            return { receipt: await summaryOf(tx, body.id), created: true }
          }

          const [held] = await tx.select().from(receipts).where(eq(receipts.id, body.id)).limit(1)
          // every field the body names, the country too — there will be more than one (MOL-89); a link
          // by the receipt it names, since the link itself is gone once the receipt is read (MOL-232)
          const fields = ['country', 'language'] as const
          const same =
            held?.actorId === actorId &&
            held.deletedAt === null &&
            fields.every((field) => held[field] === body[field]) &&
            ('link' in body
              ? held.source === 'tax' &&
                held.receiptNo === linkReceipt(body).row.receiptNo &&
                held.via === linkReceipt(body).row.via &&
                held.qrMissed === linkReceipt(body).row.qrMissed
              : held.source === 'photo' && held.parts === body.parts) &&
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
      return rows.map(toStored)
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
      return { ...toStored(found), lines: lines.map((line) => toLine(line, found.row.currency)) }
    },

    async heardInApp(actorId, ids) {
      if (ids.length === 0) return
      await db
        .update(receipts)
        .set({ heard: 'app', heardAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(receipts.actorId, actorId),
            inArray(receipts.id, [...ids]),
            sql`${receipts.status} in ('parsed', 'failed') and ${receipts.heard} is null`,
          ),
        )
    },

    async claimUntold(limit) {
      return db.transaction(async (tx) => {
        // two claims at once take different rows (`skip locked`), and a phone's mark that lands first
        // leaves the row out: the update re-reads `heard` under the row's lock
        const told = await tx.execute<{ id: string }>(sql`
          update ${receipts} r set heard = 'bot', heard_at = clock_timestamp()
          from (
            select due.id from ${receipts} due join ${actors} a on a.id = due.actor_id
            where due.status in ('parsed', 'failed') and due.heard is null and due.deleted_at is null
              and due.read_at <= clock_timestamp() - make_interval(secs => ${RECEIPT_TELL_AFTER_SECONDS})
              and due.read_at > clock_timestamp() - make_interval(hours => ${RECEIPT_TELL_WITHIN_HOURS})
              and a.bot_blocked_at is null and not a.receipt_notices_off
            order by due.read_at, due.id
            limit ${limit}
            for update of due skip locked
          ) picked
          where r.id = picked.id and r.heard is null
          returning r.id`)
        const ids = told.map(({ id }) => id)
        if (ids.length === 0) return []
        const rows = await tx
          .select({
            ...summaryColumns,
            telegramUserId: actors.telegramUserId,
            actorCountry: actors.country,
            actorCity: actors.city,
          })
          .from(receipts)
          .innerJoin(actors, eq(actors.id, receipts.actorId))
          .where(inArray(receipts.id, ids))
          .orderBy(asc(receipts.readAt), asc(receipts.id))
        return rows.map((row) => ({
          ...toStored(row),
          actor: {
            id: row.row.actorId,
            telegramUserId: row.telegramUserId,
            country: row.actorCountry,
            city: row.actorCity,
          },
        }))
      })
    },

    async noticesOf(actorId) {
      const [row] = await db
        .select({ off: actors.receiptNoticesOff, blockedAt: actors.botBlockedAt })
        .from(actors)
        .where(eq(actors.id, actorId))
      return { off: row?.off ?? false, blocked: (row?.blockedAt ?? null) !== null }
    },

    async chooseNotices(actorId, off) {
      const [row] = await db
        .update(actors)
        .set({ receiptNoticesOff: off })
        .where(eq(actors.id, actorId))
        .returning({ off: actors.receiptNoticesOff, blockedAt: actors.botBlockedAt })
      return { off: row?.off ?? off, blocked: (row?.blockedAt ?? null) !== null }
    },

    async lockForRecord(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return null
      const [found] = await db
        .select({
          row: receipts,
          tripAlive: sql<boolean>`exists (select 1 from trips t where t.id = ${receipts.tripId} and t.deleted_at is null)`,
        })
        .from(receipts)
        .where(
          and(
            eq(receipts.id, own),
            eq(receipts.actorId, actorId),
            sql`${receipts.deletedAt} is null`,
          ),
        )
        .for('update', { of: receipts })
      if (found === undefined) return null
      const { row, tripAlive } = found
      const lines = await db
        .select()
        .from(receiptLines)
        .where(eq(receiptLines.receiptId, own))
        .orderBy(asc(receiptLines.position))
      return {
        id: row.id,
        status: row.status,
        source: row.source,
        country: row.country,
        currency: row.currency,
        tin: row.tin,
        receiptNo: row.receiptNo,
        printedOn: row.printedOn,
        printedTime: row.printedTime,
        total: row.totalMinor === null ? null : { minor: row.totalMinor, currency: row.currency },
        city: row.city,
        tripId: row.tripId,
        tripAlive,
        lines: lines.map((line) => toLine(line, row.currency)),
      }
    },

    async markRecorded(id, recorded) {
      await db
        .update(receipts)
        .set({ status: 'recorded', recordedAt: sql`clock_timestamp()`, tripId: recorded.tripId })
        .where(eq(receipts.id, id))
      for (const { position, expenseId } of recorded.expenses) {
        await db
          .update(receiptLines)
          .set({ expenseId })
          .where(and(eq(receiptLines.receiptId, id), eq(receiptLines.position, position)))
      }
      await db.delete(receiptParts).where(eq(receiptParts.receiptId, id))
      const confirmed = sql`${receiptLineImages.position} in (${sql.join(
        [-1, ...recorded.confirmed].map((position) => sql`${position}`),
        sql`, `,
      )})`
      await db
        .delete(receiptLineImages)
        .where(and(eq(receiptLineImages.receiptId, id), sql`not ${confirmed}`))
      await db
        .update(receiptLineImages)
        .set({
          confirmedText: sql`${receiptLineImages.readText}`,
          confirmedAt: sql`clock_timestamp()`,
        })
        .where(eq(receiptLineImages.receiptId, id))
      // how long from the server taking the receipt to its record: both the server's clock (Р-6)
      const took = sql`${receipts.recordedAt} - ${receipts.createdAt}`
      const within = (bound: string, below: string | null): SQL =>
        below === null
          ? sql`(${took} <= interval '${sql.raw(bound)}')::int`
          : sql`(${took} > interval '${sql.raw(below)}' and ${took} <= interval '${sql.raw(bound)}')::int`
      const { edits } = recorded
      if (!recorded.counted) return
      const counts = {
        recorded: sql`1`,
        lines: sql`${edits.lines}::int`,
        linesEdited: sql`${edits.edited}::int`,
        linesSkipped: sql`${edits.skipped}::int`,
        linesItem: sql`${edits.item}::int`,
        linesFigures: sql`${edits.figures}::int`,
        totalsCorrected: sql`${edits.totalCorrected ? 1 : 0}::int`,
        within5m: within('5 minutes', null),
        within15m: within('15 minutes', '5 minutes'),
        within1h: within('1 hour', '15 minutes'),
        within1d: within('1 day', '1 hour'),
        later: sql`(${took} > interval '1 day')::int`,
      }
      const day = yerevanDay(receipts.recordedAt)
      const source = sql`from ${receipts} where ${receipts.id} = ${id}`
      // a receipt from the tax office in a table of its own, with the codes bound (MOL-234)
      if (recorded.source === 'tax') {
        await tallyTax(
          db,
          { ...counts, codesWritten: sql`${recorded.codesWritten}::int` },
          day,
          source,
        )
      } else await tally(db, counts, day, source)
    },

    async sourceOf(tripId) {
      const [receipt] = await db
        .select({ id: receipts.id, currency: receipts.currency })
        .from(receipts)
        .where(eq(receipts.tripId, tripId))
        .limit(1)
      if (receipt === undefined) return null
      const lines = await db
        .select({
          expenseId: receiptLines.expenseId,
          printed: receiptLines.printed,
          discountMinor: receiptLines.discountMinor,
        })
        .from(receiptLines)
        .where(
          and(eq(receiptLines.receiptId, receipt.id), sql`${receiptLines.expenseId} is not null`),
        )
      return {
        receiptId: receipt.id,
        lines: new Map(
          lines.flatMap((line) =>
            line.expenseId === null
              ? []
              : [
                  [
                    line.expenseId,
                    {
                      printed: line.printed,
                      // a discount of nothing is no discount
                      discount:
                        line.discountMinor === null || line.discountMinor === 0n
                          ? null
                          : { minor: line.discountMinor, currency: receipt.currency },
                    },
                  ] as const,
                ],
          ),
        ),
      }
    },

    async placesOfTins(actorId, tins, country) {
      if (tins.length === 0) return []
      const rows = await db.execute<{
        tin: string
        shop_unit: string | null
        id: string
        kind: Place['kind']
        name: string
        country: string
        city: string
        created_at: Date
        own_latest: Date | null
        voters: number
        latest: Date
      }>(sql`
        select r.tin, r.shop_unit, p.id, p.kind, p.name, p.country, p.city, p.created_at,
          max(r.recorded_at) filter (where r.actor_id = ${actorId}) as own_latest,
          count(distinct r.actor_id)::int as voters,
          max(r.recorded_at) as latest
        from ${receipts} r
        join ${trips} t on t.id = r.trip_id and t.deleted_at is null
        join ${places} p on p.id = t.place_id
        where r.status = 'recorded' and p.country = ${country}
          and r.tin in (${sql.join(
            tins.map((tin) => sql`${tin}`),
            sql`, `,
          )})
        group by r.tin, r.shop_unit, p.id`)
      return rows.map((row) => ({
        tin: row.tin,
        shopUnit: row.shop_unit,
        place: placeSchema.parse({
          id: row.id,
          kind: row.kind,
          name: row.name,
          country: row.country,
          city: row.city,
          createdAt: new Date(row.created_at),
        }),
        ownLatest: row.own_latest === null ? null : new Date(row.own_latest),
        voters: row.voters,
        latest: new Date(row.latest),
      }))
    },

    async recordedTwin(actorId, tin, receiptNo, except) {
      const [twin] = await db
        .select({
          receiptId: receipts.id,
          tripId: trips.id,
          recordedAt: sql<Date>`${receipts.recordedAt}`.mapWith(receipts.recordedAt),
        })
        .from(receipts)
        .innerJoin(trips, and(eq(trips.id, receipts.tripId), sql`${trips.deletedAt} is null`))
        .where(
          and(
            eq(receipts.actorId, actorId),
            eq(receipts.tin, tin),
            eq(receipts.receiptNo, receiptNo),
            sql`${receipts.id} <> ${except}`,
            eq(receipts.status, 'recorded'),
          ),
        )
        .orderBy(asc(receipts.recordedAt))
        .limit(1)
      return twin ?? null
    },

    async remove(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return
      await db.transaction(async (tx) => {
        // under the row's lock, as «Записать» takes it: a record committed while this waited is seen
        // (round 2, Р2-В1), and a receipt just recorded is not marked away from under its trip
        const [held] = await tx
          .select({ tripId: receipts.tripId })
          .from(receipts)
          .where(
            and(
              eq(receipts.id, own),
              eq(receipts.actorId, actorId),
              sql`${receipts.deletedAt} is null`,
            ),
          )
          .for('update')
        if (held === undefined) return
        if (held.tripId !== null) throw new DomainError(ERROR.CONFLICT)
        await tx
          .update(receipts)
          .set({ deletedAt: sql`clock_timestamp()` })
          .where(eq(receipts.id, own))
      })
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
      await db.transaction(async (tx) => {
        const moved = await tx
          .update(receipts)
          .set({
            status: sql`case when ${receipts.attempts} >= ${RECEIPT_READ_ATTEMPTS} then 'failed' else 'queued' end`,
            failure: sql`case when ${receipts.attempts} >= ${RECEIPT_READ_ATTEMPTS} then 'unreadable' end`,
            readAt: sql`case when ${receipts.attempts} >= ${RECEIPT_READ_ATTEMPTS} then clock_timestamp() end`,
          })
          // the reader's own: a receipt by its link has no reading to begin again (MOL-232)
          .where(and(eq(receipts.status, 'reading'), eq(receipts.source, 'photo')))
          .returning({ status: receipts.status })
        const failed = moved.filter((row) => row.status === 'failed').length
        if (failed > 0) await tally(tx, { unreadable: sql`${failed}::int` }, today())
      })
    },

    async claimNext() {
      return db.transaction(async (tx) => {
        // each person in turn: the one read least in the last hour first, then the oldest receipt —
        // a person's next receipt waits behind everyone else's first (review А10)
        const [next] = await tx.execute<{ id: string }>(sql`
          select waiting.id from ${receipts} waiting
          where waiting.status = 'queued' and waiting.source = 'photo' and waiting.deleted_at is null
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
      await db.transaction(async (tx) => {
        const [moved] = await tx
          .update(receipts)
          .set({
            status: sql`case when ${receipts.attempts} >= ${RECEIPT_READ_ATTEMPTS} then 'failed' else 'queued' end`,
            failure: sql`case when ${receipts.attempts} >= ${RECEIPT_READ_ATTEMPTS} then 'unreadable' end`,
            readAt: sql`case when ${receipts.attempts} >= ${RECEIPT_READ_ATTEMPTS} then clock_timestamp() end`,
            queuedAt: sql`clock_timestamp()`,
          })
          .where(and(eq(receipts.id, id), eq(receipts.status, 'reading')))
          .returning({ status: receipts.status })
        if (moved?.status === 'failed') await tally(tx, { unreadable: sql`1` }, today())
      })
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
            // no head read leaves the head there is: a photo's has none before its reading, and a
            // receipt by its link keeps what the link said — its day, number and total (review 2)
            ...(head === null
              ? {}
              : {
                  layout: head.layout,
                  tin: head.tin,
                  printedOn: head.printedOn,
                  printedTime: head.printedTime,
                  receiptNo: head.receiptNo,
                  totalMinor: head.totalMinor,
                  balanced: head.balanced,
                  city: head.city,
                  shopUnit: head.shopUnit ?? null,
                  shop: head.shop ?? null,
                }),
            nextAttemptAt: null,
          })
          .where(and(eq(receipts.id, id), eq(receipts.status, 'reading')))
          .returning({ id: receipts.id, source: receipts.source })
        if (done === undefined) return
        // read or failed, the link of a receipt by its QR code is no longer kept (MOL-232, Р-4)
        await tx.delete(receiptLinks).where(eq(receiptLinks.receiptId, id))
        // the measure of 0.2 is the reader's (MOL-222): a receipt from the tax office has nothing in it
        // to read wrong, and is counted in a table of its own (MOL-234)
        const tax = done.source === 'tax'
        // a reading is written whole: what an earlier one left goes first
        await tx.delete(receiptLines).where(eq(receiptLines.receiptId, id))
        await tx.delete(receiptLineImages).where(eq(receiptLineImages.receiptId, id))
        if (outcome.kind !== 'parsed') {
          if (tax) {
            const failed =
              outcome.failure === 'invalid'
                ? 'invalid'
                : outcome.journalEmpty
                  ? 'empty'
                  : 'unreadable'
            await tallyTax(tx, { [failed]: sql`1` }, today())
            return
          }
          const failed = outcome.failure === 'reshoot' ? 'reshoot' : 'unreadable'
          await tally(tx, { [failed]: sql`1` }, today())
          return
        }
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
              gtin: outcome.codes?.[position] ?? null,
            })),
          )
        }
        if (outcome.images.length > 0) {
          await tx
            .insert(receiptLineImages)
            .values(outcome.images.map((image) => ({ receiptId: id, ...image })))
        }
        // a section with no items is read whole, and no reading «in part» (MOL-227)
        const read = withoutItems({ status: outcome.kind, lineCount: outcome.lines.length })
          ? { noItems: sql`1` }
          : outcome.partly
            ? { readPartly: sql`1` }
            : { read: sql`1` }
        if (tax) {
          const coded = (outcome.codes ?? []).filter((code) => code !== null).length
          await tallyTax(
            tx,
            {
              read: sql`1`,
              specsOk: outcome.specification === 'ok' ? sql`1` : undefined,
              specsFailed: outcome.specification === 'failed' ? sql`1` : undefined,
              specsSkipped: outcome.specification === 'skipped' ? sql`1` : undefined,
              linesCoded: coded > 0 ? sql`${coded}::int` : undefined,
            },
            today(),
          )
        } else await tally(tx, read, today())
      })
    },

    async recordedItems(id) {
      const rows = await db
        .select({ position: receiptLines.position, itemId: expenses.itemId })
        .from(receiptLines)
        .innerJoin(expenses, eq(expenses.id, receiptLines.expenseId))
        .where(eq(receiptLines.receiptId, id))
      return new Map(rows.map((row) => [row.position, row.itemId]))
    },

    async requeueInterruptedLinks() {
      await db.transaction(async (tx) => {
        await tx
          .update(receipts)
          .set({
            status: 'queued',
            attempts: sql`greatest(${receipts.attempts} - 1, 0)`,
            nextAttemptAt: sql`clock_timestamp()`,
          })
          .where(and(eq(receipts.status, 'reading'), eq(receipts.source, 'tax')))
        // restored from a nightly copy, which holds no link (adversarial А4): nothing to ask with
        const lost = await tx
          .update(receipts)
          .set({
            status: 'failed',
            failure: 'unreadable',
            readAt: sql`clock_timestamp()`,
            nextAttemptAt: null,
          })
          .where(
            sql`${receipts.source} = 'tax' and ${receipts.status} = 'queued'
              and not exists (select 1 from ${receiptLinks} where ${receiptLinks.receiptId} = ${receipts.id})`,
          )
          .returning({ id: receipts.id })
        if (lost.length > 0) await tallyTax(tx, { unreadable: sql`${lost.length}::int` }, today())
      })
    },

    async claimLink() {
      return db.transaction(async (tx) => {
        const [next] = await tx.execute<{ id: string }>(sql`
          select waiting.id from ${receipts} waiting
          where waiting.source = 'tax' and waiting.status = 'queued' and waiting.deleted_at is null
            and waiting.next_attempt_at <= clock_timestamp()
          order by (
            select count(*) from ${receipts} served
            where served.actor_id = waiting.actor_id and served.source = 'tax'
              and served.reading_at > clock_timestamp() - interval '1 hour'
          ), waiting.next_attempt_at, waiting.id
          limit 1
          for update skip locked`)
        if (next === undefined) return null
        const [claimed] = await tx
          .update(receipts)
          .set({
            status: 'reading',
            readingAt: sql`clock_timestamp()`,
            attempts: sql`${receipts.attempts} + 1`,
          })
          .where(and(eq(receipts.id, next.id), eq(receipts.status, 'queued')))
          .returning({
            id: receipts.id,
            actorId: receipts.actorId,
            country: receipts.country,
            language: receipts.language,
            attempts: receipts.attempts,
          })
        if (claimed === undefined) return null
        const [held] = await tx
          .select({ link: receiptLinks.link })
          .from(receiptLinks)
          .where(eq(receiptLinks.receiptId, claimed.id))
        // a receipt that lost its link is failed before the next round asks (`requeueInterruptedLinks`)
        return held === undefined ? null : { ...claimed, link: held.link }
      })
    },

    async releaseLink(id) {
      await db
        .update(receipts)
        .set({ status: 'queued', attempts: sql`greatest(${receipts.attempts} - 1, 0)` })
        .where(and(eq(receipts.id, id), eq(receipts.status, 'reading')))
    },

    async askLater(id, minutes) {
      const over = sql`${receipts.createdAt} <= clock_timestamp() - make_interval(hours => ${RECEIPT_LINK_WAIT_HOURS})`
      return db.transaction(async (tx) => {
        const [moved] = await tx
          .update(receipts)
          .set({
            status: sql`case when ${over} then 'failed' else 'queued' end`,
            failure: sql`case when ${over} then 'missing' end`,
            readAt: sql`case when ${over} then clock_timestamp() end`,
            nextAttemptAt: sql`case when ${over} then null else clock_timestamp() + make_interval(mins => ${minutes}) end`,
          })
          .where(and(eq(receipts.id, id), eq(receipts.status, 'reading')))
          .returning({ status: receipts.status })
        if (moved?.status !== 'failed') return 'queued'
        // given up, the link is no longer kept (Р-4)
        await tx.delete(receiptLinks).where(eq(receiptLinks.receiptId, id))
        await tallyTax(tx, { missing: sql`1` }, today())
        return 'failed'
      })
    },
  }
}
