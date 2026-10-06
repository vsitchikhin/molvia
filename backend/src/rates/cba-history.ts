import {
  PUBLISHED,
  RATE_DIGITS,
  RATE_MAX,
  RATE_MIN,
  divideRounded,
  isRateDay,
  scaledFromDecimal,
} from '@molvia/model'
import type { AmdRate } from '@molvia/model'
import { CBA_URL } from './cba'
import { FeedError, request } from './feed'

function envelope(from: string, to: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<soap:Body><ExchangeRatesByDateRangeByISO xmlns="http://www.cba.am/">' +
    `<ISOCodes>${PUBLISHED.cba.join(',')}</ISOCodes><DateFrom>${from}</DateFrom><DateTo>${to}</DateTo>` +
    '</ExchangeRatesByDateRangeByISO></soap:Body></soap:Envelope>'
  )
}

function field(block: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1]
}

/**
 * The answer of `ExchangeRatesByDateRangeByISO` (MOL-137): the central bank's own archive of the
 * official rate, a row per currency per working day, `RateDate` the day in Yerevan. Read as
 * narrowly as `parseCba` reads the latest, and as strictly: a SOAP fault, an unreadable row, a day
 * missing one of the currencies or a rate outside the band refuses the whole answer — a history
 * with holes nobody can see is worse than the holes the cache already has.
 */
export function parseCbaRange(xml: string): AmdRate[] {
  if (xml.includes('<soap:Fault>')) throw new FeedError('cba', 'range: SOAP fault')
  if (!xml.includes('<ExchangeRatesByDateRangeByISOResult>')) {
    throw new FeedError('cba', 'range: no result')
  }
  const byDay = new Map<string, AmdRate[]>()
  for (const [block] of xml.matchAll(/<ExchangeRatesByRange\b[\s\S]*?<\/ExchangeRatesByRange>/g)) {
    const iso = field(block, 'ISO')
    const currency = PUBLISHED.cba.find((known) => known === iso)
    if (currency === undefined) continue
    const date = /^(\d{4}-\d{2}-\d{2})T/.exec(field(block, 'RateDate') ?? '')?.[1] ?? ''
    if (!isRateDay(date)) throw new FeedError('cba', `range: unreadable date of ${currency}`)
    const amount = field(block, 'Amount') ?? ''
    const rate = scaledFromDecimal(field(block, 'Rate') ?? '', RATE_DIGITS)
    const scaled =
      /^[1-9]\d{0,5}$/.test(amount) && rate !== null ? divideRounded(rate, BigInt(amount)) : null
    if (scaled === null || scaled < RATE_MIN || scaled > RATE_MAX) {
      throw new FeedError('cba', `range: implausible ${currency} on ${date}`)
    }
    const day = byDay.get(date) ?? []
    if (day.some((row) => row.currency === currency)) {
      throw new FeedError('cba', `range: ${currency} twice on ${date}`)
    }
    byDay.set(date, [...day, { provider: 'cba', currency, date, scaled }])
  }
  if (byDay.size === 0) throw new FeedError('cba', 'range: no rates')
  for (const [date, rates] of byDay) {
    if (rates.length !== PUBLISHED.cba.length)
      throw new FeedError('cba', `range: ${date} incomplete`)
  }
  return [...byDay.values()].flat().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** The central bank's archive of the official rate, from `from` to `to`, both `YYYY-MM-DD`. */
export async function fetchCbaRange(from: string, to: string, url = CBA_URL): Promise<AmdRate[]> {
  const response = await request('cba', url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '"http://www.cba.am/ExchangeRatesByDateRangeByISO"',
    },
    body: envelope(from, to),
  })
  return parseCbaRange(await response.text())
}
