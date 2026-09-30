import type { MarketChannel, MarketRate, MarketSide } from '@molvia/model'
import { FEED_TIMEOUT_MS, FOREIGN, FeedError } from './feed'
import { readSheet, scaledFromCell } from './xlsx'
import type { Sheet } from './xlsx'

/**
 * The central bank's statistics of the foreign-exchange market (MOL-137). The directory's index
 * answers 401, so the names are written here; each file is overwritten in place by the bank.
 */
const BASE = 'https://old.cba.am/stat/stat_data_eng/'

/** A file past this is not a sheet of three currencies: the daily history was 1,2 MB in 2026. */
const MAX_BYTES = 20 * 1024 * 1024

/** What one file said: its figures and the tag to ask «has it changed» by next time. */
export interface MarketAnswer {
  readonly etag: string | null
  readonly rates: readonly MarketRate[]
}

/** One file of the market, read on its own: a failure of one never holds the others back. */
export interface MarketFile {
  readonly name: string
  /** The file, or `unchanged` when it is the one `etag` names. Throws on anything else. */
  fetch(etag: string | null): Promise<MarketAnswer | 'unchanged'>
}

function refuse(file: string, reason: string): FeedError {
  return new FeedError('cba', `${file}: ${reason}`)
}

function expect(sheet: Sheet, file: string, cells: Readonly<Record<string, string>>): void {
  for (const [ref, text] of Object.entries(cells)) {
    const found = sheet.value(ref)
    if (typeof found !== 'string' || found.replace(/\s+/g, ' ').trim() !== text) {
      throw refuse(file, `${ref} is not ${JSON.stringify(text)}`)
    }
  }
}

function rateOf(
  sheet: Sheet,
  file: string,
  ref: string,
  row: Omit<MarketRate, 'scaled'>,
): MarketRate {
  const scaled = scaledFromCell(sheet.positive(ref))
  if (scaled === null) throw refuse(file, `${ref} is not a rate`)
  return { ...row, scaled }
}

const BYBRANCH = 'FX_bybranch_ENG.xlsx'

/**
 * «Banks by branches of the economy» — one day, overwritten every day, no archive: the only place
 * the central bank splits deals with people into cash and not (MOL-137). The row of each currency
 * is «Natural person (includes sole entrepreneur)»; its columns are cash and non-cash on each side.
 */
export function readBybranch(sheet: Sheet): MarketRate[] {
  expect(sheet, BYBRANCH, {
    D7: 'Date',
    B10: 'Transaction currency',
    E10: 'Buy',
    L10: 'Sell',
    E11: 'Cash',
    H11: 'No cash',
    L11: 'Cash',
    O11: 'No cash',
    F12: 'Weighted average exchange rate',
    I12: 'Weighted average exchange rate',
    M12: 'Weighted average exchange rate',
    P12: 'Weighted average exchange rate',
  })
  const date = sheet.day('E7')
  const columns: readonly [string, MarketChannel, MarketSide][] = [
    ['F', 'bankCash', 'bankBuys'],
    ['I', 'bankNoncash', 'bankBuys'],
    ['M', 'bankCash', 'bankSells'],
    ['P', 'bankNoncash', 'bankSells'],
  ]
  return FOREIGN.flatMap((currency) => {
    // The currency's cell is merged down its block, so every row of the block reads it: the row
    // wanted is the one of that block whose branch is people.
    const rows: number[] = []
    for (let row = 13; row <= sheet.rows; row += 1) {
      const cell = sheet.value(`B${String(row)}`)
      const branch = sheet.value(`D${String(row)}`)
      if (
        typeof cell === 'string' &&
        cell.replace(/\s+/g, '') === `${currency}/AMD` &&
        typeof branch === 'string' &&
        branch.trim().startsWith('Natural person')
      ) {
        rows.push(row)
      }
    }
    const [row] = rows
    if (row === undefined || rows.length > 1) throw refuse(BYBRANCH, `no single row of ${currency}`)
    return columns.map(([column, channel, side]) =>
      rateOf(sheet, BYBRANCH, `${column}${String(row)}`, { channel, currency, date, side }),
    )
  })
}

const DAILY = 'FOREX ENG_Daily.xlsx'

/**
 * Where each currency sits on the sheet of banks: its title, the labels «Buying» and «Selling» over
 * each side's three columns, and the rate column of each side.
 */
const DAILY_COLUMNS: Readonly<
  Record<
    MarketRate['currency'],
    { title: string; buying: string; selling: string; buys: string; sells: string }
  >
> = {
  USD: { title: 'B', buying: 'B', selling: 'E', buys: 'C', sells: 'F' },
  EUR: { title: 'N', buying: 'N', selling: 'Q', buys: 'O', sells: 'R' },
  RUB: { title: 'Z', buying: 'Z', selling: 'AC', buys: 'AA', sells: 'AD' },
}

/**
 * Banks' deals with every client, people and companies alike («Intrabank»), a row per working day
 * since January 2022 (MOL-137). No cash and non-cash: it stands in only for the non-cash row of
 * people, on the days before that row was collected (В-2).
 */
