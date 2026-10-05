import {
  RECEIPT_CURRENCY,
  RECEIPT_LANGUAGES,
  RECEIPT_PAGE_MODES,
  bestReading,
  mergeParts,
  moneyOfHundredths,
  needsReshoot,
  readPartly,
  receiptCityOf,
  receiptDateOf,
  receiptTimeOf,
  receiptLineOf,
  receiptLineCodec,
} from '@molvia/model'
import type { Currency, ReceiptLine, ReceiptText, TextRow } from '@molvia/model'
import { z } from 'zod'
import type {
  ClaimedReceipt,
  LineBinding,
  LineImage,
  ReadOutcome,
  ReceiptHead,
  ReceiptRepository,
} from '@/db/receipts-repository'
import { PhotoUnreadable, ReaderDropped, ReaderUnavailable } from '@/receipts/reader'
import { TILL_KINDS_LATIN } from '@/receipts/till-kinds-latin'
import { TILL_WORDS_RU } from '@/receipts/till-words-ru'
import type { Box, ReceiptReader } from '@/receipts/reader'

// The kinds of goods a till names: an item named after a city names its kind beside it (MOL-126).
const TILL_WORDS: ReadonlySet<string> = new Set([
  ...Object.keys(TILL_WORDS_RU),
  ...TILL_KINDS_LATIN,
])

// The latest day a receipt may print: the server's tomorrow, so no zone's today is refused.
const latestPrinted = (): string =>
  new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

/** Rows cut out per request: the reader takes 64; a long receipt's lines go in several. */
const STRIPS_PER_REQUEST = 32

export interface ReadReceiptsDeps {
  readonly receipts: ReceiptRepository
  readonly reader: ReceiptReader
  /** The lines to items (MOL-126): `bindReceiptLines`, one binding for each line in order. */
  readonly bind: (
    claimed: ClaimedReceipt,
    lines: readonly ReceiptLine[],
  ) => Promise<readonly LineBinding[]>
  /** What happened, for the log: never the receipt's text, its tax number or its photo (MOL-58). */
  readonly report: (event: ReadReport) => void
}

export type ReadReport =
  | {
      readonly kind: 'read'
      readonly status: 'parsed' | 'failed'
      readonly failure: string | null
      readonly parts: number
      /** Item lines found, and how many of them add up by their own arithmetic (MOL-222, Р-8). */
      readonly lines: number
      readonly settled: number
      /** Read only in part: the review says so (В-1). */
      readonly partly: boolean
      readonly ms: number
    }
  | { readonly kind: 'reader_unavailable'; readonly reason: string }
  | { readonly kind: 'reader_dropped'; readonly reason: string }
  | { readonly kind: 'strips_failed'; readonly reason: string }
  | { readonly kind: 'bind_failed'; readonly error: unknown }
  | { readonly kind: 'error'; readonly error: unknown }

function headOf(
  text: ReceiptText,
  currency: Currency,
  readings: readonly (readonly TextRow[])[],
): ReceiptHead {
  return {
    tin: text.tin,
    printedOn: receiptDateOf(text, latestPrinted()),
    printedTime: receiptTimeOf(text),
    receiptNo: text.receiptNo,
    totalMinor: moneyOfHundredths(text.totalHundredths, currency)?.minor ?? null,
    balanced: text.balanced,
    layout: text.layout,
    city:
      readings.map((rows) => receiptCityOf(rows, TILL_WORDS)).find((city) => city !== null) ?? null,
  }
}

/**
 * Reads one receipt: every part in both page modes, the parts of each mode joined at the till's
 * articles, the mode whose lines add up kept (MOL-114). A receipt with no item line fails as `reshoot`,
 * unless it is a section printed with no items, read whole with its sum (MOL-227); one with any is
 * read, however little of it (MOL-222, В-1), and has its item lines cut out for the reader's training
 * (MOL-169).
 */
