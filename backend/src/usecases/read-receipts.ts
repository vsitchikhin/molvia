import {
  RECEIPT_MODEL_INPUT_MAX,
  RECEIPT_PAGE_MODES,
  AGGREGATE_MIN_CONTRIBUTIONS,
  bestReading,
  hundredthsOfMoney,
  linesTotalOf,
  mergeParts,
  modelHeadRows,
  modelPaidBy,
  moneyOfHundredths,
  needsReshoot,
  readPartly,
  receiptPaidBy,
  receiptCard,
  receiptCityOf,
  receiptDateOf,
  receiptDateWindow,
  receiptTextOfModel,
  rememberedReading,
  unparsedFigures,
  receiptTimeOf,
  receiptLineOf,
  receiptLineCodec,
  modelAlone,
  spendMonthOf,
  tesseractReads,
  dayIn,
  explainedReading,
  betterReading,
  worstCallMicroUsd,
  RECEIPT_MODEL,
} from '@molvia/model'
import type {
  Currency,
  ExplainedReading,
  ModelReceipt,
  OwnerNotice,
  PhotoReading,
  ReceiptLineReason,
  ReceiptLine,
  ReceiptModelName,
  ReceiptDateWindow,
  ReceiptPaidBy,
  ReceiptText,
  RememberedPrice,
  RememberedPrices,
  TesseractReading,
  TextRow,
} from '@molvia/model'
import { z } from 'zod'
import type { ModelSpendRepository } from '@/db/model-spend-repository'
import type { OwnerNoticeRepository } from '@/db/owner-notices-repository'
import { memoryKey } from '@/db/store-memory-repository'
import type { StoreMemoryRepository } from '@/db/store-memory-repository'
import type {
  ClaimedReceipt,
  LineBinding,
  LineImage,
  ReadOutcome,
  ReadReasons,
  ReceiptHead,
  ReceiptRepository,
} from '@/db/receipts-repository'
import { ModelRejected, ModelUnavailable } from '@/receipts/model-reader'
import type { ModelReading, ReceiptModel } from '@/receipts/model-reader'
import { PhotoUnreadable, ReaderDropped, ReaderUnavailable } from '@/receipts/reader'
import { TILL_KINDS_LATIN } from '@/receipts/till-kinds-latin'
import { TILL_WORDS_RU } from '@/receipts/till-words-ru'
import type { Box, ReceiptReader } from '@/receipts/reader'
import type { PhoneNoticeBudget } from './record-failure'

// The kinds of goods a till names: an item named after a city names its kind beside it (MOL-126).
const TILL_WORDS: ReadonlySet<string> = new Set([
  ...Object.keys(TILL_WORDS_RU),
  ...TILL_KINDS_LATIN,
])

// The days a receipt may print, from the moment the server took it in (MOL-305): one rule for both readers.
const datesOf = (claimed: ClaimedReceipt): ReceiptDateWindow =>
  receiptDateWindow(claimed.arrivedAt, claimed.country)

/** Rows cut out per request: the reader takes 64; a long receipt's lines go in several. */
const STRIPS_PER_REQUEST = 32

/**
 * How long a receipt the model may read waits for the model away (Р-9): a short failure — a 429, a 5xx,
 * the network — must not send it to the worse reader, and a long one must not hold it; past this since it
 * was queued, Tesseract reads it (В-1 «а»).
 */
export const RECEIPT_MODEL_WAIT_MS = 10 * 60 * 1000

/**
 * How long a receipt of a country the model alone reads waits for it away (MOL-408, owner's В-8 «а»): no Tesseract
 * takes it after ten minutes, and failed it would be lost for an outage — a day, and the round steps past it meanwhile.
 */
export const RECEIPT_MODEL_ALONE_WAIT_MS = 24 * 60 * 60 * 1000

/** What a call of the model cost and used. */
export type ModelPaid = Pick<ModelReading, 'costMicroUsd' | 'tokens'>

/**
 * Why a model did not read a receipt: its worst past the cap or the share, the photos past what its price holds, its
 * answer one we did not take, or the model away (MOL-272, MOL-367).
 */
export type ModelPassReason = 'cap' | 'share' | 'size' | 'refused' | 'cut' | 'invalid' | 'away'

/**
 * How long the second model rests once it was away (MOL-405, adversarial А5): never asked meanwhile, so an outage of
 * it holds the one reader of the queue one call's wait in this while, not a wait on every receipt — and leaves its
 * worst in one person's share, never a share of every receipt's owner. The first reading stays; nothing waits.
 */
