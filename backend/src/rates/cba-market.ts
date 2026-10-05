import { MARKET_CURRENCIES } from '@molvia/model'
import type { MarketChannel, MarketCurrency, MarketRate, MarketSide } from '@molvia/model'
import { FeedError, reach } from './feed'
import { readSheet, scaledFromCell } from './xlsx'
import type { Sheet } from './xlsx'

/**
 * The central bank's statistics of the foreign-exchange market (MOL-137). The directory's index
 * answers 401, so the names are written here; each file is overwritten in place by the bank.
 */
const BASE = 'https://old.cba.am/stat/stat_data_eng/'

/** A file past this is not a sheet of three currencies: the daily history was 1,2 MB in 2026. */
const MAX_BYTES = 20 * 1024 * 1024

/**
 * What one file said: its figures and the version it had — its `ETag` and `Last-Modified` as the
 * bank sent them — to ask «has it changed» by next time. Null when the bank sent neither.
 */
export interface MarketAnswer {
  readonly version: string | null
  readonly rates: readonly MarketRate[]
}

/** One file of the market, read on its own: a failure of one never holds the others back. */
export interface MarketFile {
  readonly name: string
  /** The file, or `unchanged` when it is the one `version` names. Throws on anything else. */
  fetch(version: string | null): Promise<MarketAnswer | 'unchanged'>
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
  return MARKET_CURRENCIES.flatMap((currency) => {
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
    MarketCurrency,
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
  for (const currency of MARKET_CURRENCIES) {
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
    if (sheet.value(`A${String(row)}`) === null) {
      // As for the exchange offices (round 3, Г; round 4, Д): an empty row is passed over, a row
      // with a rate and no day is the sheet rebuilt — passed over, its day would drop out in silence.
      const rated = MARKET_CURRENCIES.some((currency) => {
        const { buys, sells } = DAILY_COLUMNS[currency]
        return [buys, sells].some((column) => sheet.value(`${column}${String(row)}`) !== null)
      })
      if (rated) throw refuse(DAILY, `row ${String(row)} has no day`)
      continue
    }
    const date = sheet.day(`A${String(row)}`)
    if (date <= previous) throw refuse(DAILY, `A${String(row)} is not after the row above`)
    previous = date
    for (const currency of MARKET_CURRENCIES) {
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
  for (let row = 11; row <= sheet.rows; row += 1) {
    // A row without its day is not the end of the table (adversarial review, round 3, Г): a blank
    // line between two days made the rest of the week vanish without a word, and the week has no
    // archive. A blank line or a note under the table is passed over; a row that says a currency or
    // carries a rate with no day is the sheet rebuilt, and refuses the file.
    if (sheet.value(`B${String(row)}`) === null) {
      const said = [`C${String(row)}`, `E${String(row)}`, `H${String(row)}`].map((ref) =>
        sheet.value(ref),
      )
      const currencyLike =
        typeof said[0] === 'string' &&
        ['Other', ...MARKET_CURRENCIES].includes(said[0].replace(/\s+/g, ' ').trim())
      if (currencyLike || said.slice(1).some((cell) => cell !== null)) {
        throw refuse(EXCHANGERS, `row ${String(row)} has no day`)
      }
      continue
    }
    const date = sheet.day(`B${String(row)}`)
    const name = sheet.text(`C${String(row)}`)
    if (name === 'Other') continue
    const currency = MARKET_CURRENCIES.find((known) => known === name)
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
    if (seen.size !== MARKET_CURRENCIES.length) throw refuse(EXCHANGERS, `${date} incomplete`)
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

/** The version a file's headers name: its tag and the moment it changed, or null without either. */
function versionOf(headers: Headers): string | null {
  const parts = [headers.get('etag'), headers.get('last-modified')]
  return parts.some((part) => part !== null) ? parts.map((part) => part ?? '').join(' | ') : null
}

/** A length the bank says is past the ceiling, before a byte of it is taken. */
function tooLong(headers: Headers): boolean {
  const length = Number(headers.get('content-length'))
  return Number.isFinite(length) && length > MAX_BYTES
}

/**
 * The body, cut off at the ceiling: the whole of it is never held when it runs past, whatever the
 * length the headers named (adversarial review В).
 */
async function bodyOf(response: Response, file: string): Promise<ArrayBuffer> {
  if (tooLong(response.headers)) throw refuse(file, 'too large')
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader()
  if (!reader) return new ArrayBuffer(0)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw refuse(file, 'too large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes.buffer
}

/**
 * A file downloaded only if it changed since `version`. The bank's server ignores `If-None-Match`
 * and `If-Modified-Since` alike and answers 200 with the whole file (measured 30.09.2026, adversarial
 * review Б), so its `HEAD` is asked first — the same tag and moment, no body — and the file only
 * when they moved: otherwise the daily history is a megabyte and a parse every hour.
 */
function marketFile(file: keyof typeof MARKET_SHEETS, base = BASE): MarketFile {
  const url = `${base}${encodeURIComponent(file)}`
  return {
    name: file,
    async fetch(known) {
      const head = await reach('cba', url, { method: 'HEAD' })
      if (!head.ok) throw refuse(file, `HTTP ${String(head.status)}`)
      const version = versionOf(head.headers)
      if (version !== null && version === known) return 'unchanged'
      if (tooLong(head.headers)) throw refuse(file, 'too large')
      const response = await reach('cba', url)
      if (!response.ok) throw refuse(file, `HTTP ${String(response.status)}`)
      const bytes = await bodyOf(response, file)
      return {
        version: versionOf(response.headers) ?? version,
        rates: await parseMarketFile(file, bytes),
      }
    },
  }
}

/** The three files, in the order they are read. */
export function marketFiles(base = BASE): readonly MarketFile[] {
  return [marketFile(BYBRANCH, base), marketFile(DAILY, base), marketFile(EXCHANGERS, base)]
}
