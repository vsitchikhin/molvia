import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseCbaRange } from './cba-history'
import {
  MARKET_SHEETS,
  marketFiles,
  parseMarketFile,
  readBybranch,
  readDaily,
  readExchangers,
} from './cba-market'
import { readSheet, sheetOf } from './xlsx'
import type { CellValue, Sheet } from './xlsx'

// The central bank's files recorded on 30.09.2026 at 10:26 in Yerevan, byte for byte (MOL-137).
function bytes(name: string): ArrayBuffer {
  const file = readFileSync(new URL(`../../tests/fixtures/rates/${name}`, import.meta.url))
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
}

/**
 * How long a test that opens a real workbook may take: exceljs spends one to five seconds on one,
 * and on a machine the other copies load the default five ran out (adversarial review, round 2).
 */
const EXCELJS_MS = 60_000

const BYBRANCH = 'cba-fx-bybranch-2026-09-30.xlsx'
const DAILY = 'cba-forex-daily-2026-09-30.xlsx'
const EXCHANGERS = 'cba-forex-2026-09-30.xlsx'

// Each recorded file is opened once: exceljs takes seconds over one, and the strictness of each
// reader is tested on the cells read, one of them changed, never by writing a workbook back.
const sheets = new Map<string, Sheet>()
beforeAll(async () => {
  const pairs = [
    [BYBRANCH, 'FX_bybranch_ENG.xlsx'],
    [DAILY, 'FOREX ENG_Daily.xlsx'],
    [EXCHANGERS, 'FOREX ENG.xlsx'],
  ] as const
  for (const [fixture, file] of pairs) {
    sheets.set(fixture, await readSheet(bytes(fixture), file, MARKET_SHEETS[file].sheet))
  }
}, EXCELJS_MS)

function recorded(fixture: string): Sheet {
  const sheet = sheets.get(fixture)
  if (!sheet) throw new Error(`${fixture} was not read`)
  return sheet
}

/** The recorded sheet with some cells changed — null takes a cell away. */
function changed(fixture: string, edits: Readonly<Record<string, CellValue>>): Sheet {
  const sheet = recorded(fixture)
  const cells = new Map(sheet.cells)
  for (const [ref, value] of Object.entries(edits)) {
    if (value === null) cells.delete(ref)
    else cells.set(ref, value)
  }
  return sheetOf(sheet.file, cells, sheet.rows)
}

describe('people in banks, cash and not (FX_bybranch)', () => {
  it('reads the row of natural persons of each currency: cash and non-cash on both sides', () => {
    const rates = readBybranch(recorded(BYBRANCH))
    expect(rates).toHaveLength(12)
    expect(rates.filter((rate) => rate.currency === 'RUB')).toEqual([
      {
        channel: 'bankCash',
        currency: 'RUB',
        date: '2026-09-29',
        side: 'bankBuys',
        scaled: 4_110_180n,
      },
      {
        channel: 'bankNoncash',
        currency: 'RUB',
        date: '2026-09-29',
        side: 'bankBuys',
        scaled: 4_221_606n,
      },
      {
        channel: 'bankCash',
        currency: 'RUB',
        date: '2026-09-29',
        side: 'bankSells',
        scaled: 4_347_948n,
      },
      {
        channel: 'bankNoncash',
        currency: 'RUB',
        date: '2026-09-29',
        side: 'bankSells',
        scaled: 4_361_759n,
      },
    ])
    expect(rates.find((rate) => rate.currency === 'USD')).toMatchObject({ scaled: 361_423_772n })
  })

  it('is refused whole when a rate is zero, a text or missing', () => {
    for (const value of [0, -1, 'n/a', null]) {
      expect(() => readBybranch(changed(BYBRANCH, { M13: value }))).toThrow(
        'FX_bybranch_ENG.xlsx: M13 is not a positive number',
      )
    }
  })

  it('is refused whole when the header moved', () => {
    expect(() => readBybranch(changed(BYBRANCH, { L11: 'No cash' }))).toThrow('L11 is not "Cash"')
  })

  it('is refused whole when the row of people of a currency is gone', () => {
    expect(() => readBybranch(changed(BYBRANCH, { D27: 'Trade' }))).toThrow('no single row of EUR')
  })

  it('is refused whole when the date is not a day', () => {
    for (const value of ['yesterday', '2026-02-31', 1.5]) {
      expect(() => readBybranch(changed(BYBRANCH, { E7: value }))).toThrow('E7 is not a day')
    }
  })

  it(
    'is refused whole when the sheet was renamed or the file is not a workbook',
    async () => {
      await expect(readSheet(bytes(BYBRANCH), 'FX_bybranch_ENG.xlsx', '6.16')).rejects.toThrow(
        'no sheet "6.16"',
      )
      await expect(
        parseMarketFile('FX_bybranch_ENG.xlsx', new TextEncoder().encode('<html>').buffer),
      ).rejects.toThrow('FX_bybranch_ENG.xlsx: not a workbook')
    },
    EXCELJS_MS,
  )
})

