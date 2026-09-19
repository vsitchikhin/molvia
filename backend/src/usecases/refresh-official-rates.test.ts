import { describe, expect, it } from 'vitest'
import type { AmdRate, CachedRate, RateProvider } from '@molvia/model'
import type { PastRate } from '@/db/rates-repository'
import type { Published, RateFeed } from '@/rates/feed'
import { FALLBACK_AFTER_FAILURES, officialRatesRefresh } from './refresh-official-rates'

// Saturday 19.09.2026, noon in Yerevan; the central bank's latest is Friday's.
const NOW = new Date('2026-09-19T08:00:00.000Z')
const FRIDAY = '2026-09-18'

function answer(provider: RateProvider, date = FRIDAY): Published {
  const rates: AmdRate[] = [
    { provider, currency: 'RUB', date, scaled: 4_312_300n },
    { provider, currency: 'USD', date, scaled: 363_440_000n },
    { provider, currency: 'EUR', date, scaled: 417_050_000n },
  ]
  return { provider, date, rates }
}

/** A feed that answers or fails as the test switches it, and counts how often it was asked. */
function feed(provider: RateProvider, up = true, date = FRIDAY) {
  const state = { up, date, asked: 0 }
  const self: RateFeed = {
    provider,
    fetchLatest() {
      state.asked += 1
      return state.up
        ? Promise.resolve(answer(provider, state.date))
        : Promise.reject(new Error('down', { cause: new Error('ENOTFOUND api.cba.am') }))
    },
  }
  return { feed: self, state }
}

interface Options {
  cba?: boolean
  cbr?: boolean
  erapi?: boolean
  cbaDate?: string
  cbrDate?: string
  /** What the cache already holds of the central bank, before this run. */
  cached?: CachedRate[]
  writeFails?: boolean
}

function harness(options: Options = {}) {
  const cba = feed('cba', options.cba ?? true, options.cbaDate)
  const cbr = feed('cbr', options.cbr ?? true, options.cbrDate)
  const erapi = feed('erapi', options.erapi ?? true, '2026-09-19')
  const written: RateProvider[][] = []
  const warnings: { details: Record<string, unknown>; message: string }[] = []
  const cache: CachedRate[] = [...(options.cached ?? [])]
  const run = officialRatesRefresh({
    primary: cba.feed,
    fallbacks: [cbr.feed, erapi.feed],
    rates: {
      upsert: (rates) => {
        if (options.writeFails) return Promise.reject(new Error('connection terminated'))
        written.push([...new Set(rates.map((rate) => rate.provider))])
        cache.push(...rates)
        return Promise.resolve()
      },
      latestOnOrBefore: () => Promise.resolve(cache),
      history: (provider, currencies, date) => {
        const byCurrency = new Map<AmdRate['currency'], PastRate[]>()
        for (const currency of currencies) {
          const own = cache
            .filter(
              (row) => row.provider === provider && row.currency === currency && row.date < date,
            )
            .sort((a, b) => (a.date < b.date ? 1 : -1))
          byCurrency.set(
            currency,
            own.map((row) => ({ date: row.date, scaled: row.scaled })),
          )
        }
        return Promise.resolve(byCurrency)
      },
    },
    log: {
      warn: (details, message) =>
        warnings.push({ details: details as Record<string, unknown>, message }),
    },
    now: () => NOW,
  })
  return { run, cba: cba.state, cbr: cbr.state, erapi: erapi.state, written, warnings }
}

async function times(run: () => Promise<void>, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) await run()
}

describe('обновление официальных курсов', () => {
  it('ЦБ РА ответил пятничным курсом в субботу — пишется он, запасные не спрашиваются', async () => {
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
    expect(h.warnings.at(-1)?.details).toMatchObject({ provider: 'erapi' })
  })
})

