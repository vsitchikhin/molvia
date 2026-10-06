import { PUBLISHED, RATE_DIGITS, RATE_SCALE, divideRounded, scaledFromDecimal } from '@molvia/model'
import { FeedError, published, request } from './feed'
import type { Published, RateFeed } from './feed'

export const NBG_URL = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/'

interface Quote {
  readonly quantity: bigint
  /** Lari for `quantity` units, at the rate scale. */
  readonly value: bigint
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function quoteOf(currencies: readonly unknown[], code: string): Quote | null {
  const found = currencies.filter((entry) => isRecord(entry) && entry.code === code)
  const [entry] = found
  if (found.length !== 1 || !isRecord(entry)) return null
  const { quantity, rateFormated } = entry
  const value =
    typeof rateFormated === 'string' ? scaledFromDecimal(rateFormated, RATE_DIGITS) : null
  return typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0
    ? value === null || value <= 0n
      ? null
      : { quantity: BigInt(quantity), value }
    : null
}

/**
 * The official rates of the National Bank of Georgia — the lari's own central bank, and the bank
 * of every pair with the lari (MOL-110, owner's decision В-1). It quotes everything in lari, the
 * dram per 1000, so a rate against the dram is a division inside its one answer, as the Bank of
 * Russia's is: the lari is the inverse of the dram's quote, and a dollar is its lari price times
 * that. Rounded to the snapshot's six digits here, once, at the write.
 *
 * The number is read from `rateFormated`, the decimal as the bank prints it — `rate` is the same
 * figure as a JSON number. The day is the answer's `date`, the day the rate is in force: the bank
 * sets it the evening before, and a Saturday's rate holds until Monday's evening — asked for a
 * Sunday, it answers Saturday, with Saturday's date.
 */
export function parseNbg(json: string): Published {
  let body: unknown
  try {
    body = JSON.parse(json)
  } catch {
    throw new FeedError('nbg', 'not JSON')
  }
  const answers: readonly unknown[] = Array.isArray(body) ? (body as unknown[]) : []
  const [answer] = answers
  if (answers.length !== 1 || !isRecord(answer)) {
    throw new FeedError('nbg', 'not one answer')
  }
  const date =
    typeof answer.date === 'string'
      ? /^(\d{4}-\d{2}-\d{2})T00:00:00/.exec(answer.date)?.[1]
      : undefined
  if (date === undefined) throw new FeedError('nbg', 'no date')
  const currencies = Array.isArray(answer.currencies) ? (answer.currencies as unknown[]) : []

  const dram = quoteOf(currencies, 'AMD')
  if (dram === null) throw new FeedError('nbg', 'no AMD')

  const scaled = new Map<string, bigint | null>()
  for (const currency of PUBLISHED.nbg) {
    const quote =
      currency === 'GEL' ? { quantity: 1n, value: RATE_SCALE } : quoteOf(currencies, currency)
    // drams per unit = (lari per unit) / (lari per dram)
    //                = (value / quantity) / (dram.value / dram.quantity)
    scaled.set(
      currency,
      quote === null
        ? null
        : divideRounded(quote.value * dram.quantity * RATE_SCALE, quote.quantity * dram.value),
    )
  }
  return published('nbg', date, scaled)
}

/** The National Bank of Georgia's feed: the rate in force now, and the one in force on a day. */
export interface NbgFeed extends RateFeed {
  fetchOn(date: string): Promise<Published>
}

export function nbgFeed(url = NBG_URL): NbgFeed {
  const read = async (query: string) => {
    const response = await request('nbg', `${url}${query}`)
    return parseNbg(await response.text())
  }
  return {
    provider: 'nbg',
    fetchLatest: () => read(''),
    // The archive answers any day with the rate in force on it (MOL-110, Р-5): a day off is the
    // working day before it, under that day's date.
    fetchOn: (date) => read(`?date=${encodeURIComponent(date)}`),
  }
}