export const RECEIPT_SECOND_REST_MS = 10 * 60 * 1000

/**
 * A second reading slower than this rests the second model as being away does (MOL-405, adversarial Б4): an overloaded
 * model answers near its time out rather than refusing, and held the queue as long on every receipt. The bench's
 * slowest was 22 s, its p90 17 s; its answer is still taken.
 */
export const RECEIPT_SECOND_SLOW_MS = 60 * 1000

/** Whether the second model rests now, and its rest begun once it was away (MOL-405). */
export interface ModelRest {
  resting(now: Date): boolean
  away(now: Date): void
}

/** The second model's rest, in the API's memory: a restart forgets it, and asks once more. */
export function modelRest(ms = RECEIPT_SECOND_REST_MS): ModelRest {
  let until = Number.NEGATIVE_INFINITY
  return {
    resting: (now) => now.getTime() < until,
    away: (now) => {
      until = now.getTime() + ms
    },
  }
}

/**
 * The model that reads receipts, and its month's spending under the cap (MOL-272) and each person's share of it
 * (MOL-367).
 */
export interface ReceiptModelDeps {
  readonly reader: ReceiptModel
  /**
   * The model that reads again a receipt the first did not read whole (MOL-405): Sonnet, the same key, with its rest
   * once away. Absent or `null`, the first reading is all there is.
   */
  readonly second?: { readonly reader: ReceiptModel; readonly rest: ModelRest } | null
  readonly spend: ModelSpendRepository
  readonly capMicroUsd: number
  readonly shareMicroUsd: number
}

export interface ReadReceiptsDeps {
  readonly receipts: ReceiptRepository
  readonly reader: ReceiptReader
  /** The lines to items (MOL-126): `bindReceiptLines`, one binding for each line in order. */
  readonly bind: (
    claimed: ClaimedReceipt,
    lines: readonly ReceiptLine[],
    /** The model read them (MOL-326): a word it misread by the font may be put right. */
    read: { readonly byModel: boolean },
  ) => Promise<readonly LineBinding[]>
  /** What happened, for the log: never the receipt's text, its tax number or its photo (MOL-58). */
  readonly report: (event: ReadReport) => void
  /** The model, where its key is set (MOL-272); without it Tesseract reads every receipt. */
  readonly model?: ReceiptModelDeps | null
  /** The shops' memory, whose shelf prices vote in a line's digits (MOL-291); without it none do. */
  readonly storeMemory?: Pick<StoreMemoryRepository, 'recall'> | null
  /**
   * The developer's channel for a receipt the model read not whole (MOL-309), with its budget: three an hour
   * a person and twenty in all (Р-6). None where nobody is there to tell (`OWNER_TELEGRAM_ID`).
   */
  readonly told?: {
    readonly notices: Pick<OwnerNoticeRepository, 'queue'>
    readonly budget: PhoneNoticeBudget
  } | null
  readonly now?: () => Date
}

/** How many lines the shop's memory confirmed, put right and doubted on a reading (MOL-291). */
export interface RememberedVoice {
  readonly confirmed: number
  readonly repaired: number
  readonly doubted: number
}

