import { PUBLISHED, RATE_DIGITS, divideRounded, scaledFromDecimal } from '@molvia/model'
import { FeedError, published, request } from './feed'
import type { Published, RateFeed } from './feed'

/**
 * «Курсна листа НБС», the National Bank of Serbia's own application (MOL-230, owner's decision В-1
 * «а»): open, no login, unlike its web services by application and the old `kursnaListaModul`
 * page, which resets a program's connection. Its files may be saved and reproduced unchanged with
 * the source named every time — the words of the list's own `Copyright`; the screen names the bank.
 */
export const NBS_URL = 'https://webappcenter.nbs.rs/ExchangeRateWebApp/ExchangeRate'

const LIST_ID = /ExchangeRateListID=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g

/**
 * The id of the one list a page shows, or `null` for a page that shows none — a day the bank has
 * formed no list for yet. The page names its list in several links (print, XML, CSV); two different
 * ids is a page this reader does not know, and refused.
 */
export function listIdOf(html: string): string | null {
  const ids = new Set([...html.matchAll(LIST_ID)].map(([, id]) => id))
  if (ids.size > 1) throw new FeedError('nbs', 'several lists on one page')
  const [id] = ids
  return id ?? null
}

function field(block: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1]
}

/**
 * The official middle rate of the dinar — the National Bank of Serbia's list, `srednjiKurs`. It
 * quotes dinars per `Unit` of each currency and has no dram (MOL-230), so its rows stay dinars per
 * unit — the provider's base, `RATE_BASE` — rather than drams. The day is the list's `Date`, the day
 * it was formed and in force from 8:00 in Belgrade until the next one: a weekend or a holiday has
 * none of its own, and is answered with the working day's before it.
 */
export function parseNbs(xml: string): Published {
  const header = /<header>([\s\S]*?)<\/header>/.exec(xml)?.[1]
  if (header === undefined) throw new FeedError('nbs', 'no header')
  if (field(header, 'Type') !== 'srednjiKurs') throw new FeedError('nbs', 'not the middle rate')
  const day = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(field(header, 'Date') ?? '')
  if (day === null) throw new FeedError('nbs', 'no date')
  const [, dd = '', mm = '', yyyy = ''] = day
  const date = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`

  const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].map(([block]) => block)
  const scaled = new Map<string, bigint | null>()
  for (const currency of PUBLISHED.nbs) {
    const found = items.filter((block) => field(block, 'Currency') === currency)
    const [block] = found
    if (found.length !== 1 || block === undefined) {
      scaled.set(currency, null)
      continue
    }
    const unit = field(block, 'Unit') ?? ''
    const rate = scaledFromDecimal(field(block, 'Middle_Rate') ?? '', RATE_DIGITS)
    scaled.set(
      currency,
      /^[1-9]\d{0,5}$/.test(unit) && rate !== null && rate > 0n
        ? divideRounded(rate, BigInt(unit))
        : null,
    )
  }
  return published('nbs', date, scaled)
}

/** The National Bank of Serbia's feed: the list in force now, and the one in force on a day. */
export interface NbsFeed extends RateFeed {
  fetchOn(date: string): Promise<Published>
}

/** `2026-10-03` as the bank's form takes it, `03.10.2026`. */
function bankDay(date: string): string {
  const [yyyy = '', mm = '', dd = ''] = date.split('-')
  return `${dd}.${mm}.${yyyy}`
}

function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

export function nbsFeed(url = NBS_URL): NbsFeed {
  // A list is two requests: the page that names it, then the list itself as XML — the format the
  // bank offers for download, rather than the page's table.
  const list = async (id: string) => {
    const query = `ExchangeRateListID=${id}&ExchangeRateListTypeName=srednjiKurs&Format=xml`
    const response = await request('nbs', `${url}/Download?${query}`)
    return parseNbs(await response.text())
  }
  const page = async (path: string) =>
    listIdOf(await (await request('nbs', `${url}/${path}`)).text())
  const onDay = (date: string) =>
    page(`IndexByDate?isSearchExecuted=true&Date=${bankDay(date)}&ExchangeRateListTypeID=3`)

  return {
    provider: 'nbs',
    async fetchLatest() {
      const id = await page('CurrentMiddleRate')
      if (id === null) throw new FeedError('nbs', 'no current list')
      return list(id)
    },
    // Any day is answered with the list in force on it — a Sunday with Friday's. A day the bank
    // has not formed its list for yet — today before 8:00 in Belgrade, whose day starts two or three
    // hours after Yerevan's — has none, and the list in force then is the day before's.
    async fetchOn(date) {
      const id = (await onDay(date)) ?? (await onDay(dayBefore(date)))
      if (id === null) throw new FeedError('nbs', `no list on ${date}`)
      return list(id)
    },
  }
}
