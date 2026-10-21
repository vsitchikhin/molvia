import {
  RECEIPT_MODEL_INPUT_MAX,
  RECEIPT_PAGE_MODES,
  bestReading,
  linesTotalOf,
  mergeParts,
  modelHeadRows,
  moneyOfHundredths,
  needsReshoot,
  readPartly,
  receiptCard,
  receiptCityOf,
  receiptDateOf,
  receiptTextOfModel,
  receiptTimeOf,
  receiptLineOf,
  receiptLineCodec,
  spendMonthOf,
  verifiedReading,
  worstCallMicroUsd,
} from '@molvia/model'
import type { Currency, PhotoReading, ReceiptLine, ReceiptText, TextRow } from '@molvia/model'
import { z } from 'zod'
import type { ModelSpendRepository } from '@/db/model-spend-repository'
import type {
  ClaimedReceipt,
  LineBinding,
  LineImage,
  ReadOutcome,
  ReceiptHead,
  ReceiptRepository,
} from '@/db/receipts-repository'
import { ModelRejected, ModelUnavailable } from '@/receipts/model-reader'
import type { ModelReading, ReceiptModel } from '@/receipts/model-reader'
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

/**
 * How long a receipt the model may read waits for the model away (Р-9): a short failure — a 429, a 5xx,
 * the network — must not send it to the worse reader, and a long one must not hold it; past this since it
 * was queued, Tesseract reads it (В-1 «а»).
 */
export const RECEIPT_MODEL_WAIT_MS = 10 * 60 * 1000

/** What a call of the model cost and used. */
export type ModelPaid = Pick<ModelReading, 'costMicroUsd' | 'tokens'>

/** The model that reads receipts, and its month's spending under the cap (MOL-272). */
export interface ReceiptModelDeps {
  readonly reader: ReceiptModel
  readonly spend: ModelSpendRepository
  readonly capMicroUsd: number
}

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
  /** The model, where its key is set (MOL-272); without it Tesseract reads every receipt. */
  readonly model?: ReceiptModelDeps | null
  readonly now?: () => Date
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
      /** Who read it (MOL-272), and what the model cost and used where it read it (Т-8). */
      readonly reader: 'model' | 'ocr'
      readonly costMicroUsd: number | null
      readonly tokens: ModelPaid['tokens'] | null
    }
  | { readonly kind: 'reader_unavailable'; readonly reason: string }
  /**
   * The model was not the one to read it, for this reason: its key set and the receipt granted, the cap
   * reached, the photos past what its price holds, or its answer one we did not take (MOL-272, В-1).
   */
  | {
      readonly kind: 'model_passed'
      readonly reason: 'cap' | 'size' | 'refused' | 'cut' | 'invalid' | 'away'
      /** What an answer not taken cost and used: paid all the same (review №6). */
      readonly paid?: ModelPaid
    }
  | { readonly kind: 'model_unavailable'; readonly reason: string }
  /**
   * An answer torn on its way, or a fault of ours in the client that looks just like one (review №8): the
   * receipt still waits, and the owner hears of it as a failure — the first time in a build, then at 10,
   * 100, 1000, so a chance tear makes no noise and a broken client is not silent.
   */
  | { readonly kind: 'model_broken'; readonly error: unknown }
  | { readonly kind: 'model_rejected'; readonly error: unknown }
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
    readTotalMinor: moneyOfHundredths(text.readTotalHundredths, currency)?.minor ?? null,
    cashbackMinor: moneyOfHundredths(text.cashbackHundredths ?? null, currency)?.minor ?? null,
    redeemedMinor: moneyOfHundredths(text.redeemedHundredths ?? null, currency)?.minor ?? null,
    balanced: text.balanced,
    layout: text.layout,
    city:
      readings.map((rows) => receiptCityOf(rows, TILL_WORDS)).find((city) => city !== null) ?? null,
  }
}

/**
 * Reads one receipt: by the model where it is granted and its key set (MOL-272), else — or where the
 * model is not the one to — by Tesseract. A receipt with no item line fails as `reshoot`, unless it is a
 * section printed with no items, read whole with its sum (MOL-227); one with any is read, however little
 * of it (MOL-222, В-1), and Tesseract's has its item lines cut out for the reader's training (MOL-169).
 * `'wait'`: the model is away, and the receipt waits for it in the queue.
 */
