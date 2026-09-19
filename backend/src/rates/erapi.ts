import { RATE_SCALE, divideRounded, scaledFromDecimal, yerevanDate } from '@molvia/model'
import { FOREIGN, FeedError, published, request } from './feed'
import type { Published, RateFeed } from './feed'

export const ERAPI_URL = 'https://open.er-api.com/v6/latest/AMD'

// The aggregator prints six decimals today; twelve leaves room without accepting a float's noise.
const ERAPI_DIGITS = 12

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The open access of ExchangeRate-API — the second fallback, for when the Bank of Russia is out
 * of reach too (MOL-39, В-6). Its terms ask for a link to the source; the screen's mark on a
 * `fallback` rate is where that belongs.
 *
 * Asked with the dram as the base, it answers units of X per dram, as JSON numbers: a number is
 * read through its shortest decimal form, and anything in exponent notation is refused rather
 * than guessed at. The day is the one in Yerevan at the moment it says it last updated.
 */
export function parseErapi(json: string): Published {
  const body: unknown = JSON.parse(json)
  if (!isRecord(body) || body.result !== 'success' || body.base_code !== 'AMD') {
    throw new FeedError('erapi', 'not a successful answer against AMD')
  }
  const updated = body.time_last_update_unix
  if (typeof updated !== 'number' || !Number.isInteger(updated)) {
    throw new FeedError('erapi', 'no update time')
  }
  const rates = isRecord(body.rates) ? body.rates : {}

  const scaled = new Map<string, bigint | null>()
  for (const currency of FOREIGN) {
    const perDram = rates[currency]
    const units =
      typeof perDram === 'number' ? scaledFromDecimal(String(perDram), ERAPI_DIGITS) : null
    scaled.set(
      currency,
      units === null || units <= 0n
        ? null
        : divideRounded(10n ** BigInt(ERAPI_DIGITS) * RATE_SCALE, units),
    )
  }
  return published('erapi', yerevanDate(new Date(updated * 1000)), scaled)
}

export function erapiFeed(url = ERAPI_URL): RateFeed {
  return {
    provider: 'erapi',
    async fetchLatest() {
      const response = await request('erapi', url)
      return parseErapi(await response.text())
    },
  }
}