describe('Р-18: ЦБ РА отвечает, но курс стоит', () => {
  it('ответ ЦБ РА старше недели — запасные спрошены сразу, без пяти сбоев', async () => {
    const h = harness({ cbaDate: '2026-09-01' })
    await h.run()
    expect(h.cbr.asked).toBe(1)
    expect(h.written).toEqual([['cba'], ['cbr']])
  })

  it('ровно неделя — ещё свежий, запасные не спрашиваются', async () => {
    const h = harness({ cbaDate: '2026-09-12' })
    await h.run()
    expect(h.cbr.asked).toBe(0)
  })

  it('ЦБ РФ отдал такой же старый курс — спрошен и open.er-api', async () => {
    const h = harness({ cbaDate: '2026-09-01', cbrDate: '2026-09-01' })
    await h.run()
    expect(h.erapi.asked).toBe(1)
    expect(h.written).toEqual([['cba'], ['cbr'], ['erapi']])
  })

  it('ЦБ РА падает, а в кеше его курс старше недели — запасные с первого же сбоя', async () => {
    const stale: CachedRate = {
      provider: 'cba',
      currency: 'RUB',
      date: '2026-09-01',
      scaled: 1n,
      jump: false,
    }
    const h = harness({ cba: false, cached: [stale] })
    await h.run()
    expect(h.cbr.asked).toBe(1)
  })

  it('ЦБ РА падает, а кеш пуст — ждём пяти сбоев: молчание без даты ещё не старость', async () => {
    const h = harness({ cba: false })
    await h.run()
    expect(h.cbr.asked).toBe(0)
  })
})

describe('лог сбоя', () => {
  it('несёт саму ошибку с причиной и дату последнего курса ЦБ РА (Д, С-2)', async () => {
    const cached: CachedRate = {
      provider: 'cba',
      currency: 'RUB',
      date: '2026-09-16',
      scaled: 1n,
      jump: false,
    }
    const h = harness({ cba: false, cached: [cached] })
    await h.run()

    const [warning] = h.warnings
    expect(warning?.message).toBe('official rate fetch failed')
    expect(warning?.details).toMatchObject({ provider: 'cba', lastKnown: '2026-09-16' })
    const err = warning?.details.err as Error
    expect((err.cause as Error).message).toBe('ENOTFOUND api.cba.am')
  })

  it('база не приняла ответ — это сбой записи, а не ЦБ РА: запасные не спрошены (Г)', async () => {
    const h = harness({ writeFails: true })
    await times(h.run, FALLBACK_AFTER_FAILURES + 1)

    expect(h.cbr.asked).toBe(0)
    expect(h.warnings[0]).toMatchObject({
      message: 'official rate cache write failed',
      details: { provider: 'cba' },
    })
  })
})

describe('Р-19: метка скачка', () => {
  const day = (date: string, scaled: bigint): CachedRate => ({
    provider: 'cba',
    currency: 'RUB',
    date,
    scaled,
    jump: false,
  })

  it('курс, ушедший от медианы прошлых больше чем на четверть, пишется с меткой и попадает в лог', async () => {
    const cached = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'].map((date) =>
      day(date, 4_300_000n),
    )
    const h = harness({ cached })
    const upserted: CachedRate[][] = []
    const run = officialRatesRefresh({
      primary: {
        provider: 'cba',
        fetchLatest: () => {
          const published = answer('cba')
          const rates = published.rates.map((rate) =>
            rate.currency === 'RUB' ? { ...rate, scaled: 431_230_000n } : rate,
          )
          return Promise.resolve({ ...published, rates })
        },
      },
      fallbacks: [],
      rates: {
        upsert: (rates) => {
          upserted.push([...rates])
          return Promise.resolve()
        },
        latestOnOrBefore: () => Promise.resolve(cached),
        history: () =>
          Promise.resolve(
            new Map([['RUB', cached.map((row) => ({ date: row.date, scaled: row.scaled }))]]),
          ),
      },
      log: {
        warn: (details, message) =>
          h.warnings.push({ details: details as Record<string, unknown>, message }),
      },
      now: () => NOW,
    })

    await run()

    expect(upserted[0]?.map((rate) => [rate.currency, rate.jump])).toEqual([
      ['RUB', true],
      ['USD', false],
      ['EUR', false],
    ])
    expect(h.warnings).toMatchObject([
      { message: 'official rate jumped', details: { provider: 'cba', currency: 'RUB' } },
    ])
  })

  it('первый курс поставщика — меряться не с чем, метки нет', async () => {
    const h = harness()
    await h.run()
    expect(h.warnings).toEqual([])
  })
})