async function readOne(
  deps: ReadReceiptsDeps,
  claimed: ClaimedReceipt,
): Promise<{ outcome: ReadOutcome; paid: ModelPaid | null } | 'wait'> {
  const { photo: photoReading } = receiptCard(claimed.country)
  if (claimed.parts.length === 0 || photoReading === null) {
    // restored from a nightly copy, which holds no photos (В-2); a country read by its link has no
    // reading off a photo on its card and never reaches the reader (MOL-232)
    const outcome: ReadOutcome = {
      kind: 'failed',
      failure: 'unreadable',
      readerVersion: null,
      head: null,
    }
    return { outcome, paid: null }
  }
  if (claimed.byModel && deps.model) {
    const byModel = await readByModel(deps, deps.model, claimed, photoReading)
    if (byModel !== null) return byModel
  }
  return { outcome: await readByOcr(deps, claimed, photoReading), paid: null }
}

/**
 * Reads one receipt by the model (MOL-272): under the month's cap — its worst price reserved before the
 * call, its own put in place after, paid whatever came back (Т-3, Т-4) — every part in one request, the
 * answer into the parse's reading and through the one check (`verifiedReading`, MOL-255). `null` where
 * Tesseract is to read it instead (В-1 «а»): the cap, photos past what the price holds, an answer not
 * taken, the request refused for what it is, the model away past its wait; `'wait'` while it is away
 * within it (Р-9).
 */
async function readByModel(
  deps: ReadReceiptsDeps,
  { reader: model, spend, capMicroUsd }: ReceiptModelDeps,
  claimed: ClaimedReceipt,
  photoReading: PhotoReading,
): Promise<{ outcome: ReadOutcome; paid: ModelPaid } | 'wait' | null> {
  const { report } = deps
  const now = deps.now ?? (() => new Date())
  const parts = claimed.parts.map((part) => part.photo)
  const input = model.inputTokensMax(parts)
  if (input === null || input > RECEIPT_MODEL_INPUT_MAX) {
    report({ kind: 'model_passed', reason: 'size' })
    return null
  }
  const worst = worstCallMicroUsd(input)
  const month = spendMonthOf(now())
  if (!(await spend.reserve(month, worst, capMicroUsd, now()))) {
    report({ kind: 'model_passed', reason: 'cap' })
    return null
  }
  let reading
  try {
    reading = await model.read(parts)
  } catch (error) {
    if (error instanceof ModelUnavailable) {
      // a time out may have been paid: its worst stays counted
      if (error.costMicroUsd !== null) {
        await spend.settle(month, worst, error.costMicroUsd, capMicroUsd, now())
      }
      report({ kind: 'model_unavailable', reason: error.reason })
      if (error.broken !== undefined) report({ kind: 'model_broken', error: error.broken })
      const waited = now().getTime() - (claimed.queuedAt ?? now()).getTime()
      if (waited < RECEIPT_MODEL_WAIT_MS) return 'wait'
      report({ kind: 'model_passed', reason: 'away' })
      return null
    }
    if (error instanceof ModelRejected) {
      // refused for what it is, before the model: nothing paid
      await spend.settle(month, worst, 0, capMicroUsd, now())
      report({ kind: 'model_rejected', error })
      return null
    }
    // anything else is ours, and the receipt is not at fault: the owner hears of it, Tesseract reads, and the
    // worst stays counted — whether it was paid is not known (review №4)
    report({ kind: 'error', error })
    return null
  }
  const paid: ModelPaid = { costMicroUsd: reading.costMicroUsd, tokens: reading.tokens }
  await spend.settle(month, worst, reading.costMicroUsd, capMicroUsd, now())
  if (reading.kind !== 'read') {
    report({ kind: 'model_passed', reason: reading.kind, paid })
    return null
  }
  const { currency } = receiptCard(claimed.country)
  const text = receiptTextOfModel(photoReading, reading.answer)
  const shown = verifiedReading(text, { byModel: true })
  const head = headOf(shown, currency, [modelHeadRows(reading.answer)])
  if (needsReshoot(text)) {
    const outcome: ReadOutcome = {
      kind: 'failed',
      failure: 'reshoot',
      readerVersion: model.version,
      head,
    }
    return { outcome, paid }
  }
  // no boxes: a model's lines are cut out for no training (Р-4)
  const outcome = await parsed(deps, claimed, {
    text,
    shown,
    head,
    version: model.version,
    images: [],
  })
  return { outcome, paid }
}