const SILENT: RememberedVoice = { confirmed: 0, repaired: 0, doubted: 0 }

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
      /** The reading kept: whose and which version — the second model's where its reading was taken (MOL-405). */
      readonly readerVersion: string | null
      readonly costMicroUsd: number | null
      readonly tokens: ModelPaid['tokens'] | null
      /** What the second model's reading cost and used, apart from the first's (MOL-405, review №3). */
      readonly second: ModelPaid | null
      /** How many of the model's figures no rule read (MOL-294): a count, never the figures (Т-8). */
      readonly unparsed: number | null
      /**
       * What the shop's memory said of the lines (MOL-291, review №5): confirmed, put right, doubted — counts, never a
       * price. The doubts are the price named: lines a changed shelf price emptied.
       */
      readonly remembered: RememberedVoice
    }
  | { readonly kind: 'reader_unavailable'; readonly reason: string }
  /**
   * The model was not the one to read it, for this reason: its key set and the receipt granted, the cap
   * reached, the photos past what its price holds, or its answer one we did not take (MOL-272, В-1).
   */
  | {
      readonly kind: 'model_passed'
      readonly reason: ModelPassReason
      /** What an answer not taken cost and used: paid all the same (review №6). */
      readonly paid?: ModelPaid
    }
  /**
   * The second model did not read again a receipt the first did not read whole, for this reason — or rested, away a
   * while before (MOL-405): the first reading stays, never Tesseract, never a wait. A request refused or a fault of
   * ours is told as the first model's is, by its own report alone.
   */
  | {
      readonly kind: 'second_passed'
      readonly reason: ModelPassReason | 'resting'
      readonly paid?: ModelPaid
    }
  /** The second model answered slower than `RECEIPT_SECOND_SLOW_MS`, and rests (MOL-405, adversarial Б4, review №18). */
  | { readonly kind: 'second_slow'; readonly ms: number }
  /** Which model was away, and why: a time out, the connection (MOL-405, review №4). */
  | {
      readonly kind: 'model_unavailable'
      readonly model: ReceiptModelName
      readonly reason: string
    }
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
  paidBy: ReceiptPaidBy | null,
  dates: ReceiptDateWindow,
): ReceiptHead {
  const printedOn = receiptDateOf(text, dates)
  return {
    tin: text.tin,
    printedOn,
    // a time without its day dates nothing: the purchases go to the day it was sent, never at its time (MOL-305)
    printedTime: printedOn === null ? null : receiptTimeOf(text),
    receiptNo: text.receiptNo,
    totalMinor: moneyOfHundredths(text.totalHundredths, currency)?.minor ?? null,
    readTotalMinor: moneyOfHundredths(text.readTotalHundredths, currency)?.minor ?? null,
    cashbackMinor: moneyOfHundredths(text.cashbackHundredths ?? null, currency)?.minor ?? null,
    serviceMinor: moneyOfHundredths(text.serviceHundredths ?? null, currency)?.minor ?? null,
    redeemedMinor: moneyOfHundredths(text.redeemedHundredths ?? null, currency)?.minor ?? null,
    paidBy,
    balanced: text.balanced,
    layout: text.layout,
    city:
      readings.map((rows) => receiptCityOf(rows, TILL_WORDS)).find((city) => city !== null) ?? null,
  }
}

/**
 * Reads one receipt: by the model where it is granted and its key set (MOL-272), else — or where the
 * model is not the one to — by Tesseract, in a country it reads (a card with its `languages`; Georgia's has none,
 * MOL-408: its receipt fails as `unreadable`). A receipt with no item line fails as `reshoot`, unless it is a
 * section printed with no items, read whole with its sum (MOL-227); one with any is read, however little
 * of it (MOL-222, В-1), and Tesseract's has its item lines cut out for the reader's training (MOL-169).
 * `'wait'`: the model is away, and the receipt waits for it in the queue.
 */
async function readOne(
  deps: ReadReceiptsDeps,
  claimed: ClaimedReceipt,
): Promise<ModelRead | 'wait'> {
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
    return { outcome, paid: null, second: null, unparsed: null }
  }
  if (claimed.byModel && deps.model) {
    const byModel = await readByModel(deps, deps.model, claimed, photoReading)
    if (byModel !== null) return byModel
  }
  if (!tesseractReads(photoReading)) {
    // a country the model alone reads (MOL-408, В-2 «а»): no layout of Tesseract's finds its lines, so a receipt the
    // model did not read is said so — the purchases typed by hand — never «переснимите»
    const outcome: ReadOutcome = {
      kind: 'failed',
      failure: 'unreadable',
      readerVersion: null,
      head: null,
    }
    return { outcome, paid: null, second: null, unparsed: null }
  }
  const outcome = await readByOcr(deps, claimed, photoReading)
  return { outcome, paid: null, second: null, unparsed: null }
}

/**
 * Whether the model reads for the person now (MOL-408, adversarial А3, Р2-А1): a model on the server at all, and
 * one more call of the largest request it is ever sent — no call the queue reserves costs more — fitting the
 * person's share of this month and its cap. What `/actors/me` offers Georgia's camera by.
 */
export function readsReceiptsByModel(
  deps: { readonly model: ReceiptModelDeps | null; readonly now?: () => Date },
  actorId: string,
): Promise<boolean> {
  if (deps.model === null) return Promise.resolve(false)
  const { spend, capMicroUsd, shareMicroUsd } = deps.model
  const month = spendMonthOf((deps.now ?? (() => new Date()))())
  // the queue's own threshold is the first reader's: the second is no condition of reading (MOL-405)
  return spend.readsFor(month, worstCallMicroUsd(RECEIPT_MODEL_INPUT_MAX, RECEIPT_MODEL), {
    actorId,
    capMicroUsd,
    shareMicroUsd,
  })
}

