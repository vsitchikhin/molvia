import ExcelJS from 'exceljs'
import { RATE_DIGITS, isRateDay, scaledFromDecimal } from '@molvia/model'
import { FeedError } from './feed'

/** What one cell holds as it would print: a formula's cached result, a date, a number, a text. */
export type CellValue = string | number | Date | null

/**
 * One sheet of a workbook, read for its values and nothing else (MOL-137). Every accessor refuses
 * what it did not expect with a `FeedError` naming the file and the cell: the central bank's
 * statistics are a spreadsheet nobody promised to keep in shape, and a column that moved must be a
 * loud failure of the whole file, never a number read from the wrong place.
 */
export interface Sheet {
  readonly file: string
  readonly cells: ReadonlyMap<string, CellValue>
  readonly rows: number
  value(ref: string): CellValue
  text(ref: string): string
  /** A positive number, as the rate columns hold them. */
  positive(ref: string): number
  /** A day, whether the cell holds a date, an Excel serial or the text `YYYY-MM-DD`. */
  day(ref: string): string
}

// Excel counts days from the 30th of December 1899 — the 1900 leap-year bug folded in.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const DAY_MS = 24 * 60 * 60 * 1000

function plain(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) return value
  if (typeof value === 'object') {
    // A formula keeps its last result beside it: that is the number the file shows.
    if ('result' in value) return plain(value.result)
    if ('richText' in value) return value.richText.map((run) => run.text).join('')
    if ('text' in value && typeof value.text === 'string') return value.text
  }
  return null
}

/** Drams per unit at the rate scale, from the float a spreadsheet keeps. */
export function scaledFromCell(value: number): bigint | null {
  return Number.isFinite(value) && value > 0
    ? scaledFromDecimal(value.toFixed(RATE_DIGITS), RATE_DIGITS)
    : null
}

/**
 * A sheet over its cells, by address. What `readSheet` returns, and what a test builds from a
 * recorded file with one cell changed — the strictness of a reader is tested without writing a
 * workbook back.
 */
export function sheetOf(file: string, cells: ReadonlyMap<string, CellValue>, rows: number): Sheet {
  const fail = (reason: string): FeedError => new FeedError('cba', `${file}: ${reason}`)
  const value = (ref: string): CellValue => cells.get(ref) ?? null
  return {
    file,
    cells,
    rows,
    value,
    text(ref) {
      const cell = value(ref)
      if (typeof cell !== 'string') throw fail(`${ref} is not a text`)
      return cell.replace(/\s+/g, ' ').trim()
    },
    positive(ref) {
      const cell = value(ref)
      if (typeof cell !== 'number' || !Number.isFinite(cell) || cell <= 0) {
        throw fail(`${ref} is not a positive number`)
      }
      return cell
    },
    day(ref) {
      const cell = value(ref)
      const day =
        cell instanceof Date
          ? cell.toISOString().slice(0, 10)
          : typeof cell === 'number' && Number.isInteger(cell)
            ? new Date(EXCEL_EPOCH_MS + cell * DAY_MS).toISOString().slice(0, 10)
            : typeof cell === 'string'
              ? cell.trim()
              : ''
      if (!isRateDay(day)) throw fail(`${ref} is not a day`)
      return day
    },
  }
}

/**
 * The sheet `name` of the workbook in `bytes`, read into its cells once. `file` names the source in
 * every refusal. A workbook that does not open, or has no such sheet, is refused whole. A merged
 * cell reads as its first cell in every place it covers — the files merge a currency down its block.
 */
export async function readSheet(bytes: ArrayBuffer, file: string, name: string): Promise<Sheet> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(bytes)
  } catch {
    throw new FeedError('cba', `${file}: not a workbook`)
  }
  const sheet = workbook.getWorksheet(name)
  if (!sheet) throw new FeedError('cba', `${file}: no sheet ${JSON.stringify(name)}`)
  const cells = new Map<string, CellValue>()
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const value = plain(cell.value)
      if (value !== null) cells.set(cell.address, value)
    })
  })
  return sheetOf(file, cells, sheet.rowCount)
}
