import { OFF_FIELDS, OffError, parseProduct } from './product'
import type { OffAnswer } from './product'

export const OPEN_FOOD_FACTS_URL = 'https://world.openfoodfacts.org'

/**
 * The first call to another server on the path of a request (MOL-162), so short: the median answer
 * was 0.3–0.4 s on 01.10.2026, the miss is shown without waiting for it, and a hint later than the
 * tap on «Предложить товар» helps nobody (Р-5).
 */
export const OFF_TIMEOUT_MS = 2_500

/**
 * Asked at most this often a minute. The base allows fifteen reads a minute from one address and
 * bans the address past it; production asks from one, so three are left in reserve (Р-6). Counted in
 * the API's process — there is one; a second would need a count they share.
 */
export const OFF_PER_MINUTE = 12

/**
 * A person's share of the minute (MOL-162, owner's decision В-6): a third of it — four of twelve. At
 * the shelf a code is scanned every ten to thirty seconds, so four is plenty for one, and one person
 * scanning a shelf of imports, or a script, leaves the rest for two others (adversarial А). Over the
 * share there is no hint, as over the limit: the miss on screen as it was.
 */
export function personalShare(perMinute: number): number {
  return Math.max(1, Math.floor(perMinute / 3))
}

/** After a failure the base is left alone this long: a base that is down is not asked per scan. */
export const OFF_PAUSE_MS = 60_000

const MINUTE_MS = 60_000

/**
 * How the API names itself to the base: the build, encoded as the header of `/health` is — a tag
 * outside latin1 would fail every request (adversarial Д4 of MOL-90) — and the contact.
 */
export function offUserAgent(version: string, contact: string): string {
  return `Molvia/${encodeURIComponent(version)} (${contact})`
}

export interface OpenFoodFacts {
  /**
   * What the base says of a code, or `null` when it was not asked or did not answer — over the
   * limit or `who`'s share of it, pausing after a failure, or failing now. `null` is never cached:
   * it says nothing of the code. `who` is the person asking; it never leaves the server.
   */
  product(code: string, who: string): Promise<OffAnswer | null>
}

export interface OpenFoodFactsOptions {
  readonly url?: string
  /**
   * `Molvia/<build> (<contact>)` — the base asks every client to name itself and a way to reach it,
   * and may ban one that does not.
   */
  readonly userAgent: string
  /** Why the base did not answer — never the code: the API's log carries no query (MOL-58). */
  readonly onFailure?: (reason: string) => void
  /**
   * The questions a minute, `OFF_PER_MINUTE` unless said; a person's share follows it. Raised only for
   * end-to-end, whose fake of the base has no limit — every spec of a missed code is a question, and
   * at twelve the run's own spec of the hint fell to its turn (adversarial Е).
   */
  readonly perMinute?: number
  readonly now?: () => number
}

function reasonOf(error: unknown): string {
  if (error instanceof OffError) return error.message
  if (error instanceof Error) return error.name
  return 'unknown'
}

/**
 * The client of Open Food Facts (MOL-162): one read of one product, by the server and never by the
 * phone — the base sees the code, the server's address and its name, not who asked.
 *
 * A code asked again while its first question is out shares that question: a second scan of the
 * same package is what a person does when nothing seems to happen, and it would spend the limit
 * twice for one answer.
 */
export function openFoodFacts(options: OpenFoodFactsOptions): OpenFoodFacts {
  const base = options.url ?? OPEN_FOOD_FACTS_URL
  const now = options.now ?? Date.now
  const perMinute = options.perMinute ?? OFF_PER_MINUTE
  const share = personalShare(perMinute)
  const asked: number[] = []
  const askedBy = new Map<string, number[]>()
  const inFlight = new Map<string, Promise<OffAnswer | null>>()
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
    // Forgotten once their minute is over, so the map holds only who asked within it.
    for (const [person, moments] of askedBy) {
      if (recent(moments, at).length === 0) askedBy.delete(person)
    }
    return true
  }

  async function ask(code: string): Promise<OffAnswer | null> {
    const url = `${base}/api/v2/product/${encodeURIComponent(code)}?fields=${OFF_FIELDS.join(',')}`
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': options.userAgent },
        signal: AbortSignal.timeout(OFF_TIMEOUT_MS),
      })
      // A code the base does not know is a 404 with an answer in it; the rest of the 4xx and 5xx —
      // a ban, a page «temporarily unavailable» — are the base out of reach.
      if (response.status !== 200 && response.status !== 404) {
        throw new OffError(`HTTP ${String(response.status)}`)
      }
      return parseProduct(await response.text())
    } catch (error) {
      pausedUntil = now() + OFF_PAUSE_MS
      options.onFailure?.(reasonOf(error))
      return null
    }
  }

  return {
    product(code, who) {
      const pending = inFlight.get(code)
      if (pending !== undefined) return pending
      if (!mayAsk(who)) return Promise.resolve(null)
      const question = ask(code).finally(() => inFlight.delete(code))
      inFlight.set(code, question)
      return question
    },
  }
}