/**
 * Reads one receipt by Tesseract: every part in both page modes, the parts of each mode joined at the
 * till's articles, the mode whose lines add up kept (MOL-114).
 */
async function readByOcr(
  deps: ReadReceiptsDeps,
  claimed: ClaimedReceipt,
  photoReading: PhotoReading,
): Promise<ReadOutcome> {
  const { reader, report } = deps
  const { currency } = receiptCard(claimed.country)
  const boxes = new Map<TextRow, Box | null>()
  let version: string | null = null
  const readings: TextRow[][] = []
  for (const mode of RECEIPT_PAGE_MODES) {
    const parts: TextRow[][] = []
    for (const [index, part] of claimed.parts.entries()) {
      const reading = await reader.read(part.photo, photoReading.languages, mode)
      version ??= reading.version
      const rows = reading.rows.map((row, line) => {
        const text: TextRow = { text: row.text, part: index, line }
        boxes.set(text, row.box)
        return text
      })
      parts.push(rows)
    }
    readings.push(mergeParts(photoReading, parts))
  }
  const text = bestReading(photoReading, readings)
  // a figure goes to the review as read only where it is verified, the rest is left empty (MOL-255)
  const shown = verifiedReading(text)
  const head = headOf(shown, currency, readings)
  if (needsReshoot(text))
    return { kind: 'failed', failure: 'reshoot', readerVersion: version, head }
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
  return parsed(deps, claimed, { text, shown, head, version: version ?? '', images })
}

/**
 * A reading made into what is written (MOL-125, MOL-272): the lines as the review shows them, checked
 * against the wire, bound to their items, and «in part» measured — one tail for either reader.
 */
async function parsed(
  { bind, report }: ReadReceiptsDeps,
  claimed: ClaimedReceipt,
  reading: {
    readonly text: ReceiptText
    readonly shown: ReceiptText
    readonly head: ReceiptHead
    readonly version: string
    readonly images: readonly LineImage[]
  },
): Promise<ReadOutcome> {
  const { text, shown, head, version, images } = reading
  const { currency } = receiptCard(claimed.country)
  const lines = shown.lines.map((line) => receiptLineOf(line, currency))
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
  // a total no second source vouched for is not shown, and still says the lines are too few (MOL-244)
  const measured = head.totalMinor ?? head.readTotalMinor
  const cashback = head.cashbackMinor ?? null
  // the lines make the total less what a card sent to the card (MOL-289)
  const total = linesTotalOf(
    measured === null ? null : { minor: measured, currency },
    cashback === null ? null : { minor: cashback, currency },
  )
  return {
    kind: 'parsed',
    readerVersion: version,
    head,
    lines,
    // a section with no items is read whole (MOL-227); the sums of what was read, before the check: a
    // line it emptied was read, and a retake reads it the same (MOL-255, А5 «а»); with no total, a line
    // adds up only as the review shows it with its figures — settled by swaps, a count made up or one
    // number printed twice is no line read (round 3, А10 «а»; round 4, А12 «а»)
    partly:
      lines.length > 0 &&
      readPartly(
        text.lines.map((line, i) => ({
          ...receiptLineOf(line, currency),
          settled: shown.lines[i]?.settled ?? false,
        })),
        total,
      ),
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
    let paid: ModelPaid | null = null
    try {
      const done = await readOne(deps, claimed)
      if (done === 'wait') {
        // the model away (Р-9): the receipt keeps its place and its attempt, the round stops, and the
        // minute's timer asks again — past its wait Tesseract reads it
        await deps.receipts.release(claimed.id)
        return read
      }
      outcome = done.outcome
      paid = done.paid
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
      reader: paid === null ? 'ocr' : 'model',
      costMicroUsd: paid?.costMicroUsd ?? null,
      tokens: paid?.tokens ?? null,
    })
  }
}
