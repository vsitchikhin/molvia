import { RATE_DIGITS, divideRounded, scaledFromDecimal } from '@molvia/model'
import { FOREIGN, FeedError, published, request } from './feed'
import type { Published, RateFeed } from './feed'

export const CBA_URL = 'https://api.cba.am/exchangerates.asmx'

const ENVELOPE =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
  '<soap:Body><ExchangeRatesLatest xmlns="http://www.cba.am/"/></soap:Body></soap:Envelope>'

function field(block: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1]
}

/**
 * The answer of `ExchangeRatesLatest`. The service speaks SOAP only — the GET form of the same
 * operation answers «Runtime Error» (measured 19.09.2026) — and the envelope is fixed: a date and
 * four fields per currency. A narrow reading of exactly that is shorter to verify than an XML
 * parser in the bundle.
 *
 * `CurrentDate` has no zone: it is the day in Yerevan. `Rate` is per `Amount` units — the rial
 * comes per 100 and the yen per 10 — so the price of one unit is the division.
 */
export function parseCba(xml: string): Published {
  if (xml.includes('<soap:Fault>')) throw new FeedError('cba', 'SOAP fault')
  const date = /<CurrentDate>(\d{4}-\d{2}-\d{2})T/.exec(xml)?.[1]
  if (date === undefined) throw new FeedError('cba', 'no CurrentDate')

  const scaled = new Map<string, bigint | null>()
  for (const [block] of xml.matchAll(/<ExchangeRate>[\s\S]*?<\/ExchangeRate>/g)) {
    const iso = field(block, 'ISO')
    if (iso === undefined || !FOREIGN.some((currency) => currency === iso)) continue
    const amount = field(block, 'Amount') ?? ''
    const rate = scaledFromDecimal(field(block, 'Rate') ?? '', RATE_DIGITS)
    scaled.set(
      iso,
      /^[1-9]\d{0,5}$/.test(amount) && rate !== null ? divideRounded(rate, BigInt(amount)) : null,
    )
  }
  return published('cba', date, scaled)
}

/** The Central Bank of Armenia: the source of truth, asked first on every refresh. */
export function cbaFeed(url = CBA_URL): RateFeed {
  return {
    provider: 'cba',
    async fetchLatest() {
      const response = await request('cba', url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '"http://www.cba.am/ExchangeRatesLatest"',
        },
        body: ENVELOPE,
      })
      return parseCba(await response.text())
    },
  }
}
