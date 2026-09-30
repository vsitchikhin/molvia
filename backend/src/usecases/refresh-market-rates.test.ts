import { describe, expect, it } from 'vitest'
import type { CachedRate, MarketRate } from '@molvia/model'
import type { MarketAnswer, MarketFile } from '@/rates/cba-market'
import { FeedError } from '@/rates/feed'
import { marketRatesRefresh } from './refresh-market-rates'

// Wednesday 30.09.2026, noon in Yerevan.
const NOW = new Date('2026-09-30T08:00:00.000Z')

const OFFICIAL: CachedRate[] = [
  { provider: 'cba', currency: 'RUB', date: '2026-09-29', scaled: 4_318_700n, jump: false },
  { provider: 'cba', currency: 'USD', date: '2026-09-29', scaled: 363_180_000n, jump: false },
]

function rouble(scaled: bigint, date = '2026-09-29'): MarketRate {
  return { channel: 'bankCash', currency: 'RUB', date, side: 'bankBuys', scaled }
}

/** A file that says what the test hands it, remembering the tags it was asked with. */
function file(name: string, answers: (MarketAnswer | 'unchanged' | Error)[]) {
  const asked: (string | null)[] = []
  const self: MarketFile = {
    name,
    fetch(etag) {
      asked.push(etag)
      const next = answers.shift() ?? 'unchanged'
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
    },
  }
  return { file: self, asked }
}

function harness(files: MarketFile[], { writeFails = false } = {}) {
  const written: MarketRate[][] = []
  const warnings: { details: Record<string, unknown>; message: string }[] = []
  const run = marketRatesRefresh({
    files,
    market: {
      upsert: (rates) => {
        if (writeFails) return Promise.reject(new Error('insert into market_rates … 4.11'))
        written.push([...rates])
        return Promise.resolve()
      },
    },
    rates: { between: () => Promise.resolve(OFFICIAL) },
    log: {
      warn: (details, message) => {
        warnings.push({ details: details as Record<string, unknown>, message })
      },
    },
    now: () => NOW,
  })
  return { run, written, warnings }
}

describe('marketRatesRefresh', () => {
  it('writes a file whole and asks the next time by its tag', async () => {
    const bybranch = file('FX_bybranch_ENG.xlsx', [{ etag: '"a"', rates: [rouble(4_110_180n)] }])
    const { run, written } = harness([bybranch.file])
    await run()
    await run()
    expect(written).toEqual([[rouble(4_110_180n)]])
    expect(bybranch.asked).toEqual([null, '"a"'])
  })

  it('refuses a file whole when one figure is over fifteen percent from the official rate', async () => {
    const shifted = file('FX_bybranch_ENG.xlsx', [
      { etag: '"a"', rates: [rouble(4_110_180n), rouble(475_836_214n)] },
    ])
    const { run, written, warnings } = harness([shifted.file])
    await run()
    await run()
    expect(written).toEqual([])
    expect(warnings[0]).toMatchObject({
      message: 'market rates refused',
      details: { reason: 'far from the official rate', currency: 'RUB', date: '2026-09-29' },
    })
    // Refused, so its tag is not kept: the next hour asks for the file afresh.
    expect(shifted.asked).toEqual([null, null])
  })

  it('lets through the widest spread there is — the rouble in cash', async () => {
    const cash = file('FX_bybranch_ENG.xlsx', [{ etag: null, rates: [rouble(4_110_180n)] }])
    const { run, written } = harness([cash.file])
    await run()
    expect(written).toHaveLength(1)
  })

  it('holds a day of the history the official cache does not reach by its header alone', async () => {
    const old = file('FOREX ENG_Daily.xlsx', [
      { etag: null, rates: [rouble(6_391_133n, '2022-01-03')] },
    ])
    const { run, written } = harness([old.file])
    await run()
    expect(written).toHaveLength(1)
  })

  it('refuses a file dated after today', async () => {
    const future = file('FX_bybranch_ENG.xlsx', [
      { etag: null, rates: [rouble(4_110_180n, '2026-10-01')] },
    ])
    const { run, written, warnings } = harness([future.file])
    await run()
    expect(written).toEqual([])
    expect(warnings[0]?.details).toMatchObject({ reason: 'dated in the future' })
  })

  it('reads the other files when one fails, and logs a feed by its own words', async () => {
    const down = file('FX_bybranch_ENG.xlsx', [
      new FeedError('cba', 'FX_bybranch_ENG.xlsx: HTTP 401'),
    ])
    const daily = file('FOREX ENG_Daily.xlsx', [{ etag: null, rates: [rouble(4_217_687n)] }])
    const { run, written, warnings } = harness([down.file, daily.file])
    await run()
    expect(written).toHaveLength(1)
    expect(warnings[0]).toEqual({
      message: 'market rates failed',
      details: { file: 'FX_bybranch_ENG.xlsx', reason: 'cba: FX_bybranch_ENG.xlsx: HTTP 401' },
    })
  })

  it('logs a failure of the database by its kind, never by its message', async () => {
    const bybranch = file('FX_bybranch_ENG.xlsx', [{ etag: null, rates: [rouble(4_110_180n)] }])
    const { run, warnings } = harness([bybranch.file], { writeFails: true })
    await run()
    expect(warnings[0]?.details).toMatchObject({ file: 'FX_bybranch_ENG.xlsx', errorName: 'Error' })
    expect(JSON.stringify(warnings)).not.toContain('4.11')
  })

  it('does nothing with a file that did not change', async () => {
    const same = file('FOREX ENG.xlsx', ['unchanged'])
    const { run, written, warnings } = harness([same.file])
    await run()
    expect(written).toEqual([])
    expect(warnings).toEqual([])
  })
})