describe('all clients of banks (FOREX ENG_Daily)', () => {
  it('reads every working day since January 2022, both sides of three currencies', () => {
    const rates = readDaily(recorded(DAILY))
    expect(rates).toHaveLength(1196 * 6)
    expect(rates[0]).toEqual({
      channel: 'banksAll',
      currency: 'RUB',
      date: '2022-01-03',
      side: 'bankBuys',
      scaled: 6_391_133n,
    })
    expect(rates.filter((rate) => rate.date === '2026-09-29' && rate.currency === 'RUB')).toEqual([
      {
        channel: 'banksAll',
        currency: 'RUB',
        date: '2026-09-29',
        side: 'bankBuys',
        scaled: 4_217_687n,
      },
      {
        channel: 'banksAll',
        currency: 'RUB',
        date: '2026-09-29',
        side: 'bankSells',
        scaled: 4_330_908n,
      },
    ])
  })

  it('is refused whole when one day of four years has a zero', () => {
    expect(() => readDaily(changed(DAILY, { AA400: 0 }))).toThrow('AA400 is not a positive number')
  })

  it('is refused whole when a currency moved to other columns', () => {
    expect(() => readDaily(changed(DAILY, { Z6: 'EUR' }))).toThrow('Z6 is not "RUB"')
  })

  it('is refused whole when a row carries rates and no day (adversarial review, round 4, Д)', () => {
    expect(() => readDaily(changed(DAILY, { A1202: null }))).toThrow(
      'FOREX ENG_Daily.xlsx: row 1202 has no day',
    )
    expect(() => readDaily(changed(DAILY, { A600: null }))).toThrow('row 600 has no day')
  })

  it('passes over an empty row between two days', () => {
    const cells = new Map(recorded(DAILY).cells)
    for (const ref of [...cells.keys()]) if (/^[A-Z]+600$/.test(ref)) cells.delete(ref)
    const rates = readDaily(sheetOf(recorded(DAILY).file, cells, recorded(DAILY).rows))
    expect(rates).toHaveLength(1195 * 6)
  })

  it('is refused whole when the days are out of order', () => {
    const eighth = recorded(DAILY).value('A8')
    expect(() => readDaily(changed(DAILY, { A9: eighth }))).toThrow('A9 is not after the row above')
  })
})

/** The recorded sheet with an empty row put in before `at` — how a sheet laid out anew is made. */
function withRowBefore(fixture: string, at: number): Sheet {
  const sheet = recorded(fixture)
  const cells = new Map<string, CellValue>()
  for (const [ref, value] of sheet.cells) {
    const [, column = '', row = '0'] = /^([A-Z]+)(\d+)$/.exec(ref) ?? []
    const number = Number(row)
    cells.set(number >= at ? `${column}${String(number + 1)}` : ref, value)
  }
  return sheetOf(sheet.file, cells, sheet.rows + 1)
}

describe('exchange offices (FOREX ENG, 6.18)', () => {
  it('reads the whole week with an empty row put anywhere in it (adversarial review, round 3, Г)', () => {
    const whole = readExchangers(recorded(EXCHANGERS))
    // Rows 11–38 are seven days of four rows; every place between and inside them, and after.
    for (let at = 12; at <= 39; at += 1) {
      expect({ at, rates: readExchangers(withRowBefore(EXCHANGERS, at)) }).toEqual({
        at,
        rates: whole,
      })
    }
  })

  it('is refused whole when a row says a currency or a rate with no day', () => {
    expect(() => readExchangers(changed(EXCHANGERS, { B15: null }))).toThrow(
      'FOREX ENG.xlsx: row 15 has no day',
    )
    expect(() => readExchangers(changed(EXCHANGERS, { B40: null, E40: 361.2 }))).toThrow(
      'row 40 has no day',
    )
  })

  it('reads each day of the week by the day in its own row, skipping «Other»', () => {
    const rates = readExchangers(recorded(EXCHANGERS))
    expect(rates).toHaveLength(7 * 3 * 2)
    expect(new Set(rates.map((rate) => rate.date))).toEqual(
      new Set([
        '2026-09-14',
        '2026-09-15',
        '2026-09-16',
        '2026-09-17',
        '2026-09-18',
        '2026-09-19',
        '2026-09-20',
      ]),
    )
    expect(rates.find((rate) => rate.date === '2026-09-16' && rate.currency === 'USD')).toEqual({
      channel: 'exchanger',
      currency: 'USD',
      date: '2026-09-16',
      side: 'bankBuys',
      scaled: 361_073_721n,
    })
  })

  it('is refused whole when a day is missing a currency', () => {
    expect(() => readExchangers(changed(EXCHANGERS, { C13: 'Other' }))).toThrow(
      '2026-09-14 incomplete',
    )
  })

  it('is refused whole on a currency it does not know', () => {
    expect(() => readExchangers(changed(EXCHANGERS, { C12: 'GEL' }))).toThrow(
      'C12 is not a currency',
    )
  })
})

