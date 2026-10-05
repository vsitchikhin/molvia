import { randomUUID } from 'node:crypto'
import {
  DomainError,
  ERROR,
  addMoney,
  geographyAllowed,
  latestDay,
  nameIdentity,
  receiptDigits,
  receiptMomentOf,
  recordedSums,
  settingsCityOf,
  storeMemoryWords,
  toSearchKey,
} from '@molvia/model'
import type {
  Actor,
  Money,
  ReceiptRecordBody,
  ReceiptRecorded,
  ReceiptSettled,
} from '@molvia/model'
import type { ReceiptEdits, StoredReceiptLine } from '@/db/receipts-repository'
import type { MemoryWord } from '@/db/store-memory-repository'
import type { Transact } from '@/db/unit-of-work'
import { shownLines } from './receipts'
import type { ShownLines } from './receipts'
import { tripRateOn } from './start-trip'
import type { Today } from './today'

type RecordedLine = Extract<ReceiptRecordBody['lines'][number], { skip: false }>

const sameMoney = (a: Money | null, b: Money | null) =>
  a === null || b === null ? a === b : a.minor === b.minor && a.currency === b.currency

const sameQuantity = (a: StoredReceiptLine['quantity'], b: StoredReceiptLine['quantity']) =>
  a === null || b === null ? a === b : a.milli === b.milli && a.unit === b.unit

/**
 * A line recorded as it was read (В-4): it added up, and the person changed neither its quantity nor
 * what was paid. Its cut-out rows keep the text read as their confirmed text; its shelf price is what
 * the memory keeps.
 */
function asRead(stored: StoredReceiptLine, line: RecordedLine): boolean {
  return (
    stored.settled &&
    sameQuantity(line.quantity, stored.quantity) &&
    sameMoney(line.amount, stored.sum)
  )
}

/**
 * What the person put right (MOL-222, Р-6): «не записывать», another item, the quantity or the sum, a
 * line counted once however many of them; and the total, an edit of the receipt and never of its lines
 * (review 2). The items and the figures are the phone's word (`body.edited`): only the phone knows what
 * its review showed — the shops' memory may have learnt meanwhile from another record (adversarial А6)
 * — and a number of the measure is no money the server must work out itself. A phone of an earlier
 * build sends none: then each line is compared with the review as it would show it now, under the total
 * the phone sends — a total put right moves the sums of the lines it confirms (В-5), and those moved no
 * line. A new item kept new under another name is no edit there: the reading gave no name to correct.
 */
function editsOf(
  body: ReceiptRecordBody,
  stored: readonly StoredReceiptLine[],
  shown: ShownLines,
  total: Money | null,
): ReceiptEdits {
  const recorded = new Set(
    body.lines
      .filter((line) => !line.skip && stored[line.position] !== undefined)
      .map((l) => l.position),
  )
  const skipped = body.lines.filter((line) => line.skip).length
  let item: Set<number>
  let figures: Set<number>
  if (body.edited !== undefined) {
    // positions of lines recorded only: a skipped line is put right as «не записывать» already
    item = new Set(body.edited.item.filter((position) => recorded.has(position)))
    figures = new Set(body.edited.figures.filter((position) => recorded.has(position)))
  } else {
    item = new Set()
    figures = new Set()
    for (const line of body.lines) {
      const read = stored[line.position]
      if (line.skip || read === undefined) continue
      const was = shown.itemIds[line.position] ?? null
      if ('id' in line.item ? line.item.id !== was : was !== null) item.add(line.position)
      if (
        !sameQuantity(line.quantity, read.quantity) ||
        !sameMoney(line.amount, shown.amounts[line.position] ?? null)
      ) {
        figures.add(line.position)
      }
    }
  }
  const edited = new Set([...item, ...figures]).size + skipped
  return {
    lines: body.lines.length,
    edited,
    skipped,
    item: item.size,
    figures: figures.size,
    // the total the review showed, opened and saved as it was, is a check, not an edit (review 10)
    totalCorrected: body.total !== undefined && !sameMoney(body.total, total),
  }
}

/**
 * The money of the trip (MOL-126 Т-10, В-3; В-5 of the review): the total the phone sent — the printed
 * one, or the person's correction of what OCR misread; without it the printed total where it is not
 * below the lines — what was paid, the lines left out and those OCR lost included, while a lost line
 * only ever raises a total, so one below the lines was misread — else the sum of every line: a recorded
 * one at what the person settled on, one left out at what it would have been recorded at (В-5). `null`
 * when nothing is known: the trip then counts its prices (MOL-78).
 */