describe('Р-22: запасной меряется по ЦБ РА, пока своей свежей истории нет', () => {
  const past = (provider: RateProvider, date: string, scaled: bigint): CachedRate => ({
    provider,
    currency: 'RUB',
    date,
    scaled,
    jump: false,
  })
  const cbaWeek = ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'].map((date) =>
    past('cba', date, 4_312_300n),
  )

  function fallbackRun(cached: CachedRate[], rub: bigint) {
    const cache = [...cached]
    const upserted: CachedRate[] = []
    const run = officialRatesRefresh({
      // The central bank answers with a stale date, so the open source is asked (Р-18).
      primary: { provider: 'cba', fetchLatest: () => Promise.resolve(answer('cba', '2026-09-08')) },
      fallbacks: [
        {
          provider: 'cbr',
          fetchLatest: () => {
            const published = answer('cbr', '2026-09-19')
            const rates = published.rates.map((rate) =>
              rate.currency === 'RUB' ? { ...rate, scaled: rub } : rate,
            )
            return Promise.resolve({ ...published, rates })
          },
        },
      ],
      rates: {
        upsert: (rates) => {
          upserted.push(...rates)
          return Promise.resolve()
        },
        latestOnOrBefore: () => Promise.resolve(cache),
        history: (provider, currencies, date) =>
          Promise.resolve(
            new Map(
              currencies.map((currency) => [
                currency,
                cache
                  .filter(
                    (row) =>
                      row.provider === provider && row.currency === currency && row.date < date,
                  )
                  .sort((a, b) => (a.date < b.date ? 1 : -1))
                  .map((row) => ({ date: row.date, scaled: row.scaled })),
              ]),
            ),
          ),
      },
      log: { warn: () => undefined },
      now: () => NOW,
    })
    return { run, upserted }
  }

  it('Е: первый ответ ЦБ РФ рублём ×100 — сверен с ЦБ РА и помечен', async () => {
    const { run, upserted } = fallbackRun(cbaWeek, 431_230_000n)
    await run()
    expect(upserted.find((row) => row.provider === 'cbr' && row.currency === 'RUB')?.jump).toBe(
      true,
    )
  })

  it('честный первый ответ ЦБ РФ рядом с курсом ЦБ РА — без метки', async () => {
    const { run, upserted } = fallbackRun(cbaWeek, 4_316_500n)
    await run()
    expect(upserted.find((row) => row.provider === 'cbr' && row.currency === 'RUB')?.jump).toBe(
      false,
    )
  })

  it('своя свежая история из трёх есть — меряется по ней, а не по ЦБ РА', async () => {
    // ЦБ РА помнит 4.31, а ЦБ РФ всю неделю отдаёт 6.0: для него 6.0 — не скачок.
    const own = ['2026-09-16', '2026-09-17', '2026-09-18'].map((date) =>
      past('cbr', date, 6_000_000n),
    )
    const { run, upserted } = fallbackRun([...cbaWeek, ...own], 6_000_000n)
    await run()
    expect(upserted.find((row) => row.provider === 'cbr' && row.currency === 'RUB')?.jump).toBe(
      false,
    )
  })

  it('своя история старше недели не в счёт — снова ЦБ РА', async () => {
    const old = ['2026-03-01', '2026-03-02', '2026-03-03'].map((date) =>
      past('cbr', date, 4_312_300n),
    )
    const { run, upserted } = fallbackRun([...cbaWeek, ...old], 431_230_000n)
    await run()
    expect(upserted.find((row) => row.provider === 'cbr' && row.currency === 'RUB')?.jump).toBe(
      true,
    )
  })
})

describe('Р-25: ответ из будущего', () => {
  it('ЦБ РА с датой 9999-12-31 — сбой: не пишется, считается, и на шестом раз зовёт запасной', async () => {
    const h = harness({ cbaDate: '9999-12-31' })
    for (let index = 0; index <= FALLBACK_AFTER_FAILURES; index += 1) await h.run()

    expect(h.written).toEqual([['cbr']])
    expect(h.warnings[0]).toMatchObject({
      message: 'official rate dated in the future',
      details: { provider: 'cba', date: '9999-12-31' },
    })
  })

  it('ЦБ РФ с завтрашней датой — законно, пишется', async () => {
    const h = harness({ cba: false, cbrDate: '2026-09-20' })
    for (let index = 0; index <= FALLBACK_AFTER_FAILURES; index += 1) await h.run()
    expect(h.written).toEqual([['cbr']])
  })
})