describe('the archive of the official rate', () => {
  const xml = readFileSync(
    new URL('../../tests/fixtures/rates/cba-range-2026-09-30.xml', import.meta.url),
    'utf8',
  )

  it('reads every working day of September, three currencies each, oldest first', () => {
    const rates = parseCbaRange(xml)
    expect(rates).toHaveLength(20 * 3)
    expect(rates[0]).toEqual({
      provider: 'cba',
      currency: 'USD',
      date: '2026-09-01',
      scaled: 364_260_000n,
    })
    expect(rates.at(-1)).toEqual({
      provider: 'cba',
      currency: 'RUB',
      date: '2026-09-29',
      scaled: 4_318_700n,
    })
  })

  it('is refused whole on a fault, a day missing a currency, a zero or no rows', () => {
    expect(() => parseCbaRange('<soap:Fault>x</soap:Fault>')).toThrow('range: SOAP fault')
    expect(() => parseCbaRange(xml.replace('<ISO>EUR</ISO>', '<ISO>GBP</ISO>'))).toThrow(
      'range: 2026-09-01 incomplete',
    )
    expect(() => parseCbaRange(xml.replace('<Rate>364.26</Rate>', '<Rate>0</Rate>'))).toThrow(
      'range: implausible USD on 2026-09-01',
    )
    expect(() =>
      parseCbaRange('<ExchangeRatesByDateRangeByISOResult></ExchangeRatesByDateRangeByISOResult>'),
    ).toThrow('range: no rates')
  })
})

describe('asking for a file', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * A server like the bank's (measured 30.09.2026, adversarial review Б): the same tag and moment on
   * `HEAD`, and 200 with the whole file on `GET` whatever conditional header it is sent.
   */
  function bank(version = { etag: '"{1924EE06},511"', modified: 'Tue, 29 Sep 2026 12:12:08 GMT' }) {
    const gets: RequestInit[] = []
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      const headers = { etag: version.etag, 'last-modified': version.modified }
      if (init?.method === 'HEAD') return Promise.resolve(new Response(null, { headers }))
      gets.push(init ?? {})
      return Promise.resolve(new Response(bytes(EXCHANGERS), { headers }))
    })
    vi.stubGlobal('fetch', fetch)
    const [, , exchangers] = marketFiles('https://example.test/')
    if (!exchangers) throw new Error('no file')
    return { exchangers, fetch, gets, version }
  }

  it(
    'downloads a file once, and after that asks its HEAD: the bank ignores If-None-Match',
    async () => {
      const { exchangers, fetch, gets } = bank()
      const first = await exchangers.fetch(null)
      if (first === 'unchanged') throw new Error('the first read is the file')
      expect(first.rates).toHaveLength(42)
      expect(await exchangers.fetch(first.version)).toBe('unchanged')
      expect(await exchangers.fetch(first.version)).toBe('unchanged')
      expect(gets).toHaveLength(1)
      expect(fetch.mock.calls[0]?.[0]).toBe('https://example.test/FOREX%20ENG.xlsx')
    },
    EXCELJS_MS,
  )

  it(
    'downloads it again once the bank changed it',
    async () => {
      const { exchangers, gets, version } = bank()
      const first = await exchangers.fetch(null)
      if (first === 'unchanged') throw new Error('the first read is the file')
      version.etag = '"{1924EE06},512"'
      expect(await exchangers.fetch(first.version)).not.toBe('unchanged')
      expect(gets).toHaveLength(2)
    },
    EXCELJS_MS,
  )

  it('reads anything but 200 as the bank being down', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('no', { status: 401 })))
    const [bybranch] = marketFiles('https://example.test/')
    await expect(bybranch?.fetch(null)).rejects.toThrow('FX_bybranch_ENG.xlsx: HTTP 401')
  })

  it('refuses a file its HEAD says is past twenty megabytes without downloading it', async () => {
    const gets: string[] = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (init?.method !== 'HEAD') gets.push(url)
      return Promise.resolve(
        new Response(null, { headers: { 'content-length': String(64 * 2 ** 20) } }),
      )
    })
    const [bybranch] = marketFiles('https://example.test/')
    await expect(bybranch?.fetch(null)).rejects.toThrow('FX_bybranch_ENG.xlsx: too large')
    expect(gets).toEqual([])
  })

  it('stops reading a body that runs past twenty megabytes with no length said (В)', async () => {
    let sent = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 2 ** 20
        controller.enqueue(new Uint8Array(2 ** 20))
      },
    })
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'HEAD' ? new Response(null) : new Response(endless)),
    )
    const [bybranch] = marketFiles('https://example.test/')
    await expect(bybranch?.fetch(null)).rejects.toThrow('FX_bybranch_ENG.xlsx: too large')
    expect(sent).toBeLessThanOrEqual(22 * 2 ** 20)
  })
})
