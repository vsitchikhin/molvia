import {
  DomainError,
  ERROR,
  RECEIPT_PARTS_MAX,
  RECEIPT_PART_BYTES_MAX,
  RECEIPT_SIDE_MAX,
  RECEIPT_SIDE_MIN,
  AGGREGATE_MIN_CONTRIBUTIONS,
  barcodeTwins,
  hasSharedAccess,
  placeNameIdentity,
  priceInDoubt,
  receiptDigits,
  recordedSums,
  storeMemoryWords,
} from '@molvia/model'
import type {
  Actor,
  Currency,
  Money,
  ReceiptBody,
  ReceiptDetail,
  ReceiptPlace,
  ReceiptSummary,
} from '@molvia/model'
import type { ReceiptRepository, StoredReceipt, StoredReceiptLine } from '@/db/receipts-repository'
import { memoryKey } from '@/db/store-memory-repository'
import type { Recalled } from '@/db/store-memory-repository'
import type { TripRepositories } from '@/db/unit-of-work'
import { jpegSize } from '@/receipts/jpeg'
import { tripRateOn } from './start-trip'
import { todayOf } from './today'
import type { Today } from './today'

/** What the review of a receipt reads (MOL-126): the receipt, the shops' memory, places, rates. */
export type ReceiptReviewRepositories = Pick<
  TripRepositories,
  'receipts' | 'storeMemory' | 'items' | 'places' | 'exchanges' | 'incomes' | 'rates'
>

/** «Отправить чек» (MOL-125): 201 for a new receipt, the same answer for the queue sending it again. */
export function sendReceipt(
  receipts: ReceiptRepository,
  actorId: string,
  body: ReceiptBody,
): Promise<{ receipt: ReceiptSummary; created: boolean }> {
  return receipts.create(actorId, body)
}

/**
 * A part of the photo, as the phone sent it. What is not a photo of a receipt is refused here, at
 * once — «не принят» on the phone, never retried: not a JPEG, too small to hold a receipt's print, or
 * larger than a phone sends. The part's number is the address's: one outside the receipt is a page
 * that does not exist.
 */
export async function putReceiptPart(
  receipts: ReceiptRepository,
  actorId: string,
  id: string,
  part: string,
  photo: Buffer,
): Promise<{ receipt: ReceiptSummary; queued: boolean }> {
  const position = /^[1-9]$/.test(part) ? Number(part) : 0
  if (position < 1 || position > RECEIPT_PARTS_MAX) throw new DomainError(ERROR.NOT_FOUND)
  if (photo.length > RECEIPT_PART_BYTES_MAX) throw new DomainError(ERROR.RECEIPT_TOO_LARGE)
  const size = jpegSize(photo)
  if (size === null || Math.min(size.width, size.height) < RECEIPT_SIDE_MIN) {
    throw new DomainError(ERROR.RECEIPT_NOT_PHOTO)
  }
  if (Math.max(size.width, size.height) > RECEIPT_SIDE_MAX) {
    throw new DomainError(ERROR.RECEIPT_TOO_LARGE)
  }
  return receipts.putPart(actorId, id, position, { photo, ...size })
}

/**
 * The place of a receipt not yet recorded (MOL-126 Т-7, Р-6): where receipts of its seller were
 * recorded in the city its address prints, else in the person's own — of a Serbian receipt, where its
 * premises' receipts were (MOL-232) — the person's own last choice
 * first, else the place most people chose, the later on a tie, as the shop's memory is read. «Ереван
 * Сити» of Gyumri and of Yerevan are two places of one tax number. None, and the person names it.
 */
