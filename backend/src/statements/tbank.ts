import {
  INT8_MAX,
  MINOR_EXPONENT,
  STATEMENT_LINES_MAX,
  STATEMENT_TEXT_MAX,
  currencySchema,
  dayIn,
  midnightIn,
  scaledFromDecimal,
  statementLineSchema,
} from '@molvia/model'
import type { Currency, Statement, StatementLine, StatementLineKind } from '@molvia/model'
import { decodeStatementText, readCsvRecords } from './csv'

// T-Bank's export of operations, CSV from the web cabinet (MOL-430, epic MOL-427): its lines as the
// duplicates rule reads them (`statement-line.ts`). The columns are found by their names, never their
// places — the format changed twice in five years, silently (b-russia.md, 1.4) — and a file this parser
// does not know is refused, never guessed. Parsed on the server and never kept (Д-3 «а» of MOL-409).

/** What a refusal names, for the answer of the upload (MOL-433) to say. */
export type TbankRefusal =
  /** Not T-Bank's export, or a version of it this parser does not know: the header is no layout's. */
  | { readonly reason: 'format_unknown' }
  /** A record whose date, amount or sign does not read — its number in the file, the header the first. */
  | { readonly reason: 'row_unreadable'; readonly row: number }
  /** A status no T-Bank file was seen with (owner's В-4 «а»): a hold or a cancellation, nobody knows. */
  | { readonly reason: 'status_unknown'; readonly status: string }
  /** An account in a currency Molvia keeps no account in. */
  | { readonly reason: 'currency_unknown'; readonly currency: string }
  /** More lines than the rule weighs at once (`STATEMENT_LINES_MAX`). */
  | { readonly reason: 'too_long' }

/** One account of the file — a file of the web cabinet may hold several — by the name the bank prints. */
export interface TbankAccount {
  readonly name: string | null
  readonly statement: Statement
}

export type TbankRead =
  | { readonly ok: true; readonly accounts: readonly TbankAccount[] }
  | { readonly ok: false; readonly refusal: TbankRefusal }

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
 * The two layouts known (b-russia.md, 1.2), by the columns read — a column not named here may come and go.
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

/** A header's name as compared: case, «ё», a hyphen and the spaces aside. */
function headerName(text: string): string {
  return text
    .replace(/ё/giu, 'е')
    .replace(/[\s\-\u2010\u2013]+/gu, ' ')
    .trim()
    .toLowerCase()
}

type Columns = ReadonlyMap<Column, number>