/** A receipt read, and what each model's call of it cost and used (none — Tesseract's). */
interface ModelRead {
  readonly outcome: ReadOutcome
  readonly paid: ModelPaid | null
  readonly second: ModelPaid | null
  readonly unparsed: number | null
}

/**
 * Reads one receipt by the model (MOL-272): every part in one request (`askModel`), the answer into the parse's
 * reading and through the one check (`verifiedReading`, MOL-255) — a receipt not read whole read again by the second
 * model, the better of the two kept and the other its witness (MOL-405). `null` where Tesseract is to read it instead
 * (В-1 «а»): the cap, photos past what the price holds, an answer not taken, the request refused for what it is, the
 * model away past its wait; `'wait'` while it is away within it (Р-9).
 */
async function readByModel(
  deps: ReadReceiptsDeps,
  modelDeps: ReceiptModelDeps,
  claimed: ClaimedReceipt,
  photoReading: PhotoReading,
): Promise<ModelRead | 'wait' | null> {
  const { report } = deps
  const now = deps.now ?? (() => new Date())
  const month = spendMonthOf(now())
  const asked = await askModel(deps, modelDeps, modelDeps.reader, claimed, month, now)
  if (asked.kind === 'away') {
    const waited = now().getTime() - (claimed.queuedAt ?? now()).getTime()
    const patience = modelAlone(claimed.country)
      ? RECEIPT_MODEL_ALONE_WAIT_MS
      : RECEIPT_MODEL_WAIT_MS
    if (waited < patience) return 'wait'
    report({ kind: 'model_passed', reason: 'away' })
    return null
  }
  if (asked.kind === 'failed') return null
  if (asked.kind === 'passed') {
    report({ kind: 'model_passed', reason: asked.reason, ...paidOf(asked) })
    return null
  }
  const { currency } = receiptCard(claimed.country)
  const first = await modelText(deps, claimed, photoReading, {
    answer: asked.answer,
    version: modelDeps.reader.version,
    currency,
  })
  const alone = explainedReading(first.text, { byModel: true })
  // a receipt not read whole, with lines, is read again by the second model (MOL-405): of the two the better goes to
  // the review, the other its witness — a slip or a section has no lines by design, and is whole as it is
  const again =
    alone.receipt !== null && first.text.lines.length > 0
      ? await readAgain(deps, modelDeps, claimed, month, now)
      : null
  const other =
    again === null
      ? null
      : await modelText(deps, claimed, photoReading, {
          answer: again.answer,
          version: again.version,
          currency,
          tin: first.text.tin,
        })
  // both readings judged by the shop's memory under one tax number (adversarial В2): the first is read again by the
  // second's where it read none, or the choice would weigh a reading the memory checked against one it never saw
  const judged =
    other !== null && first.text.tin === null && other.text.tin !== null
      ? await modelText(deps, claimed, photoReading, {
          answer: first.answer,
          version: first.version,
          currency,
          tin: other.text.tin,
        })
      : first
  const { kept, witness, explained } =
    other === null
      ? { kept: first, witness: null, explained: alone }
      : chosen(
          judged,
          judged === first ? alone : explainedReading(judged.text, { byModel: true }),
          other,
        )
  const { answer, text, version } = kept
  const paid = asked.paid
  const second = again?.paid ?? null
  const unparsed = unparsedFigures(photoReading, answer)
  const { shown } = explained
  // the photo and the answer, for the developer's review where the person has something to type and accepted
  // the edition that says so (MOL-309)
  const miss = claimed.reviewable ? { reading: answer, parts: claimed.parts } : undefined
  const headOfModel = (one: ModelText, read: ReceiptText) =>
    headOf(
      read,
      currency,
      [modelHeadRows(one.answer)],
      modelPaidBy(photoReading, one.answer),
      datesOf(claimed),
    )
  // of the witness's head only what the check never touches is taken (`filledHead`): its text as read will do
  const head =
    witness === null
      ? headOfModel(kept, shown)
      : filledHead(headOfModel(kept, shown), headOfModel(witness, witness.text))
  if (needsReshoot(text)) {
    const outcome: ReadOutcome = {
      kind: 'failed',
      failure: 'reshoot',
      readerVersion: version,
      head,
      ...(miss === undefined ? {} : { miss }),
      tell: true,
    }
    return { outcome, paid, second, unparsed }
  }
  // no boxes: a model's lines are cut out for no training (Р-4)
  const outcome = await parsed(deps, claimed, {
    text,
    shown,
    head,
    version,
    images: [],
    byModel: true,
  })
  if (outcome.kind !== 'parsed') {
    return {
      outcome: { ...outcome, ...(miss === undefined ? {} : { miss }), tell: true },
      paid,
      second,
      unparsed,
    }
  }
  const reasons: ReadReasons = { receipt: explained.receipt, lines: explained.lines }
  return {
    outcome: {
      ...outcome,
      reasons,
      ...(toType(outcome.partly, reasons)
        ? { ...(miss === undefined ? {} : { miss }), tell: true as const }
        : {}),
    },
    paid,
    second,
    unparsed,
  }
}

