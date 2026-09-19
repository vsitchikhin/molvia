import { describe, expect, it } from 'vitest'
import type { AmdRate, RateProvider } from '@molvia/model'
import type { Published, RateFeed } from '@/rates/feed'
import { FALLBACK_AFTER_FAILURES, officialRatesRefresh } from './refresh-official-rates'

function answer(provider: RateProvider): Published {
  const rates: AmdRate[] = [
    { provider, currency: 'RUB', date: '2026-09-18', scaled: 4_312_300n },
    { provider, currency: 'USD', date: '2026-09-18', scaled: 363_440_000n },
    { provider, currency: 'EUR', date: '2026-09-18', scaled: 417_050_000n },
  ]
  return { provider, date: '2026-09-18', rates }
}

/** A feed that answers or fails as the test switches it, and counts how often it was asked. */
function feed(provider: RateProvider, up = true) {
  const state = { up, asked: 0 }
  const self: RateFeed = {
    provider,
    fetchLatest() {
      state.asked += 1
      return state.up ? Promise.resolve(answer(provider)) : Promise.reject(new Error('down'))
    },
  }
  return { feed: self, state }
}

function harness(options: { cba?: boolean; cbr?: boolean; erapi?: boolean } = {}) {
  const cba = feed('cba', options.cba ?? true)
  const cbr = feed('cbr', options.cbr ?? true)
  const erapi = feed('erapi', options.erapi ?? true)
  const written: RateProvider[][] = []
  const warnings: object[] = []
  const run = officialRatesRefresh({
    primary: cba.feed,
    fallbacks: [cbr.feed, erapi.feed],
    rates: {
      upsert: (rates) => {
        written.push([...new Set(rates.map((rate) => rate.provider))])
        return Promise.resolve()
      },
    },
    log: { warn: (details) => warnings.push(details) },
  })
  return { run, cba: cba.state, cbr: cbr.state, erapi: erapi.state, written, warnings }
}

async function times(run: () => Promise<void>, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) await run()
}

describe('обновление официальных курсов', () => {
  it('ЦБ РА ответил — пишется его ответ, запасные не спрашиваются', async () => {
    const h = harness()
    await h.run()
    expect(h.written).toEqual([['cba']])
    expect(h.cbr.asked).toBe(0)
    expect(h.warnings).toEqual([])
  })

  it(`${String(FALLBACK_AFTER_FAILURES)} сбоев ЦБ РА подряд — запасной ещё не спрошен`, async () => {
    const h = harness({ cba: false })
    await times(h.run, FALLBACK_AFTER_FAILURES)
    expect(h.cbr.asked).toBe(0)
    expect(h.written).toEqual([])
    expect(h.warnings).toHaveLength(FALLBACK_AFTER_FAILURES)
  })

  it('шестой сбой подряд — ЦБ РА спрошен первым, потом ЦБ РФ, и пишется ЦБ РФ', async () => {
    const h = harness({ cba: false })
    await times(h.run, FALLBACK_AFTER_FAILURES + 1)
    expect(h.cba.asked).toBe(FALLBACK_AFTER_FAILURES + 1)
    expect(h.cbr.asked).toBe(1)
    expect(h.erapi.asked).toBe(0)
    expect(h.written).toEqual([['cbr']])
  })

  it('ЦБ РФ тоже молчит — пишется open.er-api', async () => {
    const h = harness({ cba: false, cbr: false })
    await times(h.run, FALLBACK_AFTER_FAILURES + 1)
    expect(h.erapi.asked).toBe(1)
    expect(h.written).toEqual([['erapi']])
  })

  it('пока ЦБ РА молчит, запасные спрашиваются на каждом обновлении', async () => {
    const h = harness({ cba: false })
    await times(h.run, FALLBACK_AFTER_FAILURES + 3)
    expect(h.cbr.asked).toBe(3)
    expect(h.written).toEqual([['cbr'], ['cbr'], ['cbr']])
  })

  it('ЦБ РА вернулся — счётчик в ноль, и следующему сбою снова нужно шесть подряд', async () => {
    const h = harness({ cba: false })
    await times(h.run, FALLBACK_AFTER_FAILURES + 1)
    h.cba.up = true
    await h.run()
    expect(h.written).toEqual([['cbr'], ['cba']])

    h.cba.up = false
    await times(h.run, FALLBACK_AFTER_FAILURES)
    expect(h.cbr.asked).toBe(1)
  })

  it('молчат все — ни строки, ни исключения, только строки в логе', async () => {
    const h = harness({ cba: false, cbr: false, erapi: false })
    await expect(times(h.run, FALLBACK_AFTER_FAILURES + 1)).resolves.toBeUndefined()
    expect(h.written).toEqual([])
    expect(h.warnings.at(-1)).toMatchObject({ provider: 'erapi' })
  })

  it('база не приняла ответ — это сбой того поставщика, а не падение', async () => {
    const warnings: object[] = []
    const run = officialRatesRefresh({
      primary: feed('cba').feed,
      fallbacks: [],
      rates: { upsert: () => Promise.reject(new Error('check violated')) },
      log: { warn: (details) => warnings.push(details) },
    })
    await expect(run()).resolves.toBeUndefined()
    expect(warnings).toMatchObject([{ provider: 'cba' }])
  })
})
