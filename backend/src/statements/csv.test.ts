import { describe, expect, it } from 'vitest'
import { decodeStatementText, readCsvRecords } from './csv'

/** Windows-1251 of Russian letters and ASCII: what T-Bank's export before 2026 was written in. */
function cp1251(text: string): Uint8Array {
  return Uint8Array.from(Array.from(text), (char) => {
    const code = char.charCodeAt(0)
    if (code < 0x80) return code
    if (char === 'Ё') return 0xa8
    if (char === 'ё') return 0xb8
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0
    throw new Error(`no such letter in the test's 1251: ${char}`)
  })
}

describe('decodeStatementText', () => {
  it('reads UTF-8 and drops its byte order mark', () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('Имя счёта;Статус'),
    ])
    expect(decodeStatementText(bytes)).toBe('Имя счёта;Статус')
  })

  it('reads Windows-1251 where the bytes are no UTF-8', () => {
    expect(decodeStatementText(cp1251('Дата платежа;Статус;Ёлка'))).toBe('Дата платежа;Статус;Ёлка')
  })
})

const cellsOf = (text: string) => readCsvRecords(text, ';')?.map(({ cells }) => cells)

describe('readCsvRecords', () => {
  it('reads quoted fields holding the separator, a line break and a doubled quote', () => {
    const text = 'a;"b;c";"d\r\ne";"say ""hi"""\r\n1;2;3;4'
    expect(cellsOf(text)).toEqual([
      ['a', 'b;c', 'd\r\ne', 'say "hi"'],
      ['1', '2', '3', '4'],
    ])
  })

  it('takes CRLF, LF and CR alike, drops blank lines, and keeps a last line with no break', () => {
    expect(cellsOf('a;b\r\n\r\nc;d\n\ne;f\rg;h')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
      ['g', 'h'],
    ])
  })

  it('names the line of the file a record begins on, past a field of two lines and a blank line', () => {
    const text = 'head;x\r\n"two\r\nlines";1\r\n\r\nnext;2\n"three\n\nlines";3\rlast;4'
    expect(readCsvRecords(text, ';')?.map(({ line }) => line)).toEqual([1, 2, 5, 6, 9])
  })

  it('keeps empty fields, the last one too', () => {
    expect(cellsOf(';a;;\n')).toEqual([['', 'a', '', '']])
  })

  it('reads a quote inside a field not opened by one as a letter', () => {
    expect(cellsOf('ООО "Ромашка";1')).toEqual([['ООО "Ромашка"', '1']])
  })

  it('refuses a quote never closed', () => {
    expect(readCsvRecords('a;"b;c\n1;2', ';')).toBeNull()
  })

  it('reads nothing of an empty text', () => {
    expect(readCsvRecords('', ';')).toEqual([])
  })
})