/** What an answer not taken cost, where it was asked at all: paid all the same (review №6). */
const paidOf = (asked: { readonly paid?: ModelPaid }): { paid?: ModelPaid } =>
  asked.paid === undefined ? {} : { paid: asked.paid }

/** A model's reading as the parse reads it, and whose it is. */
interface ModelText {
  readonly answer: ModelReceipt
  readonly text: ReceiptText
  readonly version: string
}

/**
 * A model's answer as the parse reads it, the shop's memory voting in its digits (MOL-291) — asked by the tax number
 * the other reading of the paper read, where this one read none (MOL-405, adversarial Б3).
 */
async function modelText(
  deps: ReadReceiptsDeps,
  claimed: ClaimedReceipt,
  photoReading: PhotoReading,
  {
    answer,
    version,
    currency,
    tin = null,
  }: {
    readonly answer: ModelReceipt
    readonly version: string
    readonly currency: Currency
    readonly tin?: string | null
  },
): Promise<ModelText> {
  const first = receiptTextOfModel(photoReading, answer)
  // the tax number and the articles are the reading's: the memory is asked once they are known (MOL-291)
  const prices = await rememberedPrices(
    deps,
    claimed,
    first.tin === null ? { ...first, tin } : first,
    currency,
  )
  const text = prices.size === 0 ? first : receiptTextOfModel(photoReading, answer, prices)
  return { answer, text, version }
}

/** Of two readings the better kept (`betterReading`), the other its witness (MOL-405). */
function chosen(
  first: ModelText,
  alone: ExplainedReading,
  other: ModelText,
): {
  readonly kept: ModelText
  readonly witness: ModelText
  readonly explained: ExplainedReading
} {
  const better = betterReading(alone, explainedReading(other.text, { byModel: true }))
  const [kept, witness] = better === 'second' ? [other, first] : [first, other]
  return {
    kept,
    witness,
    explained: explainedReading(kept.text, { byModel: true, witness: witness.text }),
  }
}

/**
 * The head of the reading kept, what it did not read taken from the other reading of the same paper (MOL-405,
 * adversarial Б3): the tax number, the day with its time, the receipt's number, the city — fields whose none is «not
 * found» — a day out of the window is none for either (MOL-305). Never a sum: the total goes with the lines it was
 * judged by. Never how it was paid: none there is the word of every payment row the reading found — two ways, or a
 * mixed payment, say nothing (MOL-312) — and a reading that lost one would suggest the wrong account (adversarial В1).
 */
function filledHead(head: ReceiptHead, other: ReceiptHead): ReceiptHead {
  return {
    ...head,
    ...(head.printedOn === null
      ? { printedOn: other.printedOn, printedTime: other.printedTime }
      : {}),
    tin: head.tin ?? other.tin,
    receiptNo: head.receiptNo ?? other.receiptNo,
    city: head.city ?? other.city,
  }
}

/** What came of asking a model: what it answered, or why there is nothing to take. */
type Asked =
  | { readonly kind: 'read'; readonly answer: ModelReceipt; readonly paid: ModelPaid }
  | {
      readonly kind: 'passed'
      readonly reason: Exclude<ModelPassReason, 'away'>
      readonly paid?: ModelPaid
    }
  /** Away: a time out, the connection — `model_unavailable` told. */
  | { readonly kind: 'away' }
  /** Refused for what it is, or a fault of ours — told by its own report. */
  | { readonly kind: 'failed' }

/**
 * One call of a model under the month's cap and the person's share — the first reader's and the second's alike
 * (MOL-272, MOL-367, MOL-405): every part in one request, its worst at its own model's price reserved before the call
 * and its own price put in place after, paid whatever came back (Т-3, Т-4). A time out may have been paid: its worst
 * stays counted, in the month and the person's share alike — a request that never left costs nothing (В-6 «а» on
 * adversarial Б1). Refused for what it is, before the model: nothing paid. Anything else is ours, and the receipt is
 * not at fault: the owner hears of it, and the worst stays in the month — whether it was paid is not known (review
 * №4) — never in the person's share. Why the model did not read is the caller's to tell.
 */
