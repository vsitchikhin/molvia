import {
  INT8_MAX,
  MINOR_EXPONENT,
  STATEMENT_LINES_MAX,
  STATEMENT_TEXT_MAX,
  currencySchema,
  daysIn,
  midnightsIn,
  scaledFromDecimal,
  statementLineSchema,
} from '@molvia/model'
import type { Currency, Statement, StatementLine, StatementLineKind } from '@molvia/model'
import { decodeStatementText, readCsvRecords } from './csv'
import type { CsvRecord } from './csv'
import { REFUSAL_CURRENCY_MAX, REFUSAL_STATUS_MAX, cutText } from './refusal'
import type { StatementRead, StatementRefusal } from './refusal'

// T-Bank's export of operations, CSV from the web cabinet (MOL-430, epic MOL-427): its lines as the
// duplicates rule reads them (`statement-line.ts`). The columns are found by their names, never their
// places — the format changed twice in five years, silently (b-russia.md, 1.4) — and a file this parser
// does not know is refused, never guessed. Parsed on the server and never kept (Д-3 «а» of MOL-409).
// **The price, named:** the layouts, the statuses and the kinds' words are those of open parsers (b-russia.md,
// 1.2) — the owner's own export is not checked against his PDF yet (В-3 «а»).

/**
 * One account of the file — a file of the web cabinet may hold several — by the name the bank prints and the
 * account's currency: a product's accounts in two currencies may share a name (adversarial А5).
 */
export interface TbankAccount {
  readonly name: string | null
  readonly currency: Currency
  readonly statement: Statement
}

export type TbankRead = StatementRead<TbankAccount>

type Column =
  | 'account'
  | 'date'
  | 'posted'
  | 'amount'
  | 'currency'
  | 'debited'
  | 'debitedCurrency'
  | 'status'
  | 'category'
  | 'mcc'
  | 'payee'
  | 'analytics'

/**
 * The two layouts known (b-russia.md, 1.2: open parsers', not checked on the owner's export yet), by the
 * columns read — a column not named here may come and go.
 * 2026: seventeen columns, UTF-8 with a byte order mark, «Ок», «Сумма в валюте счёта», «Учёт в аналитике».
 * Before it: fifteen, Windows-1251, `OK`, «Дата платежа», «Сумма платежа».
 */
const LAYOUTS: readonly Readonly<Partial<Record<Column, string>>>[] = [
  {
    account: 'Имя счёта',
    date: 'Дата операции',
    amount: 'Сумма операции',
    currency: 'Валюта операции',
    debited: 'Сумма в валюте счёта',
    debitedCurrency: 'Валюта счёта',
    status: 'Статус',
    category: 'Категория по-умолчанию',
    mcc: 'MCC',
    payee: 'Описание',
    analytics: 'Учёт в аналитике',
  },
  {
    date: 'Дата операции',
    posted: 'Дата платежа',
    status: 'Статус',
    amount: 'Сумма операции',
    currency: 'Валюта операции',
    debited: 'Сумма платежа',
    debitedCurrency: 'Валюта платежа',
    category: 'Категория',
    mcc: 'MCC',
    payee: 'Описание',
  },
]

/** A bank's word as compared — a header's name, a category, «Нет»: case, «ё», a hyphen and the spaces aside. */
function folded(text: string): string {
  return text
    .replace(/ё/giu, 'е')
    .replace(/[\s\-\u2010\u2013]+/gu, ' ')
    .trim()
    .toLowerCase()
}

type Columns = ReadonlyMap<Column, number>

function columnsOf(header: readonly string[]): Columns | null {
  const names = header.map(folded)
  for (const layout of LAYOUTS) {
    const columns = new Map<Column, number>()
    for (const [column, name] of Object.entries(layout) as [Column, string][]) {
      const at = names.indexOf(folded(name))
      if (at === -1) break
      columns.set(column, at)
    }
    if (columns.size === Object.keys(layout).length) return columns
  }
  return null
}

/** The bank prints its time in Moscow's, which has kept one offset since 26.10.2014. */
const BANK_ZONE = 'Europe/Moscow'

const DATE = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/

/** `DD.MM.YYYY[ HH:MM[:SS]]` as a calendar day and the seconds into it, or `null` for no such moment. */
function printedMoment(text: string): { day: string; seconds: number } | null {
  const parts = DATE.exec(text.trim())
  if (parts === null) return null
  const [, dd = '', mm = '', yyyy = '', hh = '00', mi = '00', ss = '00'] = parts
  const [year, month, date] = [Number(yyyy), Number(mm), Number(dd)]
  const check = new Date(Date.UTC(year, month - 1, date))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== date
  )
    return null
  const [hours, minutes, secs] = [Number(hh), Number(mi), Number(ss)]
  if (hours > 23 || minutes > 59 || secs > 59) return null
  return { day: `${yyyy}-${mm}-${dd}`, seconds: (hours * 60 + minutes) * 60 + secs }
}

const DAY_MS = 24 * 60 * 60 * 1000

function shiftedDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * The day of an operation printed in Moscow's time, on the phone's calendar (MOL-121, Р-4): a dinner in
 * Yerevan at 00:30 is 23:30 in Moscow the day before, and a spending's day is the phone's. With it the days
 * the phone's calendar stands from Moscow's then, so a posting day printed bare moves with its operation
 * (adversarial А6). Each zone's clock is made once a file.
 */
function phoneDays(
  zone: string | undefined,
): (text: string) => { day: string; shift: number } | null {
  const moscowMidnight = midnightsIn(BANK_ZONE)
  const phoneDay = daysIn(zone)
  return (text) => {
    const moment = printedMoment(text)
    if (moment === null) return null
    // Moscow's midnight and the seconds printed are the moment: no change of Moscow's clocks falls inside a
    // day since 26.10.2014. **The price, named:** a line of an older file, on a night the clocks moved, is an
    // hour off — a day off only within that hour of midnight.
    const instant = new Date(moscowMidnight(moment.day).getTime() + moment.seconds * 1000)
    const day = phoneDay(instant)
    return { day, shift: Math.round((Date.parse(day) - Date.parse(moment.day)) / DAY_MS) }
  }
}

function currencyOf(text: string): Currency | null {
  const parsed = currencySchema.safeParse(text.trim().toUpperCase())
  return parsed.success ? parsed.data : null
}

/** A signed amount in the currency's minor units: a decimal comma, spaces between thousands, «−» too. */
function signedMinor(text: string, currency: Currency): bigint | null {
  const plain = text.trim().replace(/−/gu, '-').replace(/^\+/u, '')
  const minor = scaledFromDecimal(plain, MINOR_EXPONENT[currency])
  return minor === null || minor > INT8_MAX || minor < -INT8_MAX ? null : minor
}

const POSTED = new Set(['ок', 'ok'])
const DECLINED = new Set(['failed'])

/** A bank's text as one line and no longer than a line's field may be, counted as the schema counts. */
function bankText(text: string): string {
  return cutText(text.replace(/\s+/gu, ' ').trim(), STATEMENT_TEXT_MAX)
}

/** An MCC of up to four digits, its leading zeros put back; anything else is none. */
function mccOf(text: string): string | null {
  const digits = text.trim()
  return /^\d{1,4}$/u.test(digits) ? digits.padStart(4, '0') : null
}

const CASH_MCC = new Set(['6010', '6011'])
const OWN_WORDS = /между своими счетами|перевод себе|пополнение вклада|снятие с вклада/iu
const FEE_WORDS = /комисси|услуги банка/iu
const EXCHANGE_WORDS = /обмен валют|покупка валюты|продажа валюты|конвертаци/iu

/**
 * What the line is, by the format (MOL-429 Р-5). A line with no MCC is an own transfer where the bank says so:
 * «Учёт в аналитике: Нет» in the layout of 2026, its words in the one before, which has no such column. A line
 * with an MCC is a card's, never an own transfer — «Нет» is the person's to set on any line (adversarial А2). And
 * «Внутренний перевод» is no own word: T-Bank names so a transfer to any of its contracts, another person's too
 * (А1) — a transfer, «перевод — трата ли это?», a tap rather than a spending lost. The rest by the bank's
 * category, its words and the MCC. `analytics` is `null` for a layout without the column.
 */
function kindOf(
  category: string,
  payee: string,
  mcc: string | null,
  analytics: string | null,
): StatementLineKind {
  const said = `${category} ${payee}`
  const word = folded(category)
  if ((mcc !== null && CASH_MCC.has(mcc)) || word === 'наличные') return 'cash'
  const own = analytics === null ? OWN_WORDS.test(payee) : folded(analytics) === 'нет'
  if (mcc === null && own) return 'own_transfer'
  if (EXCHANGE_WORDS.test(said)) return 'exchange'
  if (FEE_WORDS.test(said)) return 'fee'
  if (word === 'переводы') return 'transfer'
  return mcc === null ? 'unknown' : 'purchase'
}

/** A record's line, `'none'` where no money moved, or why the file is refused. */
type Read = StatementLine | 'none' | StatementRefusal

