import {
  RECEIPT_CURRENCY,
  receiptClockOf,
  receiptLineCodec,
  receiptLineOf,
  receiptLinkRetryMinutes,
  serbianCityOf,
  serbianJournal,
  serbianReceiptLink,
  serbianShopOf,
  specificationCodes,
} from '@molvia/model'
import type { ReceiptLine } from '@molvia/model'
import { z } from 'zod'
import type {
  ClaimedLink,
  LineBinding,
  ReadOutcome,
  ReceiptRepository,
} from '@/db/receipts-repository'
import type { Purs, PursReceipt } from '@/purs/client'

export interface ReadTaxReceiptsDeps {
  readonly receipts: Pick<
    ReceiptRepository,
    'requeueInterruptedLinks' | 'claimLink' | 'releaseLink' | 'askLater' | 'finish'
  >
  readonly purs: Purs
  /** The lines to items: `bindReceiptLines`, one binding for each line in order, by its code first. */
  readonly bind: (
    claimed: ClaimedLink,
    lines: readonly ReceiptLine[],
    codes: readonly (string | null)[],
  ) => Promise<readonly LineBinding[]>
  /** What happened, for the log: never the link, the seller or a line (MOL-58, MOL-232). */
  readonly report: (event: TaxReport) => void
}

export type TaxReport =
  | {
      readonly kind: 'read'
      readonly status: 'parsed' | 'failed'
      readonly failure: string | null
      readonly lines: number
      readonly asks: number
      readonly ms: number
    }
  | { readonly kind: 'not_yet'; readonly asks: number; readonly status: 'queued' | 'failed' }
  | { readonly kind: 'bind_failed'; readonly error: unknown }
  | { readonly kind: 'error'; readonly error: unknown }

const failed = (failure: 'invalid' | 'unreadable', journalEmpty = false): ReadOutcome => ({
  kind: 'failed',
  failure,
  readerVersion: null,
  head: null,
  ...(journalEmpty ? { journalEmpty } : {}),
})

/**
 * A round of the receipts by their link (MOL-232): each one whose ask is due, people in turn, asked
 * of the tax office. Shown — its journal laid out into lines, bound and written, the link gone; not
 * shown yet — asked again later, failed as `missing` after two days; refused — `invalid`. Over the
 * limit the round stops: the next minute goes on. Returns the receipts asked.
 */
export async function readTaxReceipts(deps: ReadTaxReceiptsDeps): Promise<number> {
  await deps.receipts.requeueInterruptedLinks()
  let asked = 0
  for (;;) {
    const claimed = await deps.receipts.claimLink()
    if (claimed === null) return asked
    const started = performance.now()
    const answer = await deps.purs.receipt(claimed.link, claimed.actorId)
    if (answer.kind === 'skipped') {
      await deps.receipts.releaseLink(claimed.id)
      return asked
    }
    asked += 1
    if (answer.kind === 'not_yet') {
      const status = await deps.receipts.askLater(
        claimed.id,
        receiptLinkRetryMinutes(claimed.attempts),
      )
      deps.report({ kind: 'not_yet', asks: claimed.attempts, status })
      continue
    }
    let outcome: ReadOutcome
    try {
      outcome =
        answer.kind === 'refused' ? failed('invalid') : await outcomeOf(deps, claimed, answer)
    } catch (error) {
      deps.report({ kind: 'error', error })
      outcome = failed('unreadable')
    }
    try {
      await deps.receipts.finish(claimed.id, outcome)
    } catch (error) {
      // an answer the schema let through and the table refused: failed now, not asked again
      deps.report({ kind: 'error', error })
      outcome = failed('unreadable')
      await deps.receipts.finish(claimed.id, outcome)
    }
    deps.report({
      kind: 'read',
      status: outcome.kind,
      failure: outcome.kind === 'failed' ? outcome.failure : null,
      lines: outcome.kind === 'parsed' ? outcome.lines.length : 0,
      asks: claimed.attempts,
      ms: Math.round(performance.now() - started),
    })
  }
}

/**
 * What the tax office's answer makes of the receipt: the journal's lines, the seller, its premises
 * and town; the total, the moment and the number are the link's own — signed, and read with no
 * network when the receipt was taken.
 */
async function outcomeOf(
  deps: ReadTaxReceiptsDeps,
  claimed: ClaimedLink,
  answer: PursReceipt,
): Promise<ReadOutcome> {
  const link = serbianReceiptLink(claimed.link)
  const journal = serbianJournal(answer.journal)
  if (!link.ok) return failed('invalid')
  // an answer about another receipt than the one the link signs is no answer about this one (review 8)
  if (answer.number !== link.number) return failed('invalid')
  // the tax office's own answer with no list: counted apart from a failure of ours (adversarial А7)
  if (journal === null || journal.lines.length === 0) return failed('unreadable', true)

  const currency = RECEIPT_CURRENCY[claimed.country]
  const lines = journal.lines.map((line) => receiptLineOf(line, currency))
  // the lines go out on the wire as the contract says, or the receipt is not read (Т-5 of MOL-125)
  if (!z.array(receiptLineCodec).safeEncode(lines).success) return failed('unreadable')

  // the lines' codes, asked before the receipt is written (MOL-234, owner's В-1 «а»; review 9): the
  // review is never read without its codes, and the wait is the specification's own deadline —
  // `PURS_SPECIFICATION_TIMEOUT_MS`, never the journal's (adversarial А4). A specification that failed
  // or is out of step with the journal gives none; with no room in the person's share it is not asked
  const asked = await deps.purs.specification(claimed.link, link.number, claimed.actorId)
  const found = asked.kind === 'found' ? specificationCodes(asked.items, journal.lines) : null
  const codes = found ?? lines.map(() => null)

  let bindings: readonly LineBinding[] = []
  try {
    bindings = await deps.bind(claimed, lines, codes)
  } catch (error) {
    // what the lines are is the review's help, not the receipt: every line new
    deps.report({ kind: 'bind_failed', error })
  }
  if (bindings.length !== lines.length) {
    bindings = lines.map(() => ({ itemId: null, match: 'new', translation: null }))
  }
  const clock = receiptClockOf(link.at, claimed.country)
  const shop = serbianShopOf(answer.locationName ?? '')
  const sums = lines.map((line) => line.sum?.minor ?? null)
  const balanced =
    sums.every((sum) => sum !== null) &&
    sums.reduce<bigint>((all, sum) => all + sum, 0n) === link.total.minor
  return {
    kind: 'parsed',
    // who read it: the tax office, not a version of our reader
    readerVersion: 'purs',
    head: {
      tin: answer.tin,
      printedOn: clock.day,
      printedTime: clock.time,
      // the link's own: signed, read when the receipt was taken, and what a repeat is known by
      receiptNo: link.number,
      totalMinor: link.total.minor,
      balanced,
      layout: null,
      city: serbianCityOf(answer.administrativeUnit, answer.city),
      shopUnit: shop?.unit ?? null,
      shop: shop?.name ?? null,
    },
    lines,
    partly: false,
    bindings,
    images: [],
    codes,
    specification: asked.kind === 'skipped' ? 'skipped' : found === null ? 'failed' : 'ok',
  }
}