async function askModel(
  deps: ReadReceiptsDeps,
  { spend, capMicroUsd, shareMicroUsd }: ReceiptModelDeps,
  model: ReceiptModel,
  claimed: ClaimedReceipt,
  month: string,
  now: () => Date,
): Promise<Asked> {
  const { report } = deps
  const parts = claimed.parts.map((part) => part.photo)
  const input = model.inputTokensMax(parts)
  if (input === null || input > RECEIPT_MODEL_INPUT_MAX) return { kind: 'passed', reason: 'size' }
  const worst = worstCallMicroUsd(input, model.model)
  // the receipt's owner pays from their share, whatever the model is asked for them (MOL-367)
  const call = { actorId: claimed.actorId, capMicroUsd, shareMicroUsd }
  const reserved = await spend.reserve(month, worst, call, now())
  if (reserved !== 'reserved') return { kind: 'passed', reason: reserved }
  let reading
  try {
    reading = await model.read(parts)
  } catch (error) {
    if (error instanceof ModelUnavailable) {
      if (error.costMicroUsd !== null) {
        await spend.settle(month, worst, error.costMicroUsd, call, now())
      }
      report({ kind: 'model_unavailable', model: model.model, reason: error.reason })
      if (error.broken !== undefined) report({ kind: 'model_broken', error: error.broken })
      return { kind: 'away' }
    }
    if (error instanceof ModelRejected) {
      await spend.settle(month, worst, 0, call, now())
      report({ kind: 'model_rejected', error })
      return { kind: 'failed' }
    }
    report({ kind: 'error', error })
    await spend.keepInMonth(month, worst, call)
    return { kind: 'failed' }
  }
  const paid: ModelPaid = { costMicroUsd: reading.costMicroUsd, tokens: reading.tokens }
  await spend.settle(month, worst, reading.costMicroUsd, call, now())
  if (reading.kind !== 'read') return { kind: 'passed', reason: reading.kind, paid }
  return { kind: 'read', answer: reading.answer, paid }
}

/**
 * The second model's reading of a receipt the first did not read whole (MOL-405), asked as the first is
 * (`askModel`). `null` where there is none to take, and the first reading stays (owner's Р-3): no second model, the
 * model resting, its worst past the cap or the share, the photos past its price, the model away or refusing, its
 * answer not taken. Never a wait: the first reading is paid and checked already — and away, the model rests a while
 * (adversarial А5).
 */
async function readAgain(
  deps: ReadReceiptsDeps,
  modelDeps: ReceiptModelDeps,
  claimed: ClaimedReceipt,
  month: string,
  now: () => Date,
): Promise<{
  readonly answer: ModelReceipt
  readonly paid: ModelPaid
  readonly version: string
} | null> {
  const { second } = modelDeps
  if (!second) return null
  const { report } = deps
  if (second.rest.resting(now())) {
    report({ kind: 'second_passed', reason: 'resting' })
    return null
  }
  const started = now().getTime()
  const asked = await askModel(deps, modelDeps, second.reader, claimed, month, now)
  // slow is away in all but the answer, which is still taken (adversarial Б4)
  const ms = now().getTime() - started
  const slow = asked.kind !== 'away' && ms >= RECEIPT_SECOND_SLOW_MS
  if (asked.kind === 'away' || slow) second.rest.away(now())
  if (slow) report({ kind: 'second_slow', ms })
  if (asked.kind === 'read') {
    return { answer: asked.answer, paid: asked.paid, version: second.reader.version }
  }
  if (asked.kind === 'away') report({ kind: 'second_passed', reason: 'away' })
  if (asked.kind === 'passed') {
    report({ kind: 'second_passed', reason: asked.reason, ...paidOf(asked) })
  }
  return null
}

/**
 * Reads one receipt by Tesseract: every part in both page modes, the parts of each mode joined at the
 * till's articles, the mode whose lines add up kept (MOL-114).
 */
