import { randomUUID } from 'node:crypto'
import {
  DomainError,
  ERROR,
  geographyAllowed,
  latestDay,
  receiptDigits,
  receiptMomentOf,
  recordedSums,
  storeMemoryWords,
} from '@molvia/model'
import type { Actor, Money, ReceiptRecordBody, ReceiptRecorded } from '@molvia/model'
import type { StoredReceiptLine } from '@/db/receipts-repository'
import type { MemoryWord } from '@/db/store-memory-repository'
import type { Transact } from '@/db/unit-of-work'
import { tripRateOn } from './start-trip'
import type { Today } from './today'

type RecordedLine = Extract<ReceiptRecordBody['lines'][number], { skip: false }>

const sameMoney = (a: Money | null, b: Money | null) =>
  a === null || b === null ? a === b : a.minor === b.minor && a.currency === b.currency

/**
 * A line recorded as it was read (В-4): it added up, and the person changed neither its quantity nor
 * what was paid. Its cut-out rows keep the text read as their confirmed text; its shelf price is what
 * the memory keeps.
 */
function asRead(stored: StoredReceiptLine, line: RecordedLine): boolean {
  const quantity = stored.quantity
  const same =
    line.quantity === null || quantity === null
      ? line.quantity === quantity
      : line.quantity.milli === quantity.milli && line.quantity.unit === quantity.unit
  return stored.settled && same && sameMoney(line.amount, stored.sum)
}

/**
 * The money of the trip (MOL-126 Т-10, В-3): the printed total when it was read — what was paid, the
 * lines left out and those OCR lost included — else the sum of every line: a recorded one at what the
 * person settled on, one left out at what it would have been recorded at (В-5). `null` when a line has
 * no amount or one in another currency: the trip then counts its prices (MOL-78).
 */
function receiptMoney(
  total: Money | null,
  stored: readonly StoredReceiptLine[],
  body: ReceiptRecordBody,
  currency: Money['currency'],
): Money | null {
  if (total !== null && total.minor > 0n) return total
  const digits = receiptDigits(
    currency,
    stored.flatMap((line) => [line.price, line.sum, line.discount]),
  )
  const left = recordedSums(stored, null, digits)
  let minor = 0n
  for (const line of body.lines) {
    const amount = line.skip ? (left[line.position] ?? null) : line.amount
    if (amount?.currency !== currency) return null
    minor += amount.minor
  }
  return minor > 0n ? { minor, currency } : null
}

/**
 * «Записать» (MOL-126): the receipt, as the phone holds it, written in one go — a trip finished on the
 * receipt's day at the rate of that day (Т-9), its purchases with their own sums, new items by the rules
 * of MOL-12, the shop's memory taught, the receipt's tax number given to its place, the photo gone, the
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
    const held = await receipts.lockForRecord(actor.id, id)
    if (held === null) throw new DomainError(ERROR.NOT_FOUND)
    const answer = async (tripId: string): Promise<ReceiptRecorded> => {
      const found = await receipts.one(actor.id, held.id)
      if (found === null) throw new DomainError(ERROR.NOT_FOUND)
      return { receipt: found.receipt, tripId }
    }
    if (held.status === 'recorded') {
      if (held.tripId === body.tripId) return answer(body.tripId)
      throw new DomainError(ERROR.CONFLICT)
    }
    if (held.status !== 'parsed') throw new DomainError(ERROR.RECEIPT_NOT_READY)
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
    if (place === null) throw new DomainError(ERROR.CONFLICT)
    if (held.tin !== null) await places.giveTin(place.id, held.tin)

    const recorded = body.lines
      .filter((line): line is RecordedLine => !line.skip)
      .sort((a, b) => a.position - b.position)
    const named = [
      ...new Set(recorded.flatMap((line) => ('id' in line.item ? [line.item.id] : []))),
    ]
    if ((await items.byIds(named)).length !== named.length) throw new DomainError(ERROR.CONFLICT)

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
      receiptMoney(held.total, held.lines, body, held.currency),
    )

    const written: { position: number; expenseId: string }[] = []
    const words: MemoryWord[] = []
    const confirmed: number[] = []
    for (const line of recorded) {
      const stored = held.lines[line.position]
      if (stored === undefined) throw new DomainError(ERROR.CONFLICT)
      let itemId: string
      if ('id' in line.item) itemId = line.item.id
      else {
        const proposal = await items.createUnlessNamed(
          {
            kind: 'product',
            name: line.item.name,
            barcodes: [],
            defaultUnit: line.quantity?.unit ?? 'piece',
          },
          actor.id,
        )
        // the item is made with no codes, so none of them can be another item's
        if ('taken' in proposal) throw new DomainError(ERROR.CONFLICT)
        itemId = proposal.item.id
      }
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
    await receipts.markRecorded(held.id, { tripId: trip.id, expenses: written, confirmed })
    return answer(trip.id)
  })
}
