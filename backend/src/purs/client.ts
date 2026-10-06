import { z } from 'zod'

/**
 * The tax office's check of a Serbian receipt (MOL-232): the link of a receipt's QR code asked for
 * JSON — TAP's «Скенирање рачуна са JSON одговором», no authentication. The page and its undocumented
 * `/specifications` are not asked (В-1): the journal gives every line, and GTIN is MOL-234's.
 */
export const PURS_HOST = 'https://suf.purs.gov.rs'

/** In the background, so not as short as a hint's: the check answered in 0.3–0.5 s (MOL-223). */
export const PURS_TIMEOUT_MS = 10_000

/**
 * Asked at most this often a minute, a third of it by one person (`pursShare`, MOL-232, Р-3): the
 * figures of Open Food Facts (MOL-162, В-6). The tax office publishes no limit; open clients keep
 * theirs low «to lower the risk of a block» (FuelScan). Counted in the API's process — there is one.
 */
export const PURS_PER_MINUTE = 12

export function pursShare(perMinute: number): number {
  return Math.max(1, Math.floor(perMinute / 3))
}

/** After a failure of the service — not a receipt it does not show yet — it is left alone this long. */
export const PURS_PAUSE_MS = 60_000

const MINUTE_MS = 60_000

/** How the API names itself to the tax office: the build, encoded as `/health`'s, and a contact. */
export function pursUserAgent(version: string, contact: string): string {
  return `Molvia/${encodeURIComponent(version)} (${contact})`
}

/**
 * What the check says of a receipt — only what is read: the seller's tax number, its premises and its
 * town, the receipt's number and the journal. The cashier, the buyer and the payments are in the
 * answer and never read (MOL-223, В-4).
 */
const answerSchema = z.object({
  invoiceRequest: z.object({
    taxId: z.string().regex(/^\d{9}$/),
    locationName: z.string().max(500).nullable().optional(),
    city: z.string().max(200).nullable().optional(),
    administrativeUnit: z.string().max(200).nullable().optional(),
  }),
  invoiceResult: z.object({ invoiceNumber: z.string().min(1).max(100) }),
  journal: z.string().max(200_000),
  isValid: z.boolean(),
})

export interface PursReceipt {
  readonly tin: string
  readonly locationName: string | null
  readonly city: string | null
  readonly administrativeUnit: string | null
  readonly number: string
  readonly journal: string
}

/**
 * - `found` — the receipt, valid;
 * - `not_yet` — the check does not show it: just printed, a till that was offline, or the service out
 *   of reach — it is asked again later;
 * - `refused` — the check refuses the link, or holds the receipt not valid;
 * - `skipped` — not asked: over the minute's limit or the person's share, or pausing after a failure.
 */
export type PursAnswer =
  | ({ readonly kind: 'found' } & PursReceipt)
  | { readonly kind: 'not_yet' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'skipped' }

export interface Purs {
  /** What the tax office says of the receipt at `link`. `who` is the person; it never leaves the server. */
  receipt(link: string, who: string): Promise<PursAnswer>
}

export interface PursOptions {
  /** Where the check is asked; end-to-end points it at a fake. The link keeps its path and query. */
  readonly url?: string
  readonly userAgent: string
  /** Why the service did not answer — never the link: it may carry the buyer's tax id. */
  readonly onFailure?: (reason: string) => void
  /**
   * The answer no longer reads — not JSON, or JSON of another shape (review 4): the tax office changed
   * it, and every Serbian receipt would wait its two days and fail as `missing` for a reason that is
   * not the till's. The owner's to hear of, as a contract no longer read (`observability.md`); a 5xx or
   * a timeout is the weather and the log's alone. The error says its kind only, never the answer.
   */
  readonly onBroken?: (error: PursError) => void
  readonly perMinute?: number
  readonly now?: () => number
}

/** A failure of the tax office's check, by its kind: `code` is the fingerprint's, the message the log's. */
export class PursError extends Error {
  readonly code: 'NOT_JSON' | 'UNKNOWN_ANSWER' | 'HTTP'

  constructor(reason: string, code: PursError['code']) {
    super(`tax office: ${reason}`)
    this.name = 'PursError'
    this.code = code
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof PursError) return error.message
  if (error instanceof Error) return error.name
  return 'unknown'
}

/** The client of the Serbian tax office's check of a receipt (MOL-232): the server asks, never the phone. */
export function purs(options: PursOptions): Purs {
  const base = options.url ?? PURS_HOST
  const now = options.now ?? Date.now
  const perMinute = options.perMinute ?? PURS_PER_MINUTE
  const share = pursShare(perMinute)
  const asked: number[] = []
  const askedBy = new Map<string, number[]>()
  let pausedUntil = 0

  function recent(moments: number[], at: number): number[] {
    while (moments.length > 0 && (moments[0] ?? 0) <= at - MINUTE_MS) moments.shift()
    return moments
  }

  function mayAsk(who: string): boolean {
    const at = now()
    if (at < pausedUntil) return false
    const mine = recent(askedBy.get(who) ?? [], at)
    if (recent(asked, at).length >= perMinute || mine.length >= share) return false
    asked.push(at)
    mine.push(at)
    askedBy.set(who, mine)
    for (const [person, moments] of askedBy) {
      if (recent(moments, at).length === 0) askedBy.delete(person)
    }
    return true
  }

  async function ask(link: string): Promise<PursAnswer> {
    const { pathname, search } = new URL(link)
    try {
      const response = await fetch(`${base}${pathname}${search}`, {
        headers: { accept: 'application/json', 'user-agent': options.userAgent },
        signal: AbortSignal.timeout(PURS_TIMEOUT_MS),
      })
      // a link the check cannot read — signed, yet not one it issued
      if (response.status === 400) return { kind: 'refused' }
      // a receipt it does not show yet: just printed — no failure of the service, no pause
      if (response.status === 404) return { kind: 'not_yet' }
      if (response.status !== 200) throw new PursError(`HTTP ${String(response.status)}`, 'HTTP')
      let json: unknown
      try {
        json = JSON.parse(await response.text())
      } catch {
        throw new PursError('not json', 'NOT_JSON')
      }
      const parsed = answerSchema.safeParse(json)
      if (!parsed.success) throw new PursError('unknown answer', 'UNKNOWN_ANSWER')
      const { invoiceRequest: seller, invoiceResult: result, journal, isValid } = parsed.data
      if (!isValid) return { kind: 'refused' }
      return {
        kind: 'found',
        tin: seller.taxId,
        locationName: seller.locationName ?? null,
        city: seller.city ?? null,
        administrativeUnit: seller.administrativeUnit ?? null,
        number: result.invoiceNumber,
        journal,
      }
    } catch (error) {
      pausedUntil = now() + PURS_PAUSE_MS
      options.onFailure?.(reasonOf(error))
      if (error instanceof PursError && error.code !== 'HTTP') options.onBroken?.(error)
      return { kind: 'not_yet' }
    }
  }

  return {
    receipt(link, who) {
      if (!mayAsk(who)) return Promise.resolve({ kind: 'skipped' })
      return ask(link)
    },
  }
}