async function readByOcr(
  deps: ReadReceiptsDeps,
  claimed: ClaimedReceipt,
  photoReading: TesseractReading,
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
  const chosen = bestReading(photoReading, readings)
  // the shop's memory, after the parse chose its reading: the price by the card's swaps (MOL-291)
  const prices = await rememberedPrices(deps, claimed, chosen, currency)
  const text = rememberedReading(chosen, prices, photoReading)
  // a figure goes to the review as read only where it is verified, the rest is left empty (MOL-255)
  const explained = explainedReading(text)
  const { shown } = explained
  const head = headOf(
    shown,
    currency,
    readings,
    receiptPaidBy(photoReading, readings),
    datesOf(claimed),
  )
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
  const outcome = await parsed(deps, claimed, {
    text,
    shown,
    head,
    version: version ?? '',
    images,
    byModel: false,
  })
  // Tesseract's: counted, never kept nor told (owner, 27.10.2026, MOL-309 В-4)
  return outcome.kind === 'parsed'
    ? { ...outcome, reasons: { receipt: explained.receipt, lines: explained.lines } }
    : outcome
}

/**
 * Whether the person has something to type on the review (MOL-309, В-4 «б»): a line emptied — one that kept its
 * sum and lost its price is no field to fill — or lines lost against the total.
 */
function toType(partly: boolean, reasons: ReadReasons): boolean {
  const fills = (reason: ReceiptLineReason | null) => reason !== null && reason !== 'price_dropped'
  return partly || reasons.lines.some(fills)
}

/**
 * Tells the developer of a receipt the model read not whole (MOL-309), once it is written, within the hour's
 * budget — the person's three and everybody's twenty (Р-6) — and of those held back, at most once an hour. A
 * notice that cannot be queued is the owner's to hear as a failure; the reading stands.
 */
async function tell(
  deps: ReadReceiptsDeps,
  claimed: ClaimedReceipt,
  outcome: ReadOutcome,
  keptUntil: Date | null,
  at: Date,
): Promise<void> {
  const { told } = deps
  if (!told || outcome.tell !== true) return
  const reasons =
    outcome.kind === 'parsed' ? outcome.reasons : { receipt: 'failed' as const, lines: [] }
  if (reasons === undefined) return
  const lineReasons: Partial<Record<ReceiptLineReason, number>> = {}
  for (const reason of reasons.lines) {
    if (reason !== null) lineReasons[reason] = (lineReasons[reason] ?? 0) + 1
  }
  const lines = outcome.kind === 'parsed' ? outcome.lines : []
  const notice: OwnerNotice = {
    kind: 'receipt_partial',
    country: claimed.country,
    lines: lines.length,
    shown: lines.filter((line) => line.sum !== null).length,
    // proven whole, a line emptied all the same: no reason of the receipt to give (adversarial А3)
    ...(reasons.receipt === null ? {} : { reason: reasons.receipt }),
    lineReasons,
    // «Прочитали не всё»: lines lost may stand behind a line not as printed (adversarial Б1)
    ...(outcome.kind === 'parsed' && outcome.partly ? { partly: true } : {}),
    // where it is kept — its owner accepted the edition that says so — named by its id; one not kept by none, since
    // nothing here would open it (self-review №3); the day of `keep_until` as written, in Yerevan (№13)
    ...(keptUntil === null ? {} : { receipt: claimed.id.slice(0, 8), keptUntil: dayIn(keptUntil) }),
  }
  const given = told.budget.ask([notice], claimed.actorId)
  try {
    for (const one of given.told) await told.notices.queue(one, at)
  } catch (error) {
    given.giveBack()
    deps.report({ kind: 'error', error })
    return
  }
  told.budget.hold(given.held)
}