export function readDaily(sheet: Sheet): MarketRate[] {
  const header: Record<string, string> = {}
  for (const currency of FOREIGN) {
    const { title, buying, selling, buys, sells } = DAILY_COLUMNS[currency]
    header[`${title}3`] = 'Intrabank operations'
    header[`${title}6`] = currency
    header[`${buying}4`] = 'Buying'
    header[`${selling}4`] = 'Selling'
    header[`${buys}5`] = 'Weighted average ex.rate'
    header[`${sells}5`] = 'Weighted average ex.rate'
  }
  expect(sheet, DAILY, header)

  const rates: MarketRate[] = []
  let previous = ''
  for (let row = 7; row <= sheet.rows; row += 1) {
    if (sheet.value(`A${String(row)}`) === null) continue
    const date = sheet.day(`A${String(row)}`)
    if (date <= previous) throw refuse(DAILY, `A${String(row)} is not after the row above`)
    previous = date
    for (const currency of FOREIGN) {
      const { buys, sells } = DAILY_COLUMNS[currency]
      const at = { channel: 'banksAll' as const, currency, date }
      rates.push(rateOf(sheet, DAILY, `${buys}${String(row)}`, { ...at, side: 'bankBuys' }))
      rates.push(rateOf(sheet, DAILY, `${sells}${String(row)}`, { ...at, side: 'bankSells' }))
    }
  }
  if (rates.length === 0) throw refuse(DAILY, 'no rows')
  return rates
}

const EXCHANGERS = 'FOREX ENG.xlsx'

/**
 * Exchange offices with their clients, one week at a time and about ten days late (MOL-137). Each
 * row carries its own day as text; the reporting period above the table is not trusted — on
 * 30.09.2026 it named 20–27 September over rows of 14–20. «Other» is a sum without a rate.
 */
export function readExchangers(sheet: Sheet): MarketRate[] {
  expect(sheet, EXCHANGERS, {
    B9: 'Date',
    C9: 'Currency of operation',
    D9: 'Buying',
    G9: 'Selling',
    E10: 'Weighted average ex.rate',
    H10: 'Weighted average ex.rate',
  })
  const byDay = new Map<string, Set<string>>()
  const rates: MarketRate[] = []
  for (let row = 11; row <= sheet.rows && sheet.value(`B${String(row)}`) !== null; row += 1) {
    const date = sheet.day(`B${String(row)}`)
    const name = sheet.text(`C${String(row)}`)
    if (name === 'Other') continue
    const currency = FOREIGN.find((known) => known === name)
    if (currency === undefined) throw refuse(EXCHANGERS, `C${String(row)} is not a currency`)
    const seen = byDay.get(date) ?? new Set()
    if (seen.has(currency)) throw refuse(EXCHANGERS, `${currency} twice on ${date}`)
    byDay.set(date, seen.add(currency))
    const at = { channel: 'exchanger' as const, currency, date }
    rates.push(rateOf(sheet, EXCHANGERS, `E${String(row)}`, { ...at, side: 'bankBuys' }))
    rates.push(rateOf(sheet, EXCHANGERS, `H${String(row)}`, { ...at, side: 'bankSells' }))
  }
  if (byDay.size === 0) throw refuse(EXCHANGERS, 'no rows')
  for (const [date, seen] of byDay) {
    if (seen.size !== FOREIGN.length) throw refuse(EXCHANGERS, `${date} incomplete`)
  }
  return rates
}

/** Each file's sheet and its reader. */
export const MARKET_SHEETS = {
  [BYBRANCH]: { sheet: '6.16-Forex_Banks_Sectorial', read: readBybranch },
  [DAILY]: { sheet: '6.6-Forex (Banks)', read: readDaily },
  [EXCHANGERS]: { sheet: '6.18-Forex(Change)', read: readExchangers },
} as const

/** The figures of a file of the market, from its bytes. */
export async function parseMarketFile(
  file: keyof typeof MARKET_SHEETS,
  bytes: ArrayBuffer,
): Promise<MarketRate[]> {
  const { sheet, read } = MARKET_SHEETS[file]
  return read(await readSheet(bytes, file, sheet))
}

/**
 * A file asked for only if it changed since `etag`: the bank sends the tag, and the daily history
 * is a megabyte an hour otherwise.
 */
function marketFile(file: keyof typeof MARKET_SHEETS, base = BASE): MarketFile {
  return {
    name: file,
    async fetch(etag) {
      const response = await fetch(`${base}${encodeURIComponent(file)}`, {
        headers: etag === null ? {} : { 'If-None-Match': etag },
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      })
      if (response.status === 304) return 'unchanged'
      if (!response.ok) throw refuse(file, `HTTP ${String(response.status)}`)
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > MAX_BYTES) throw refuse(file, 'too large')
      return { etag: response.headers.get('etag'), rates: await parseMarketFile(file, bytes) }
    },
  }
}

/** The three files, in the order they are read. */
export function marketFiles(base = BASE): readonly MarketFile[] {
  return [marketFile(BYBRANCH, base), marketFile(DAILY, base), marketFile(EXCHANGERS, base)]
}