async function readOne(
  { reader, report, bind }: ReadReceiptsDeps,
  claimed: ClaimedReceipt,
): Promise<ReadOutcome> {
  if (claimed.parts.length === 0) {
    // restored from a nightly copy, which holds no photos (В-2)
    return { kind: 'failed', failure: 'unreadable', readerVersion: null, head: null }
  }
  const languages = RECEIPT_LANGUAGES[claimed.country]
  const currency = RECEIPT_CURRENCY[claimed.country]
  const boxes = new Map<TextRow, Box | null>()
  let version: string | null = null
  const readings: TextRow[][] = []
  for (const mode of RECEIPT_PAGE_MODES) {
    const parts: TextRow[][] = []
    for (const [index, part] of claimed.parts.entries()) {
      const reading = await reader.read(part.photo, languages, mode)
      version ??= reading.version
      const rows = reading.rows.map((row, line) => {
        const text: TextRow = { text: row.text, part: index, line }
        boxes.set(text, row.box)
        return text
      })
      parts.push(rows)
    }
    readings.push(mergeParts(parts))
  }
  const text = bestReading(readings)
  const head = headOf(text, currency, readings)
  if (needsReshoot(text))
    return { kind: 'failed', failure: 'reshoot', readerVersion: version, head }

  const lines = text.lines.map((line) => receiptLineOf(line, currency))
  let images: LineImage[] = []
  try {
    images = await cutLines(reader, claimed, text, boxes)
  } catch (error) {
    // the lines for training are a gift, not the receipt: it is read without them
    if (!(
      error instanceof PhotoUnreadable ||
      error instanceof ReaderUnavailable ||
      error instanceof ReaderDropped
    )) {
      throw error
    }
    report({ kind: 'strips_failed', reason: error.reason })
  }
  // the lines go out on the wire as the contract says, or the receipt is not read (Т-5)
  if (!z.array(receiptLineCodec).safeEncode(lines).success) {
    return { kind: 'failed', failure: 'unreadable', readerVersion: version, head }
  }
  let bindings: readonly LineBinding[] = []
  try {
    bindings = await bind(claimed, lines)
  } catch (error) {
    // what the lines are is the review's help, not the receipt: it is read without it, every line new
    report({ kind: 'bind_failed', error })
  }
  if (bindings.length !== lines.length) {
    bindings = lines.map(() => ({ itemId: null, match: 'new', translation: null }))
  }
  const total = head.totalMinor === null ? null : { minor: head.totalMinor, currency }
  return {
    kind: 'parsed',
    readerVersion: version ?? '',
    head,
    lines,
    // a section with no items is read whole (MOL-227)
    partly: lines.length > 0 && readPartly(lines, total),
    bindings,
    images,
  }
}

/** The item lines, row by row — never the head with the customer's name, never the total. */
async function cutLines(
  reader: ReceiptReader,
  claimed: ClaimedReceipt,
  text: ReceiptText,
  boxes: ReadonlyMap<TextRow, Box | null>,
): Promise<LineImage[]> {
  const wanted: { part: number; box: Box; position: number; piece: number; readText: string }[] = []
  text.lines.forEach((line, position) => {
    line.rows.forEach((row, piece) => {
      const box = boxes.get(row) ?? null
      if (box !== null && piece < 4)
        wanted.push({ part: row.part, box, position, piece, readText: row.text })
    })
  })
  const images: LineImage[] = []
  for (const [index, part] of claimed.parts.entries()) {
    const ofPart = wanted.filter((w) => w.part === index)
    for (let at = 0; at < ofPart.length; at += STRIPS_PER_REQUEST) {
      const batch = ofPart.slice(at, at + STRIPS_PER_REQUEST)
      const strips = await reader.strips(
        part.photo,
        batch.map((w) => w.box),
      )
      batch.forEach((w, k) => {
        const image = strips[k]
        if (image !== undefined) {
          images.push({ position: w.position, piece: w.piece, image, readText: w.readText })
        }
      })
    }
  }
  return images
}

/**
 * The queue (MOL-125): reads receipts one at a time, each person's oldest in turn, until none waits.
 * A reader that cannot be reached leaves the receipt in the queue and stops the round — the next one
 * comes with the minute or the next receipt; a reader that drops a photo sends it to the end of the
 * queue with its attempt counted; a photo the reader cannot read fails as `unreadable`, and so does
 * anything unexpected: a receipt is never lost, and never read forever.
 *
 * Returns how many were read.
 */
export async function readQueuedReceipts(deps: ReadReceiptsDeps): Promise<number> {
  let read = 0
  for (;;) {
    const claimed = await deps.receipts.claimNext()
    if (claimed === null) return read
    const started = performance.now()
    let outcome: ReadOutcome
    try {
      outcome = await readOne(deps, claimed)
    } catch (error) {
      if (error instanceof ReaderUnavailable) {
        await deps.receipts.release(claimed.id)
        deps.report({ kind: 'reader_unavailable', reason: error.reason })
        return read
      }
      if (error instanceof ReaderDropped) {
        // the reader fell on this photo, or fell anyway: a second try tells, at the end of the queue
        await deps.receipts.retry(claimed.id)
        deps.report({ kind: 'reader_dropped', reason: error.reason })
        continue
      }
      if (!(error instanceof PhotoUnreadable)) deps.report({ kind: 'error', error })
      outcome = { kind: 'failed', failure: 'unreadable', readerVersion: null, head: null }
    }
    try {
      await deps.receipts.finish(claimed.id, outcome)
    } catch (error) {
      // a reading the schema let through and the table refused: failed now, not read a second time
      deps.report({ kind: 'error', error })
      outcome = { kind: 'failed', failure: 'unreadable', readerVersion: null, head: null }
      await deps.receipts.finish(claimed.id, outcome)
    }
    read += 1
    deps.report({
      kind: 'read',
      status: outcome.kind,
      failure: outcome.kind === 'failed' ? outcome.failure : null,
      parts: claimed.parts.length,
      lines: outcome.kind === 'parsed' ? outcome.lines.length : 0,
      settled: outcome.kind === 'parsed' ? outcome.lines.filter((line) => line.settled).length : 0,
      partly: outcome.kind === 'parsed' && outcome.partly,
      ms: Math.round(performance.now() - started),
    })
  }
}
