import { RATE_DIGITS, RATE_SCALE, divideRounded, scaledFromDecimal } from '@molvia/model'
import { FOREIGN, FeedError, published, request } from './feed'
import type { Published, RateFeed } from './feed'

export const CBR_URL = 'https://www.cbr.ru/scripts/XML_daily.asp'

interface Quote {
  readonly nominal: bigint
  /** Roubles for `nominal` units, at the rate scale. */
  readonly value: bigint
}

function quoteOf(xml: string, code: string): Quote | null {
  const block = new RegExp(`<CharCode>${code}</CharCode>[\\s\\S]*?</Valute>`).exec(xml)?.[0]
  if (block === undefined) return null
  const nominal = /<Nominal>([1-9]\d{0,5})<\/Nominal>/.exec(block)?.[1]
  const value = scaledFromDecimal(/<Value>([^<]*)<\/Value>/.exec(block)?.[1] ?? '', RATE_DIGITS)
  return nominal === undefined || value === null || value <= 0n
    ? null
    : { nominal: BigInt(nominal), value }
}

/**
 * The daily rates of the Bank of Russia — the first open source standing in for the Central Bank
 * of Armenia (MOL-39, В-6). It quotes everything in roubles, the dram per 100, so a rate against
 * the dram is a division: drams per rouble is the inverse of the dram's quote, and a dollar is its
 * rouble price times that. Rounded to the snapshot's six digits here, once, at the write — a
 * fallback is allowed to be a little less exact than the bank it stands in for.
 *
 * `Date` is the day the rate is in force, which the bank sets the day before: on a Friday it is
 * already Saturday's. The trip's own rule, «not after today in Yerevan», keeps it for Saturday.
 */
export function parseCbr(xml: string): Published {
  const [, dd, mm, yyyy] = /<ValCurs Date="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml) ?? []
  if (dd === undefined || mm === undefined || yyyy === undefined) {
    throw new FeedError('cbr', 'no ValCurs date')
  }
  const date = `${yyyy}-${mm}-${dd}`

  const dram = quoteOf(xml, 'AMD')
  if (dram === null) throw new FeedError('cbr', 'no AMD')

  const scaled = new Map<string, bigint | null>()
  for (const currency of FOREIGN) {
    const quote = currency === 'RUB' ? { nominal: 1n, value: RATE_SCALE } : quoteOf(xml, currency)
    // drams per unit = (roubles per unit) / (roubles per dram)
    //                = (value / nominal) / (dram.value / dram.nominal)
    scaled.set(
      currency,
      quote === null
        ? null
        : divideRounded(quote.value * dram.nominal * RATE_SCALE, quote.nominal * dram.value),
    )
  }
  return published('cbr', date, scaled)
}

export function cbrFeed(url = CBR_URL): RateFeed {
  return {
    provider: 'cbr',
    async fetchLatest() {
      const response = await request('cbr', url)
      // The bank still answers in windows-1251; the fields read here are ASCII, but a decoder
      // that guessed UTF-8 would turn the currency names into replacement characters around them.
      const xml = new TextDecoder('windows-1251').decode(await response.arrayBuffer())
      return parseCbr(xml)
    },
  }
}