export async function withPlaces(
  receipts: Pick<ReceiptRepository, 'placesOfTins'>,
  actor: Pick<Actor, 'id' | 'country' | 'city'>,
  stored: readonly StoredReceipt[],
): Promise<ReceiptSummary[]> {
  const open = stored.filter(({ receipt }) => receipt.place === null && receipt.header?.tin)
  const tins = [...new Set(open.map(({ receipt }) => receipt.header?.tin ?? ''))]
  const countries = [...new Set(open.map(({ receipt }) => receipt.country))]
  const found = (
    await Promise.all(countries.map((country) => receipts.placesOfTins(actor.id, tins, country)))
  ).flat()
  return stored.map(({ receipt, city, shopUnit }) => {
    if (receipt.place !== null) return receipt
    const tin = receipt.header?.tin ?? null
    const where = city ?? (actor.country === receipt.country ? actor.city : null)
    if (tin === null || (where === null && shopUnit === null)) return receipt
    // a Serbian chain shares one tax number among all its shops: its receipts name the premises, and
    // the place is the one that premises' receipts were recorded at, whatever city (MOL-232, Р-7)
    const here = found.filter(
      (candidate) =>
        candidate.tin === tin &&
        candidate.place.country === receipt.country &&
        (shopUnit !== null
          ? candidate.shopUnit === shopUnit
          : where !== null && placeNameIdentity(candidate.place.city) === placeNameIdentity(where)),
    )
    const [at] = [...here].sort(
      (a, b) =>
        (b.ownLatest?.getTime() ?? 0) - (a.ownLatest?.getTime() ?? 0) ||
        b.voters - a.voters ||
        b.latest.getTime() - a.latest.getTime(),
    )
    const place: ReceiptPlace | null =
      at === undefined ? null : { id: at.place.id, name: at.place.name, city: at.place.city, tin }
    return { ...receipt, place }
  })
}

/**
 * The phone is handed these receipts as they stand, with its page in view (MOL-129, `?shown=1`): one
 * read and not yet heard of is heard of now, in the app, and «чек разобран» will not follow. An
 * ordinary list writes nothing, and a list asked hidden — the connection back, a queue landing in the
 * pocket — writes nothing either (adversarial А1).
 */
async function handedOver(
  receipts: ReceiptReviewRepositories['receipts'],
  actorId: string,
  stored: readonly StoredReceipt[],
): Promise<void> {
  const fresh = stored.filter(
    ({ receipt, heard }) =>
      heard === null && (receipt.status === 'parsed' || receipt.status === 'failed'),
  )
  await receipts.heardInApp(
    actorId,
    fresh.map(({ receipt }) => receipt.id),
  )
}

/** «Покупки»: the person's receipts, each with its place where its tax number tells it (MOL-126). */
export async function receiptsOf(
  repositories: ReceiptReviewRepositories,
  actor: Actor,
  shown: boolean,
): Promise<ReceiptSummary[]> {
  const stored = await repositories.receipts.list(actor.id)
  if (shown) await handedOver(repositories.receipts, actor.id, stored)
  return withPlaces(repositories.receipts, actor, stored)
}

/** Each line as the review first shows it, before the person touches anything. */
export interface ShownLines {
  /** What the shops' memory holds for the line, `null` — nothing. */
  readonly memory: readonly (Recalled | null)[]
  /** The item shown: the memory's over the parse's, `null` — a new one, or one no longer there. */
  readonly itemIds: readonly (string | null)[]
  readonly names: ReadonlyMap<string, string>
  /** The codes each item shown holds (MOL-234): a line's code one of them holds is asked about by nobody. */
  readonly barcodes: ReadonlyMap<string, readonly string[]>
  /** What the line is recorded at unless the person changes it (В-5). */
  readonly amounts: readonly (Money | null)[]
}

/**
 * The lines as the review shows them before any edit: the shop's memory laid over what the parse
 * found — the article first, then the line as printed — and what each will be recorded at (В-5). One
 * reading for the review and for «Записать», which counts the person's edits against it (MOL-222):
 * an item the memory put there and the person left is not an edit.
 */
export async function shownLines(
  repositories: Pick<ReceiptReviewRepositories, 'storeMemory' | 'items'>,
  actorId: string,
  tin: string | null,
  lines: readonly StoredReceiptLine[],
  total: Money | null,
  currency: Currency,
): Promise<ShownLines> {
  const words = lines.map(storeMemoryWords)
  const recalled =
    tin === null
      ? new Map<string, Recalled>()
      : await repositories.storeMemory.recall(actorId, tin, words.flat(), currency)
  const memory = words.map(
    (own) =>
      own.map((word) => recalled.get(memoryKey(word))).find((hit) => hit !== undefined) ?? null,
  )
  const found = lines.map((line, i) => memory[i]?.itemId ?? line.itemId)
  const known = new Set(found.filter((itemId): itemId is string => itemId !== null))
  const shown = await repositories.items.byIds([...known])
  const names = new Map(shown.map((item) => [item.id, item.name]))
  const barcodes = new Map(shown.map((item) => [item.id, item.barcodes]))
  const digits = receiptDigits(currency, [
    total,
    ...lines.flatMap((line) => [line.price, line.sum, line.discount]),
  ])
  return {
    memory,
    itemIds: found.map((itemId) => (itemId !== null && names.has(itemId) ? itemId : null)),
    names,
    barcodes,
    amounts: recordedSums(lines, total, digits),
  }
}