function receiptMoney(
  printed: Money | null,
  stored: readonly StoredReceiptLine[],
  body: ReceiptRecordBody,
  currency: Money['currency'],
): Money | null {
  if (body.total !== undefined) {
    // the receipt's currency is printed on it: a total in another is the phone's mistake (Р2-В2)
    if (body.total.currency !== currency) throw new DomainError(ERROR.CURRENCY_MISMATCH)
    return body.total
  }
  const digits = receiptDigits(currency, [
    printed,
    ...stored.flatMap((line) => [line.price, line.sum, line.discount]),
  ])
  const left = recordedSums(stored, printed, digits)
  let sum: Money | null = { minor: 0n, currency }
  for (const line of body.lines) {
    const amount = line.skip ? (left[line.position] ?? null) : line.amount
    // `addMoney` holds the column's bound: lines each within it may add up past it (round 3, Р3-В1),
    // which is `error.invalid_amount`, not a 500 from the table
    sum = sum === null || amount?.currency !== currency ? null : addMoney(sum, amount)
  }
  const lines = sum !== null && sum.minor > 0n ? sum : null
  if (printed !== null && printed.minor > 0n && (lines === null || printed.minor >= lines.minor)) {
    return printed
  }
  return lines
}

/**
 * «Записать» (MOL-126): the receipt, as the phone holds it, written in one go — a trip finished on the
 * receipt's day at the rate of that day (Т-9), its purchases with their own sums, new items by the rules
 * of MOL-12, the shop's memory taught, the photo gone, the
 * rows of the lines recorded as read confirmed for the reader's retraining (В-4). The server works out
 * every figure itself; the phone's are not trusted.
 *
 * Sent again with the same trip — the same answer; with another — a 409. The same receipt recorded
 * before, its purchases still there — `error.receipt_recorded_before`.
 */