function columnsOf(header: readonly string[]): Columns | null {
  const names = header.map(headerName)
  for (const layout of LAYOUTS) {
    const columns = new Map<Column, number>()
    for (const [column, name] of Object.entries(layout) as [Column, string][]) {
      const at = names.indexOf(headerName(name))
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

/**
 * The day of an operation printed in Moscow's time, on the phone's calendar (MOL-121, Р-4): a dinner in
 * Yerevan at 00:30 is 23:30 in Moscow the day before, and a spending's day is the phone's. One file's
 * Moscow midnights are kept by their day: a year of lines is some 365 of them, and each is a zone's sum.
 */
function phoneDays(zone: string | undefined): (text: string) => string | null {
  const midnights = new Map<string, number>()
  return (text) => {
    const moment = printedMoment(text)
    if (moment === null) return null
    let midnight = midnights.get(moment.day)
    if (midnight === undefined) {
      midnight = midnightIn(moment.day, BANK_ZONE).getTime()
      midnights.set(moment.day, midnight)
    }
    return dayIn(new Date(midnight + moment.seconds * 1000), zone)
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

/** A bank's text as one line and no longer than a line's field may be. */
function bankText(text: string): string {
  return Array.from(text.replace(/\s+/gu, ' ').trim()).slice(0, STATEMENT_TEXT_MAX).join('')
}

/** An MCC of up to four digits, its leading zeros put back; anything else is none. */
function mccOf(text: string): string | null {
  const digits = text.trim()
  return /^\d{1,4}$/u.test(digits) ? digits.padStart(4, '0') : null
}

const CASH_MCC = new Set(['6010', '6011'])
const OWN_WORDS =
  /между своими счетами|перевод себе|внутренний перевод|пополнение вклада|снятие с вклада/iu
const FEE_WORDS = /комисси|услуги банка/iu
const EXCHANGE_WORDS = /обмен валют|покупка валюты|продажа валюты|конвертаци/iu

/**
 * What the line is, by the format (MOL-429 Р-5): «Учёт в аналитике: Нет» is the bank's own word that the
 * money stayed the person's — between their accounts, into a deposit or the round-up; the format before 2026
 * says the same in words. The rest by the bank's category, its words and the MCC.
 */
function kindOf(
  category: string,
  payee: string,
  mcc: string | null,
  analytics: string,
): StatementLineKind {
  const said = `${category} ${payee}`
  if (headerName(analytics) === 'нет' || OWN_WORDS.test(payee)) return 'own_transfer'
  if ((mcc !== null && CASH_MCC.has(mcc)) || headerName(category) === 'наличные') return 'cash'
  if (EXCHANGE_WORDS.test(said)) return 'exchange'
  if (FEE_WORDS.test(said)) return 'fee'
  if (headerName(category) === 'переводы') return 'transfer'
  return mcc === null ? 'unknown' : 'purchase'
}

type Read = StatementLine | 'zero' | TbankRefusal

function lineOf(
  cells: readonly string[],
  row: number,
  columns: Columns,
  phoneDay: (text: string) => string | null,
): Read {
  const cell = (column: Column) => {
    const at = columns.get(column)
    return at === undefined ? '' : (cells[at] ?? '')
  }
  const unreadable: TbankRefusal = { reason: 'row_unreadable', row }

  const statusText = cell('status').trim()
  const status = POSTED.has(statusText.toLowerCase())
    ? 'posted'
    : DECLINED.has(statusText.toLowerCase())
      ? 'declined'
      : null
  if (status === null)
    return { reason: 'status_unknown', status: Array.from(statusText).slice(0, 32).join('') }

  const accountCurrency = currencyOf(cell('debitedCurrency'))
  if (accountCurrency === null)
    return {
      reason: 'currency_unknown',
      currency: Array.from(cell('debitedCurrency').trim()).slice(0, 8).join(''),
    }
  const accountSum = signedMinor(cell('debited'), accountCurrency)
  if (accountSum === null) return unreadable

  // An operation in a currency Molvia has not got is the money that left the account (research §6):
  // the sum is right, which currency it was spent in is lost.
  const operationCurrency = currencyOf(cell('currency'))
  const operationSum =
    operationCurrency === null ? accountSum : signedMinor(cell('amount'), operationCurrency)
  if (operationSum === null) return unreadable
  if (operationSum === 0n) return 'zero'
  if (accountSum !== 0n && accountSum < 0n !== operationSum < 0n) return unreadable

  const day = phoneDay(cell('date'))
  if (day === null) return unreadable
  const postedText = cell('posted').trim()
  const posted = postedText === '' ? null : printedMoment(postedText)
  if (postedText !== '' && posted === null) return unreadable

  const abs = (minor: bigint) => (minor < 0n ? -minor : minor)
  const currency = operationCurrency ?? accountCurrency
  const payee = bankText(cell('payee'))
  const category = bankText(cell('category'))
  const mcc = mccOf(cell('mcc'))
  const line = statementLineSchema.safeParse({
    day,
    postedOn: posted?.day ?? null,
    time: null,
    amount: { minor: abs(operationSum), currency },
    debited:
      currency !== accountCurrency && accountSum !== 0n
        ? { minor: abs(accountSum), currency: accountCurrency }
        : null,
    sign: operationSum < 0n ? '-' : '+',
    payee,
    mcc,
    bankCategory: category === '' ? null : category,
    status,
    kind: kindOf(category, payee, mcc, cell('analytics')),
  })
  return line.success ? line.data : unreadable
}

/**
 * T-Bank's CSV as statements, one an account, in the order the file first names them; `zone` is the
 * phone's (`ZONE_HEADER`), Yerevan's where it named none. A line of zero is left out: no money moved.
 */
export function readTbankCsv(bytes: Uint8Array, zone?: string): TbankRead {
  const refuse = (refusal: TbankRefusal): TbankRead => ({ ok: false, refusal })
  const records = readCsvRecords(decodeStatementText(bytes), ';')
  const header = records?.[0]
  const columns = header === undefined ? null : columnsOf(header)
  if (records === null || header === undefined || columns === null)
    return refuse({ reason: 'format_unknown' })

  // Exports glued into one file repeat their header: it is no line.
  const headerKey = header.map(headerName).join(';')
  const rows = records
    .map((cells, at) => ({ cells, row: at + 1 }))
    .slice(1)
    .filter(({ cells }) => cells.map(headerName).join(';') !== headerKey)
  if (rows.length > STATEMENT_LINES_MAX) return refuse({ reason: 'too_long' })

  const width = Math.max(...columns.values()) + 1
  const phoneDay = phoneDays(zone)
  const accounts = new Map<string | null, StatementLine[]>()
  for (const { cells, row } of rows) {
    if (cells.length < width) return refuse({ reason: 'row_unreadable', row })
    const read = lineOf(cells, row, columns, phoneDay)
    if (read === 'zero') continue
    if ('reason' in read) return refuse(read)
    const at = columns.get('account')
    const name = at === undefined ? null : bankText(cells[at] ?? '') || null
    const lines = accounts.get(name) ?? []
    lines.push(read)
    accounts.set(name, lines)
  }
  return {
    ok: true,
    accounts: [...accounts].map(([name, lines]) => ({
      name,
      statement: { form: 'tbank-csv', accountId: null, accountNumber: null, period: null, lines },
    })),
  }
}