/**
 * The line's code to ask about at «Записать» (MOL-234, В-2): one the tax office gave it that the item
 * shown holds in none of its forms. An item found by the code holds it — nothing to ask.
 */
function codeToAsk(
  line: StoredReceiptLine,
  itemId: string | null,
  barcodes: ReadonlyMap<string, readonly string[]>,
): string | null {
  if (line.gtin === null) return null
  const held = itemId === null ? [] : (barcodes.get(itemId) ?? [])
  const forms = new Set([line.gtin, ...barcodeTwins(line.gtin)])
  return held.some((code) => forms.has(code)) ? null : line.gtin
}

/**
 * One receipt with its lines, as the review shows them (MOL-126): the shop's memory laid over what
 * the parse found — the article first, then the line as printed — the item's name, what each line
 * will be recorded at (В-5), a price the memory doubts (В-1), the place, the rate of the receipt's
 * day and the same receipt recorded before. 404 for a missing, removed or someone else's one alike.
 */
export async function receiptOfOwner(
  repositories: ReceiptReviewRepositories,
  actor: Actor & Today,
  id: string,
  shown: boolean,
): Promise<ReceiptDetail> {
  const found = await repositories.receipts.one(actor.id, id)
  if (found === null) throw new DomainError(ERROR.NOT_FOUND)
  if (shown) await handedOver(repositories.receipts, actor.id, [found])
  const [receipt] = await withPlaces(repositories.receipts, actor, [found])
  if (receipt === undefined) throw new DomainError(ERROR.NOT_FOUND)
  const { lines, currency } = found
  const tin = receipt.header?.tin ?? null

  const { memory, itemIds, names, barcodes, amounts } = await shownLines(
    repositories,
    actor.id,
    tin,
    lines,
    receipt.total,
    currency,
  )

  // a price the memory holds is someone's shelf price: one's own always; other people's only as
  // their figures are — with access, and from three prices, their lower median (round 2, Р2-В3)
  const now = new Date()
  const rememberedOf = (recalled: Recalled | null): Money | null => {
    if (recalled === null) return null
    if (recalled.ownPrice !== null) return recalled.ownPrice
    return hasSharedAccess(actor, now) && recalled.priced >= AGGREGATE_MIN_CONTRIBUTIONS
      ? recalled.sharedPrice
      : null
  }

  const day = receipt.header?.date ?? todayOf(actor, now)
  const snapshot = await tripRateOn(
    repositories,
    actor,
    { incomeCurrency: actor.incomeCurrency, spendCurrency: currency },
    day,
  )
  const number = receipt.header?.receiptNo ?? null
  const twin =
    tin === null || number === null || receipt.tripId !== null
      ? null
      : await repositories.receipts.recordedTwin(actor.id, tin, number, receipt.id)

  return {
    receipt,
    lines: lines.map((line, i) => {
      const remembered = memory[i] ?? null
      const itemId = itemIds[i] ?? null
      const known = itemId === null ? null : (names.get(itemId) ?? null)
      const code = codeToAsk(line, known === null ? null : itemId, barcodes)
      return {
        printed: line.printed,
        hs: line.hs,
        sku: line.sku,
        quantity: line.quantity,
        price: line.price,
        sum: line.sum,
        discount: line.discount,
        settled: line.settled,
        itemId: known === null ? null : itemId,
        itemName: known,
        match:
          remembered !== null && known !== null
            ? 'memory'
            : known === null
              ? 'new'
              : (line.match ?? 'new'),
        translation: line.translation,
        amount: amounts[i] ?? null,
        rememberedPrice: priceInDoubt(line.price, rememberedOf(remembered))
          ? rememberedOf(remembered)
          : null,
        ...(code === null ? {} : { code }),
      }
    }),
    rate: snapshot?.rate ?? null,
    duplicateOf: twin,
  }
}

/** «Удалить чек»: a mark; the photo and the lines go when «Вернуть» is over (П-8). */
export function removeReceipt(
  receipts: ReceiptRepository,
  actorId: string,
  id: string,
): Promise<void> {
  return receipts.remove(actorId, id)
}

export async function restoreReceipt(
  receipts: ReceiptRepository,
  actorId: string,
  id: string,
): Promise<ReceiptSummary> {
  if (!(await receipts.restore(actorId, id))) throw new DomainError(ERROR.NOT_FOUND)
  const found = await receipts.one(actorId, id)
  if (found === null) throw new DomainError(ERROR.NOT_FOUND)
  return found.receipt
}