export async function recordReceipt(
  transact: Transact,
  actor: Actor & Today,
  id: string,
  body: ReceiptRecordBody,
  now: Date = new Date(),
): Promise<ReceiptRecorded> {
  return transact(async (repositories) => {
    const { receipts, places, items, trips, expenses, storeMemory } = repositories
    // the owner first, then the receipt (the plan's order): two shots of one receipt recorded at once
    // meet here, and the second sees the first recorded (review 7, В3)
    await trips.lockOwner(actor.id)
    const held = await receipts.lockForRecord(actor.id, id)
    if (held === null) throw new DomainError(ERROR.NOT_FOUND)
    const answer = async (tripId: string): Promise<ReceiptRecorded> => {
      const found = await receipts.one(actor.id, held.id)
      if (found === null) throw new DomainError(ERROR.NOT_FOUND)
      return { receipt: found.receipt, tripId }
    }
    // recorded: the same trip again is the same answer while it is there; a trip marked removed may
    // still come back with «Вернуть»; one removed for good leaves the receipt to be recorded again
    if (held.tripId !== null) {
      if (held.tripId === body.tripId && held.tripAlive) return answer(body.tripId)
      throw new DomainError(ERROR.CONFLICT)
    }
    if (held.status !== 'parsed' && held.status !== 'recorded') {
      throw new DomainError(ERROR.RECEIPT_NOT_READY)
    }
    if (held.tin !== null && held.receiptNo !== null) {
      const twin = await receipts.recordedTwin(actor.id, held.tin, held.receiptNo, held.id)
      if (twin !== null) throw new DomainError(ERROR.RECEIPT_RECORDED_BEFORE)
    }

    // every line of the receipt once: a phone holding another reading of it is told so
    const positions = body.lines.map((line) => line.position).sort((a, b) => a - b)
    if (positions.length !== held.lines.length || positions.some((position, i) => position !== i)) {
      throw new DomainError(ERROR.CONFLICT)
    }
    if (body.purchasedOn > latestDay(now)) throw new DomainError(ERROR.RECEIPT_IN_FUTURE)

    const place =
      'id' in body.place
        ? await places.byId(body.place.id)
        : geographyAllowed({ country: held.country, city: body.place.city }, actor)
          ? await places.ensure({
              kind: 'store',
              name: body.place.name,
              country: held.country,
              city: body.place.city,
            })
          : null
    // a place by its id is held to the receipt's geography as a new one is (MOL-65): a shared table
    // must not take an Armenian receipt into a shop of another country or a city not offered
    if (
      place?.country !== held.country ||
      !geographyAllowed(
        { country: place.country, city: settingsCityOf(place.city) ?? place.city },
        actor,
      )
    ) {
      throw new DomainError(ERROR.CONFLICT)
    }

    // read before the memory is taught by this very record, and under the total the phone sends: the
    // review it showed — the earlier build's measure, when the phone does not say what it put right
    const shown = await shownLines(
      repositories,
      actor.id,
      held.tin,
      held.lines,
      body.total ?? held.total,
      held.currency,
    )

    const recorded = body.lines
      .filter((line): line is RecordedLine => !line.skip)
      .sort((a, b) => a.position - b.position)
    const money = receiptMoney(held.total, held.lines, body, held.currency)
    // a trip with no money and no purchase is an empty row of «Деньги»: a receipt with no items needs
    // its total, read or typed (MOL-227, Р-4)
    if (money === null && recorded.length === 0) {
      throw new DomainError(ERROR.RECEIPT_TOTAL_REQUIRED)
    }
    const chosen = [
      ...new Set(recorded.flatMap((line) => ('id' in line.item ? [line.item.id] : []))),
    ]
    if ((await items.byIds(chosen)).length !== chosen.length) throw new DomainError(ERROR.CONFLICT)

    const snapshot = await tripRateOn(
      repositories,
      actor,
      { incomeCurrency: actor.incomeCurrency, spendCurrency: held.currency },
      body.purchasedOn,
    )
    const trip = await trips.recordFinished(
      actor.id,
      {
        id: body.tripId,
        placeId: place.id,
        day: body.purchasedOn,
        deviceAt:
          held.printedOn === body.purchasedOn
            ? receiptMomentOf(body.purchasedOn, held.printedTime, held.country)
            : null,
      },
      held.currency,
      snapshot,
      money,
    )

    // new items before the purchases, in the order of their names: each name is locked to the end of
    // the transaction, and two records of the same names in two orders would otherwise deadlock
    const newItems = new Map<string, string>()
    // one item a name, spelt as its first line spells it
    const named = new Map<string, { name: string; line: RecordedLine }>()
    for (const line of recorded) {
      if ('name' in line.item && !named.has(nameIdentity(line.item.name))) {
        named.set(nameIdentity(line.item.name), { name: line.item.name, line })
      }
    }
    const toCreate = [...named.entries()].sort(([a], [b]) => {
      const [keyA, keyB] = [toSearchKey(a), toSearchKey(b)]
      return keyA < keyB ? -1 : keyA > keyB ? 1 : a < b ? -1 : a > b ? 1 : 0
    })
    for (const [identity, { name, line }] of toCreate) {
      const proposal = await items.createUnlessNamed(
        { kind: 'product', name, barcodes: [], defaultUnit: line.quantity?.unit ?? 'piece' },
        actor.id,
      )
      // the item is made with no codes, so none of them can be another item's
      if ('taken' in proposal) throw new DomainError(ERROR.CONFLICT)
      newItems.set(identity, proposal.item.id)
    }

    const written: { position: number; expenseId: string }[] = []
    const words: MemoryWord[] = []
    const confirmed: number[] = []
    for (const line of recorded) {
      const stored = held.lines[line.position]
      if (stored === undefined) throw new DomainError(ERROR.CONFLICT)
      const itemId = 'id' in line.item ? line.item.id : newItems.get(nameIdentity(line.item.name))
      if (itemId === undefined) throw new Error('a new item was not made before its purchase')
      const { expense } = await expenses.add(actor.id, {
        id: randomUUID(),
        tripId: trip.id,
        itemId,
        ...(line.quantity === null ? {} : { quantity: line.quantity }),
        ...(line.amount === null ? {} : { amount: line.amount }),
      })
      written.push({ position: line.position, expenseId: expense.id })
      const read = asRead(stored, line)
      if (read) confirmed.push(line.position)
      for (const word of storeMemoryWords(stored)) {
        words.push({ ...word, itemId, price: read ? stored.price : null })
      }
    }
    if (held.tin !== null) await storeMemory.remember(actor.id, held.tin, words)
    await receipts.markRecorded(held.id, {
      tripId: trip.id,
      expenses: written,
      confirmed,
      edits: editsOf(body, held.lines, shown, held.total),
      // recorded again once its trip was removed for good: counted the first time only (review 7)
      counted: held.status !== 'recorded',
    })
    return answer(trip.id)
  })
}

/**
 * «Отменить запись» asks this before it lets a begun record go (MOL-169, adversarial Г1): the phone
 * gives a send up after its timeout, and the server finishes it all the same. Read under the owner's
 * lock and the receipt's row, taken in the order «Записать» takes them, a record already in its
 * transaction is waited for and read as done, never as not yet. The answer is the trip it was recorded
 * as — the review goes there on it alone, with no second read to fail (round 4, Д1) — or none. 404 for
 * a receipt not the person's.
 */
export function receiptSettled(
  transact: Transact,
  actor: Actor,
  id: string,
): Promise<ReceiptSettled> {
  return transact(async ({ trips, receipts }) => {
    await trips.lockOwner(actor.id)
    const held = await receipts.lockForRecord(actor.id, id)
    if (held === null) throw new DomainError(ERROR.NOT_FOUND)
    return { tripId: held.tripId }
  })
}