function lineOf(
  cell: (column: Column) => string,
  row: number,
  hasAnalytics: boolean,
  phoneDay: ReturnType<typeof phoneDays>,
): Read {
  const unreadable: StatementRefusal = { reason: 'row_unreadable', row }

  const statusText = cell('status').trim()
  const statusWord = statusText.toLowerCase()
  const status = POSTED.has(statusWord) ? 'posted' : DECLINED.has(statusWord) ? 'declined' : null
  if (status === null)
    return { reason: 'status_unknown', status: cutText(statusText, REFUSAL_STATUS_MAX) }

  const accountCurrencyText = cell('debitedCurrency').trim()
  const accountCurrency = currencyOf(accountCurrencyText)
  if (accountCurrency === null)
    return {
      reason: 'currency_unknown',
      currency: cutText(accountCurrencyText, REFUSAL_CURRENCY_MAX),
    }
  const accountSum = signedMinor(cell('debited'), accountCurrency)
  if (accountSum === null) return unreadable

  // An operation in a currency Molvia has not got is the money that left the account (research §6):
  // the sum is right, which currency it was spent in is lost.
  const operationCurrency = currencyOf(cell('currency'))
  const operationSum =
    operationCurrency === null ? accountSum : signedMinor(cell('amount'), operationCurrency)
  if (operationSum === null) return unreadable

  const moment = phoneDay(cell('date'))
  if (moment === null) return unreadable
  const postedText = cell('posted').trim()
  const posted = postedText === '' ? null : printedMoment(postedText)
  if (postedText !== '' && posted === null) return unreadable

  // Decided once the whole record has read (review №4). Both sums zero: no money moved. One zero beside the
  // other, or signs apart: what left the account is not known — refused, never guessed; a declined line apart,
  // which moved nothing and settles nothing (В1), so it is left out as no money moved.
  if (operationSum === 0n && accountSum === 0n) return 'none'
  if (operationSum === 0n || accountSum === 0n || accountSum < 0n !== operationSum < 0n)
    return status === 'declined' ? 'none' : unreadable

  const abs = (minor: bigint) => (minor < 0n ? -minor : minor)
  const currency = operationCurrency ?? accountCurrency
  const payee = bankText(cell('payee'))
  const category = bankText(cell('category'))
  const mcc = mccOf(cell('mcc'))
  // The schema holds what is not read here: a day before the rates' epoch (`exchangeDaySchema`), an amount
  // past money's bounds — a record that does not read like any other.
  const line = statementLineSchema.safeParse({
    day: moment.day,
    postedOn: posted === null ? null : shiftedDay(posted.day, moment.shift),
    time: null,
    amount: { minor: abs(operationSum), currency },
    debited:
      currency === accountCurrency ? null : { minor: abs(accountSum), currency: accountCurrency },
    sign: operationSum < 0n ? '-' : '+',
    payee,
    mcc,
    bankCategory: category === '' ? null : category,
    status,
    kind: kindOf(category, payee, mcc, hasAnalytics ? cell('analytics') : null),
  })
  return line.success ? line.data : unreadable
}

/**
 * The records after the header, read once: exports glued into one file repeat their header, each part
 * beginning with it, and a record a part repeats of an earlier part, cell for cell, is one operation of two
 * exports sharing their edge (adversarial А4) — two like records of one part are two operations.
 */
function recordsOf(records: readonly CsvRecord[], header: readonly string[]): CsvRecord[] {
  // A part glued on keeps its byte order mark: only the file's first is dropped by the decoder.
  const isHeader = (cells: readonly string[]) =>
    cells.length === header.length &&
    cells.every((cell, at) => (at === 0 ? cell.replace(/^\uFEFF/u, '') : cell) === header[at])
  const partOf = new Map<string, number>()
  let part = 0
  const rows: CsvRecord[] = []
  for (const record of records) {
    if (isHeader(record.cells)) {
      part += 1
      continue
    }
    const key = record.cells.join('\u0000')
    const first = partOf.get(key)
    if (first !== undefined && first < part) continue
    if (first === undefined) partOf.set(key, part)
    rows.push(record)
  }
  return rows
}

/**
 * T-Bank's CSV as statements, one an account, in the order the file first names them; `zone` is the
 * phone's (`ZONE_HEADER`), Yerevan's where it named none. A line of zero is left out: no money moved.
 */
export function readTbankCsv(bytes: Uint8Array, zone?: string): TbankRead {
  const refuse = (refusal: StatementRefusal): TbankRead => ({ ok: false, refusal })
  const records = readCsvRecords(decodeStatementText(bytes), ';')
  const header = records?.[0]?.cells
  const columns = header === undefined ? null : columnsOf(header)
  if (records === null || header === undefined || columns === null)
    return refuse({ reason: 'format_unknown' })

  const rows = recordsOf(records.slice(1), header)
  if (rows.length > STATEMENT_LINES_MAX) return refuse({ reason: 'too_long' })

  const width = Math.max(...columns.values()) + 1
  const hasAnalytics = columns.has('analytics')
  const phoneDay = phoneDays(zone)
  const accounts = new Map<
    string,
    { name: string | null; currency: Currency; lines: StatementLine[] }
  >()
  for (const { cells, line: row } of rows) {
    if (cells.length < width) return refuse({ reason: 'row_unreadable', row })
    const cell = (column: Column) => {
      const at = columns.get(column)
      return at === undefined ? '' : (cells[at] ?? '')
    }
    const read = lineOf(cell, row, hasAnalytics, phoneDay)
    if (read === 'none') continue
    if ('reason' in read) return refuse(read)
    const name = bankText(cell('account')) || null
    // The account's currency: what left it where the operation's was another, else the amount's own.
    const currency = read.debited?.currency ?? read.amount.currency
    const key = `${name ?? ''}\u0000${currency}`
    const account = accounts.get(key) ?? { name, currency, lines: [] }
    account.lines.push(read)
    accounts.set(key, account)
  }
  return {
    ok: true,
    accounts: [...accounts.values()].map(({ name, currency, lines }) => ({
      name,
      currency,
      statement: { form: 'tbank-csv', accountId: null, accountNumber: null, period: null, lines },
    })),
  }
}
