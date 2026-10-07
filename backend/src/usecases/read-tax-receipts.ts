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
import type { ReceiptLine, ReceiptTextLine } from '@molvia/model'
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
    'requeueInterruptedLinks' | 'claimLink' | 'releaseLink' | 'askLater' | 'finish' | 'writeCodes'
  >
  readonly purs: Purs
  /** The lines to items: `bindReceiptLines`, one binding for each line in order. */
  readonly bind: (
    claimed: ClaimedLink,
    lines: readonly ReceiptLine[],
  ) => Promise<readonly LineBinding[]>
  /** The item holding a package's code, with its twins (`findByBarcode`, MOL-234), or `null`. */
  readonly holderOf: (code: string) => Promise<string | null>
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

/** What a read made of the receipt, and the journal's lines its codes are matched against. */
interface Read {
  readonly outcome: ReadOutcome
  readonly journal: readonly ReceiptTextLine[] | null
}

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
    let journal: Read['journal'] = null
    try {
      const read: Read =
        answer.kind === 'refused'
          ? { outcome: failed('invalid'), journal: null }
          : await outcomeOf(deps, claimed, answer)
      outcome = read.outcome
      journal = read.journal
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
    // the receipt is read and handed to the phone already; its codes come after (adversarial А4)
    if (outcome.kind === 'parsed' && journal !== null) await askCodes(deps, claimed, journal)
  }
}

/**
 * The lines' codes, from the specification (MOL-234, owner's В-1 «а»), asked once the receipt is read
 * and written to it on their own — nothing of the receipt waits on them, and the next receipt of the
 * round waits `PURS_SPECIFICATION_TIMEOUT_MS` at most. A specification that failed or is out of step
 * with the journal gives none; with no room in the person's share it is not asked (А5).
 */
async function askCodes(
  deps: ReadTaxReceiptsDeps,
  claimed: ClaimedLink,
  journal: readonly ReceiptTextLine[],
): Promise<void> {
  try {
    const link = serbianReceiptLink(claimed.link)
    if (!link.ok) return
    const asked = await deps.purs.specification(claimed.link, link.number, claimed.actorId)
    const found = asked.kind === 'found' ? specificationCodes(asked.items, journal) : null
    const codes = found ?? journal.map(() => null)
    const holders: (string | null)[] = []
    for (const code of codes) holders.push(code === null ? null : await deps.holderOf(code))
    await deps.receipts.writeCodes(claimed.id, {
      codes,
      holders,
      specification: asked.kind === 'skipped' ? 'skipped' : found === null ? 'failed' : 'ok',
    })
  } catch (error) {
    // a gift that failed: the receipt is read, and stays so
    deps.report({ kind: 'error', error })
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
): Promise<Read> {
  const link = serbianReceiptLink(claimed.link)
  const journal = serbianJournal(answer.journal)
  if (!link.ok) return { outcome: failed('invalid'), journal: null }
  // an answer about another receipt than the one the link signs is no answer about this one (review 8)
  if (answer.number !== link.number) return { outcome: failed('invalid'), journal: null }
  // the tax office's own answer with no list: counted apart from a failure of ours (adversarial А7)
  if (journal === null || journal.lines.length === 0) {
    return { outcome: failed('unreadable', true), journal: null }
  }

  const currency = RECEIPT_CURRENCY[claimed.country]
  const lines = journal.lines.map((line) => receiptLineOf(line, currency))
  // the lines go out on the wire as the contract says, or the receipt is not read (Т-5 of MOL-125)
  if (!z.array(receiptLineCodec).safeEncode(lines).success) {
    return { outcome: failed('unreadable'), journal: null }
  }

  let bindings: readonly LineBinding[] = []
  try {
    bindings = await deps.bind(claimed, lines)
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
    outcome: {
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
    },
    journal: journal.lines,
  }
}