/** The receipts held back past the hour's budget, at most once an hour (MOL-309, Р-6). */
async function tellHeld(deps: ReadReceiptsDeps, at: Date): Promise<void> {
  const { told } = deps
  if (!told) return
  told.budget.forget()
  const held = told.budget.held()
  if (held === null) return
  try {
    await told.notices.queue(held, at)
  } catch (error) {
    deps.report({ kind: 'error', error })
  }
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
    readonly byModel: boolean
  },
): Promise<ReadOutcome> {
  const { text, shown, head, version, images, byModel } = reading
  const { currency } = receiptCard(claimed.country)
  const lines = shown.lines.map((line) => receiptLineOf(line, currency))
  // the lines go out on the wire as the contract says, or the receipt is not read (Т-5)
  if (!z.array(receiptLineCodec).safeEncode(lines).success) {
    return { kind: 'failed', failure: 'unreadable', readerVersion: version, head }
  }
  let bindings: readonly LineBinding[] = []
  try {
    bindings = await bind(claimed, lines, { byModel })
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
  const service = head.serviceMinor ?? null
  // the lines make the total less what a card sent to the card (MOL-289), and less a café's service (MOL-310)
  const total = linesTotalOf(
    measured === null ? null : { minor: measured, currency },
    cashback === null ? null : { minor: cashback, currency },
    service === null ? null : { minor: service, currency },
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
    remembered: shown.lines.map((line) => line.repaired === true && line.remembered === 'repaired'),
    voice: {
      confirmed: text.lines.filter((line) => line.remembered === 'confirmed').length,
      repaired: shown.lines.filter(
        (line) => line.repaired === true && line.remembered === 'repaired',
      ).length,
      doubted: text.lines.filter((line) => line.remembered === 'doubted').length,
    },
  }
}

/**
 * The shelf prices the shop's memory holds for a reading's articles (MOL-291), in the till's hundredths: the
 * person's own word's, else the lower median of three prices or more — other people's with no access (owner's
 * В-1 «в»): the vote shows nothing but a figure printed on the person's own paper. None without the seller's tax
 * number; none where the memory cannot be read — a reading is never lost to it, and the owner hears of it.
 */
async function rememberedPrices(
  { storeMemory, report }: ReadReceiptsDeps,
  claimed: ClaimedReceipt,
  text: ReceiptText,
  currency: Currency,
): Promise<RememberedPrices> {
  const skus = [...new Set(text.lines.flatMap((line) => (line.sku ? [line.sku] : [])))]
  if (!storeMemory || text.tin === null || skus.length === 0) return new Map()
  let recalled
  try {
    recalled = await storeMemory.recall(
      claimed.actorId,
      text.tin,
      skus.map((key) => ({ kind: 'sku' as const, key })),
      currency,
    )
  } catch (error) {
    report({ kind: 'error', error })
    return new Map()
  }
  const prices = new Map<string, RememberedPrice>()
  for (const sku of skus) {
    const word = recalled.get(memoryKey({ kind: 'sku', key: sku }))
    if (word === undefined) continue
    if (word.ownPrice !== null) {
      prices.set(sku, { hundredths: hundredthsOfMoney(word.ownPrice), own: true })
    } else if (word.priced >= AGGREGATE_MIN_CONTRIBUTIONS && word.sharedPrice !== null) {
      prices.set(sku, { hundredths: hundredthsOfMoney(word.sharedPrice), own: false })
    }
  }
  return prices
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
  const now = deps.now ?? (() => new Date())
  await tellHeld(deps, now())
  let read = 0
  for (;;) {
    const claimed = await deps.receipts.claimNext()
    if (claimed === null) return read
    const started = performance.now()
    let outcome: ReadOutcome
    let paid: ModelPaid | null = null
    let second: ModelPaid | null = null
    let unparsed: number | null = null
    try {
      const done = await readOne(deps, claimed)
      if (done === 'wait') {
        // the model away (Р-9): the receipt keeps its place and its attempt, the round stops, and the
        // minute's timer asks again — past its wait Tesseract reads it. A receipt no Tesseract reads rests instead,
        // the person's others of its country with it, and the round goes on: it waits a day, asked less and less
        // often, and the receipts behind it reach Tesseract past their ten minutes (MOL-408, В-8 «а», В-9 «а»)
        if (!modelAlone(claimed.country)) {
          await deps.receipts.release(claimed.id)
          return read
        }
        await deps.receipts.rest(claimed.id)
        continue
      }
      outcome = done.outcome
      paid = done.paid
      second = done.second
      unparsed = done.unparsed
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
    let written: { readonly keptUntil: Date | null } | null
    try {
      written = await deps.receipts.finish(claimed.id, outcome)
    } catch (error) {
      // a reading the schema let through and the table refused: failed now, not read a second time
      deps.report({ kind: 'error', error })
      outcome = { kind: 'failed', failure: 'unreadable', readerVersion: null, head: null }
      written = await deps.receipts.finish(claimed.id, outcome)
    }
    read += 1
    // a reading not written — the receipt gone or taken meanwhile — is nothing to tell of (self-review №7)
    if (written !== null) await tell(deps, claimed, outcome, written.keptUntil, now())
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
      readerVersion: outcome.readerVersion,
      costMicroUsd: paid?.costMicroUsd ?? null,
      tokens: paid?.tokens ?? null,
      second,
      unparsed,
      remembered: outcome.kind === 'parsed' ? (outcome.voice ?? SILENT) : SILENT,
    })
  }
}
