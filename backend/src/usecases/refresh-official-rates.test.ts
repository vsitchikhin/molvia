import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import { PUBLISHED } from '@molvia/model'
import type { AmdRate, CachedRate, RateProvider } from '@molvia/model'
import type { PastRate } from '@/db/rates-repository'
import { FeedError } from '@/rates/feed'
import type { Published, RateFeed } from '@/rates/feed'
import {
  ARCHIVE_DAYS_PER_RUN,
  ARCHIVE_GAP_DAYS,
  ARCHIVE_RECENT_DAYS,
  COUNTRY_JUMP_DAYS,
  FALLBACK_AFTER_FAILURES,
  HISTORY_EVERY_MS,
  HISTORY_RETRY_MS,
  OFFICIAL_HISTORY_FROM,
  archiveWalkFrom,
  missingDays,
  officialRatesRefresh,
  wholeDays,
} from './refresh-official-rates'
import type { HomeBankFeed } from './refresh-official-rates'

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

/**
 * A failure the feed did not word: the body of an answer cut off mid-read, as Node 22's `fetch`
 * throws it — `reach` words only a request with no answer at all (MOL-153).
 */
function cutOff(): Error {
  return new TypeError('terminated', {
    cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
  })
}

/** A write the database refused, as drizzle throws it: the query and its parameters in the message. */
function refusedWrite(): Error {
  return new DrizzleQueryError(
    'insert into "official_rates" ("provider", "currency", "date", "scaled") values ($1, $2, $3, $4)',
    ['cba', 'RUB', FRIDAY, '4312300'],
    Object.assign(new Error('write CONNECTION_ENDED 127.0.0.1:5500'), { code: 'CONNECTION_ENDED' }),
  )
}

/** A feed that answers or fails as the test switches it, and counts how often it was asked. */
function feed(provider: RateProvider, up = true, date = FRIDAY, failure = cutOff) {
  const state = { up, date, asked: 0 }
  const self: RateFeed = {
    provider,
    fetchLatest() {
      state.asked += 1
      return state.up ? Promise.resolve(answer(provider, state.date)) : Promise.reject(failure())
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
  /** The read of the earlier rates a jump is judged by fails, before anything is written. */
  historyFails?: boolean
  /** How the central bank fails when `cba` is false: by default, an answer cut off mid-read. */
  cbaFailure?: () => Error
}

function harness(options: Options = {}) {
  const cba = feed('cba', options.cba ?? true, options.cbaDate, options.cbaFailure)
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
        if (options.writeFails) return Promise.reject(refusedWrite())
        written.push([...new Set(rates.map((rate) => rate.provider))])
        cache.push(...rates)
        return Promise.resolve()
      },
      latestOnOrBefore: () => Promise.resolve(cache),
      history: (provider, currencies, date) => {
        if (options.historyFails) return Promise.reject(refusedWrite())
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
  it('сбой, который источник не назвал, — по виду, с кодом причины и датой последнего курса ЦБ РА (Д, MOL-153)', async () => {
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
    expect(warning?.details).toMatchObject({
      provider: 'cba',
      lastKnown: '2026-09-16',
      errorName: 'TypeError',
      code: 'UND_ERR_SOCKET',
    })
    expect(warning?.details).not.toHaveProperty('err')
    expect(JSON.stringify(h.warnings)).not.toContain('other side closed')
  })

  it('ответ, который источник не прочёл, пишется словами источника', async () => {
    const h = harness({ cba: false, cbaFailure: () => new FeedError('cba', 'HTTP 503') })
    await h.run()

    expect(h.warnings).toEqual([
      {
        message: 'official rate fetch failed',
        details: { provider: 'cba', lastKnown: null, reason: 'cba: HTTP 503' },
      },
    ])
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

  // A `DrizzleQueryError` carries the query and its parameters in its message and in fields of its
  // own, and pino writes an `err` whole (MOL-153).
  it.each([
    ['запись', { writeFails: true }],
    ['чтение прошлых курсов для метки скачка', { historyFails: true }],
  ])('сбой базы на шаге «%s» пишется по виду — ни запроса, ни параметров', async (_, options) => {
    const h = harness(options)
    await h.run()

    expect(h.written).toEqual([])
    expect(h.warnings).toEqual([
      {
        message: 'official rate cache write failed',
        details: {
          provider: 'cba',
          errorName: 'Error',
          code: 'CONNECTION_ENDED',
          frames: expect.any(Array) as unknown,
        },
      },
    ])
    const logged = JSON.stringify(h.warnings)
    for (const word of ['official_rates', '4312300', FRIDAY, '127.0.0.1']) {
      expect(logged).not.toContain(word)
    }
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

describe('the history of the central bank (MOL-137)', () => {
  const day = (date: string, scaled: bigint): AmdRate => ({
    provider: 'cba',
    currency: 'RUB',
    date,
    scaled,
  })
  const kept = (date: string, scaled: bigint, jump = false): CachedRate => ({
    ...day(date, scaled),
    jump,
  })

  it('writes only the days the cache does not have, and leaves a kept one as it is', () => {
    const archive = [day('2026-09-14', 4_300_000n), day('2026-09-15', 4_310_000n)]
    expect(missingDays(archive, [kept('2026-09-14', 4_299_000n, true)])).toEqual([
      { ...day('2026-09-15', 4_310_000n), jump: false },
    ])
  })

  it('judges a jump by the days before it, kept and new together, in the order of the days', () => {
    const archive = [
      day('2026-09-01', 4_300_000n),
      day('2026-09-02', 4_300_000n),
      day('2026-09-04', 430_000_000n),
      day('2026-09-07', 4_300_000n),
    ]
    const missing = missingDays(archive, [kept('2026-09-03', 4_300_000n)])
    expect(missing.map((rate) => [rate.date, rate.jump])).toEqual([
      ['2026-09-01', false],
      ['2026-09-02', false],
      // Three before it: the first two new and the one kept between them.
      ['2026-09-04', true],
      // The ×100 day is one of four before it, and the lower median holds.
      ['2026-09-07', false],
    ])
  })

  function historyHarness(fails: (boolean | 'future')[]) {
    let clock = NOW.getTime()
    const asked: [string, string][] = []
    const inserted: CachedRate[][] = []
    const warnings: string[] = []
    const run = officialRatesRefresh({
      primary: feed('cba').feed,
      fallbacks: [],
      rates: {
        upsert: () => Promise.resolve(),
        latestOnOrBefore: () => Promise.resolve([]),
        history: () => Promise.resolve(new Map()),
      },
      log: {
        warn: (_details, message) => {
          warnings.push(message)
        },
      },
      now: () => new Date(clock),
      history: {
        feed: {
          fetchRange: (from, to) => {
            asked.push([from, to])
            const outcome = fails.shift()
            if (outcome === 'future') return Promise.resolve([day('2026-09-21', 4_312_300n)])
            return outcome
              ? Promise.reject(new Error('down'))
              : Promise.resolve([day(FRIDAY, 4_312_300n)])
          },
        },
        rates: {
          between: () => Promise.resolve([]),
          insertMissing: (rates) => {
            inserted.push([...rates])
            return Promise.resolve(rates.length)
          },
        },
      },
    })
    return {
      run,
      asked,
      inserted,
      warnings,
      pass: (ms: number) => {
        clock += ms
      },
    }
  }

  it('asks for the whole archive since 2022 once a day', async () => {
    const history = historyHarness([false])
    await history.run()
    history.pass(HISTORY_EVERY_MS - 1)
    await history.run()
    expect(history.asked).toEqual([[OFFICIAL_HISTORY_FROM, '2026-09-19']])
    expect(history.inserted).toEqual([[{ ...day(FRIDAY, 4_312_300n), jump: false }]])
    history.pass(1)
    await history.run()
    expect(history.asked).toHaveLength(2)
  })

  it('refuses an archive with a day past tomorrow, writes none of it, asks again in six hours', async () => {
    const history = historyHarness(['future', false])
    await history.run()
    expect(history.inserted).toEqual([])
    expect(history.warnings).toEqual(['official history failed'])
    history.pass(60 * 60 * 1000)
    await history.run()
    expect(history.asked).toHaveLength(1)
    history.pass(HISTORY_RETRY_MS)
    await history.run()
    expect(history.inserted).toHaveLength(1)
  })

  it('asks again six hours after a failure, not every hour', async () => {
    const history = historyHarness([true, false])
    await history.run()
    expect(history.warnings).toEqual(['official history failed'])
    history.pass(HISTORY_RETRY_MS - 1)
    await history.run()
    expect(history.asked).toHaveLength(1)
    history.pass(1)
    await history.run()
    expect(history.inserted).toHaveLength(1)
  })
})

describe('банк страны: НБ Грузии (MOL-110)', () => {
  const HOUR = 60 * 60 * 1000
  const SATURDAY = '2026-09-19'

  // Every currency the bank publishes, as `published()` holds a real answer to (MOL-230): a day
  // missing one of them is a hole its walk comes back for.
  const lari = (date: string, rub = 4_348_959n): Published => ({
    provider: 'nbg',
    date,
    rates: PUBLISHED.nbg.map((currency) => ({
      provider: 'nbg',
      currency,
      date,
      scaled: currency === 'RUB' ? rub : currency === 'GEL' ? 139_349_516n : 3_471_475n,
    })),
  })

  /** The day before `day` when `day` is a Sunday: the bank answers a day off with Saturday's rate. */
  const inForce = (day: string): string => {
    const at = new Date(`${day}T00:00:00.000Z`)
    return at.getUTCDay() === 0
      ? new Date(at.getTime() - 86_400_000).toISOString().slice(0, 10)
      : day
  }

  function homeHarness({ cached = [] as CachedRate[], failOn = null as string | null } = {}) {
    let clock = NOW.getTime()
    const cache: CachedRate[] = [...cached]
    const askedOn: string[] = []
    const warnings: { details: Record<string, unknown>; message: string }[] = []
    const state = { latest: 0, rub: 4_348_959n }
    let dated = inForce
    const nbg: HomeBankFeed = {
      provider: 'nbg',
      fetchLatest: () => {
        state.latest += 1
        return Promise.resolve(lari(SATURDAY, state.rub))
      },
      fetchOn: (day) => {
        askedOn.push(day)
        return day === failOn ? Promise.reject(cutOff()) : Promise.resolve(lari(dated(day)))
      },
    }
    const cba = feed('cba')
    const cbr = feed('cbr')
    const run = officialRatesRefresh({
      primary: cba.feed,
      fallbacks: [cbr.feed],
      homeBanks: [nbg],
      rates: {
        upsert: (rates) => {
          cache.push(...rates)
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
      log: {
        warn: (details, message) =>
          warnings.push({ details: details as Record<string, unknown>, message }),
      },
      now: () => new Date(clock),
      history: {
        feed: { fetchRange: () => Promise.resolve([]) },
        rates: {
          between: (provider, from, to) =>
            Promise.resolve(
              cache
                .filter((row) => row.provider === provider && row.date >= from && row.date <= to)
                .sort((a, b) => (a.date < b.date ? -1 : 1)),
            ),
          insertMissing: (rates) => {
            cache.push(...rates)
            return Promise.resolve(rates.length)
          },
        },
      },
    })
    return {
      run,
      cache,
      askedOn,
      warnings,
      state,
      cbr: cbr.state,
      pass: (ms: number) => {
        clock += ms
      },
      /** Which day the archive answers a day with. */
      override: (answer: (day: string) => string) => {
        dated = answer
      },
    }
  }

  describe('archiveWalkFrom', () => {
    const today = '2026-09-19'
    const month = '2026-08-19'
    const lastMonth = ['2026-08-20', '2026-08-28', '2026-09-05', '2026-09-14', today]

    it('пустой кеш или одна строка часового ответа — сначала последний месяц (ревью 2)', () => {
      expect(ARCHIVE_RECENT_DAYS).toBe(31)
      expect(archiveWalkFrom([], OFFICIAL_HISTORY_FROM, today)).toEqual({
        from: month,
        whole: false,
      })
      expect(archiveWalkFrom([today], OFFICIAL_HISTORY_FROM, today)).toEqual({
        from: month,
        whole: false,
      })
    })

    it('месяц на месте — история с начала, потом со дня после первой дыры', () => {
      expect(archiveWalkFrom(lastMonth, OFFICIAL_HISTORY_FROM, today)).toEqual({
        from: OFFICIAL_HISTORY_FROM,
        whole: false,
      })
      expect(ARCHIVE_GAP_DAYS).toBe(10)
      // Шесть дней без курса — праздник, не дыра (Пасха 2026, самая длинная в архиве).
      const kept = ['2022-01-01', '2022-01-07', '2022-01-08', '2022-03-01', ...lastMonth]
      expect(archiveWalkFrom(kept, OFFICIAL_HISTORY_FROM, today)).toEqual({
        from: '2022-01-09',
        whole: false,
      })
    })

    it('банк завис на старой дате: хвост до сегодня — не дыра, проход отдыхает (ревью 5)', () => {
      // Последний свой день — 1 сентября, дальше банк отвечает им же; история целая.
      const hung = ['2026-08-10', '2026-08-15', '2026-08-25', '2026-09-01']
      // Месяц начинается со дня после 15.08 — последнего дня банка перед ним (адверсариальный Е).
      expect(archiveWalkFrom(hung, '2026-08-10', today)).toEqual({
        from: '2026-08-16',
        whole: true,
      })
      // А заговорил сегодня — дыра между двумя его днями, её и проходим.
      expect(archiveWalkFrom([...hung, today], '2026-08-10', today)).toEqual({
        from: '2026-08-16',
        whole: false,
      })
    })

    it('банк молчит дольше месяца: пустой месяц — хвост, не дыра (адверсариальный Д)', () => {
      // История целая, последний день банка — 5 августа, в месяце с 19.08 его дней нет.
      const silent = ['2026-07-01', '2026-07-10', '2026-07-20', '2026-07-28', '2026-08-05']
      expect(archiveWalkFrom(silent, '2026-07-01', today)).toEqual({ from: month, whole: true })
      // Дыра в истории перед пустым месяцем — дело истории, а не месяца.
      expect(archiveWalkFrom(['2026-06-01', '2026-08-01'], '2026-06-01', today)).toEqual({
        from: '2026-06-02',
        whole: false,
      })
    })

    it('простой чуть дольше месяца и молчащий банк: дни перед месяцем спрошены (адверсариальный Е)', () => {
      // Последний день перед простоем — 12.08, до начала месяца 7 дней: не праздник, а не спрошенное.
      const kept = ['2026-07-25', '2026-08-03', '2026-08-12']
      expect(archiveWalkFrom(kept, '2026-07-25', today)).toEqual({
        from: '2026-08-13',
        whole: true,
      })
    })

    it('простой дольше истории порции: заговоривший банк — сначала месяц, потом дыра истории', () => {
      const kept = ['2026-01-01', '2026-01-10', '2026-01-20', today]
      expect(archiveWalkFrom(kept, '2026-01-01', today)).toEqual({ from: month, whole: false })
      const walked = [...kept, '2026-08-19', '2026-08-28', '2026-09-07', '2026-09-16']
      expect(archiveWalkFrom(walked, '2026-01-01', today)).toEqual({
        from: '2026-01-21',
        whole: false,
      })
    })

    it('без дыр — только последний месяц, и архив цел до завтра', () => {
      const kept = ['2026-08-10', '2026-08-15', '2026-08-25', '2026-09-04', '2026-09-14', today]
      expect(archiveWalkFrom(kept, '2026-08-10', today)).toEqual({
        from: '2026-08-16',
        whole: true,
      })
      expect(archiveWalkFrom(['2026-09-10', today], '2026-09-10', today)).toEqual({
        from: '2026-09-10',
        whole: true,
      })
    })
  })

  it('спрашивается каждый час, когда ЦБ РА в порядке, и пишется; запасные не спрошены', async () => {
    const home = homeHarness()
    await home.run()
    home.pass(HOUR)
    await home.run()
    expect(home.state.latest).toBe(2)
    expect(home.cache.some((row) => row.provider === 'nbg' && row.date === SATURDAY)).toBe(true)
    expect(home.cbr.asked).toBe(0)
  })

  it('скачок меряется по его же курсам, а не по ЦБ РА', async () => {
    const own = ['2026-09-15', '2026-09-16', '2026-09-17'].map((date): CachedRate => ({
      provider: 'nbg',
      currency: 'RUB',
      date,
      scaled: 4_348_000n,
      jump: false,
    }))
    const home = homeHarness({ cached: own })
    home.state.rub = 6_000_000n
    await home.run()
    const written = home.cache.find(
      (row) => row.provider === 'nbg' && row.currency === 'RUB' && row.date === SATURDAY,
    )
    expect(written?.jump).toBe(true)
  })

  it('после выкатки скачок не меряется по 2022 году: в своих пяти — только неделя (адверсариальный А)', async () => {
    // Рубль весной 2022 по НБГ — 6,29 ֏, сегодня — 4,35: треть разницы, но это не скачок.
    const old = ['2022-04-28', '2022-04-29', '2022-04-30'].map((date): CachedRate => ({
      provider: 'nbg',
      currency: 'RUB',
      date,
      scaled: 6_286_000n,
      jump: false,
    }))
    const home = homeHarness({ cached: old })
    await home.run()
    const written = home.cache.find(
      (row) => row.provider === 'nbg' && row.currency === 'RUB' && row.date === SATURDAY,
    )
    expect(written?.jump).toBe(false)
  })

  it('после праздника скачок меряется: своих за две недели хватает (адверсариальный Г)', async () => {
    // Как 15.04.2026 после Пасхи: за неделю своих два, за две — пять. Рубль с запятой не там.
    const own = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].map(
      (date): CachedRate => ({
        provider: 'nbg',
        currency: 'RUB',
        date,
        scaled: 4_348_000n,
        jump: false,
      }),
    )
    expect(COUNTRY_JUMP_DAYS).toBe(14)
    const home = homeHarness({ cached: own })
    home.state.rub = 43_480_000n
    await home.run()
    const written = home.cache.find(
      (row) => row.provider === 'nbg' && row.currency === 'RUB' && row.date === SATURDAY,
    )
    expect(written?.jump).toBe(true)
  })

  it('архив: сначала последний месяц, потом история с начала, каждая порция — с места прошлой', async () => {
    const home = homeHarness()
    await home.run()
    expect(home.askedOn[0]).toBe('2026-08-19')
    expect(home.askedOn).toHaveLength(ARCHIVE_RECENT_DAYS + 1)
    // Вчерашний курс НБГ есть сразу после первого прохода: трата вчерашнего дня возьмёт его.
    expect(home.cache.some((row) => row.provider === 'nbg' && row.date === '2026-09-18')).toBe(true)
    home.pass(HOUR)
    await home.run()
    expect(home.askedOn[ARCHIVE_RECENT_DAYS + 1]).toBe(OFFICIAL_HISTORY_FROM)
    expect(home.askedOn).toHaveLength(ARCHIVE_RECENT_DAYS + 1 + ARCHIVE_DAYS_PER_RUN)
    const last = home.askedOn.at(-1) ?? ''
    home.pass(HOUR)
    await home.run()
    expect(home.askedOn[ARCHIVE_RECENT_DAYS + 1 + ARCHIVE_DAYS_PER_RUN]).toBe(
      new Date(Date.parse(`${last}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10),
    )
  })

  it('дошёл до сегодня — следующий раз через сутки и только последний месяц', async () => {
    const home = homeHarness()
    // A walk cut short goes on at the next run, whenever it comes: a minute apart keeps the day.
    for (let run = 0; run < 25; run += 1) {
      await home.run()
      home.pass(60_000)
    }
    expect(home.warnings).toEqual([])
    // Каждый день от начала истории спрошен; повторно — только дни последнего месяца.
    const asked = new Set(home.askedOn)
    for (
      let day = OFFICIAL_HISTORY_FROM;
      day <= SATURDAY;
      day = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
    ) {
      expect(asked.has(day), day).toBe(true)
    }
    const repeated = home.askedOn.filter((day, index) => home.askedOn.indexOf(day) !== index)
    expect(repeated.every((day) => day >= '2026-08-19')).toBe(true)
    // Воскресенье спрошено, но его ответ — суббота: строки воскресенья нет.
    expect(home.cache.some((row) => row.provider === 'nbg' && row.date === '2026-09-13')).toBe(
      false,
    )
    expect(home.cache.some((row) => row.provider === 'nbg' && row.date === '2026-09-12')).toBe(true)
    const rested = home.askedOn.length
    await home.run()
    expect(home.askedOn).toHaveLength(rested)
    home.pass(HISTORY_EVERY_MS)
    await home.run()
    expect(home.askedOn.length - rested).toBe(ARCHIVE_RECENT_DAYS + 1)
  })

  it('банк висел три недели и заговорил: дыру нечем заполнить — проход отдыхает (ревью 7)', async () => {
    const home = homeHarness()
    // С 20.08 по 13.09 на каждый день банк отвечал курсом 19.08; с 14.09 заговорил.
    home.override((day) =>
      day >= '2026-08-20' && day <= '2026-09-13' ? '2026-08-19' : inForce(day),
    )
    for (let run = 0; run < 25; run += 1) {
      await home.run()
      home.pass(60_000)
    }
    expect(home.warnings).toEqual([])
    const settled = home.askedOn.length
    for (let hour = 0; hour < 6; hour += 1) {
      home.pass(HOUR)
      await home.run()
    }
    expect(home.askedOn).toHaveLength(settled)
    expect(home.cache.some((row) => row.provider === 'nbg' && row.date === '2026-09-14')).toBe(true)
  })

  it('банк застыл и оттаял: его настоящие дни приходят на следующий день (адверсариальный, раунд 5, П3)', async () => {
    const home = homeHarness()
    const frozen = (day: string) =>
      day >= '2026-08-20' && day <= '2026-09-13' ? '2026-08-19' : inForce(day)
    home.override(frozen)
    for (let run = 0; run < 25; run += 1) {
      await home.run()
      home.pass(60_000)
    }
    expect(home.cache.some((row) => row.provider === 'nbg' && row.date === '2026-09-01')).toBe(
      false,
    )
    // Архив оттаял: эти дни у банка есть. Взгляд назавтра их приносит.
    home.override(inForce)
    home.pass(HISTORY_EVERY_MS)
    await home.run()
    expect(home.cache.some((row) => row.provider === 'nbg' && row.date === '2026-09-01')).toBe(true)
  })

  it('давняя дыра банка не гонит проход от неё до сегодня каждые сутки (ревью 8)', async () => {
    const home = homeHarness()
    // В марте 2024 банк висел три недели: на каждый день отвечал курсом 29.02.2024.
    home.override((day) =>
      day >= '2024-03-01' && day <= '2024-03-21' ? '2024-02-29' : inForce(day),
    )
    for (let run = 0; run < 25; run += 1) {
      await home.run()
      home.pass(60_000)
    }
    const perDay: number[] = []
    for (let dayOf = 0; dayOf < 3; dayOf += 1) {
      const before = home.askedOn.length
      for (let hour = 0; hour < 24; hour += 1) {
        home.pass(HOUR)
        await home.run()
      }
      perDay.push(home.askedOn.length - before)
    }
    // Только суточный взгляд на месяц (с днями перед ним), а не проход от марта 2024.
    expect(perDay.every((asked) => asked <= ARCHIVE_RECENT_DAYS + 1 + ARCHIVE_GAP_DAYS)).toBe(true)
    expect(home.warnings).toEqual([])
  })

  it('архив отдал завтрашний курс на сегодня — день пропущен, проход не отвергнут; позже завтра — отвергнут', async () => {
    const tomorrow = '2026-09-20'
    const home = homeHarness({ cached: [], failOn: null })
    const answers = new Map<string, string>([[SATURDAY, tomorrow]])
    home.override((day) => answers.get(day) ?? inForce(day))
    for (let run = 0; run < 20; run += 1) {
      await home.run()
      home.pass(60_000)
    }
    expect(home.warnings.map((warning) => warning.message)).not.toContain('official history failed')
    expect(home.cache.some((row) => row.provider === 'nbg' && row.date === '2026-09-18')).toBe(true)

    const broken = homeHarness()
    broken.override(() => '2026-09-25')
    await broken.run()
    expect(broken.warnings.map((warning) => warning.message)).toContain('official history failed')
  })

  it('сбой посреди порции — строка в логе, порция не пишется, повтор через шесть часов с того же места', async () => {
    const home = homeHarness({ failOn: '2022-01-05' })
    await home.run()
    expect(home.warnings).toEqual([])
    home.pass(60_000)
    await home.run()
    expect(home.warnings.map((warning) => warning.message)).toContain('official history failed')
    expect(home.cache.some((row) => row.provider === 'nbg' && row.date < '2026-01-01')).toBe(false)
    const asked = home.askedOn.length
    home.pass(HISTORY_RETRY_MS - 1)
    await home.run()
    expect(home.askedOn).toHaveLength(asked)
    home.pass(1)
    await home.run()
    expect(home.askedOn[asked]).toBe(OFFICIAL_HISTORY_FROM)
  })
  it('валюта, добавленная к набору банка, — дыра: обход дописывает её в записанные дни (MOL-230)', async () => {
    // История MOL-110 — рубль и лари, без динара (и без доллара с евро в этой подделке).
    const cached: CachedRate[] = []
    for (let at = Date.parse('2026-07-01'); at <= Date.parse(SATURDAY); at += 86_400_000) {
      const date = new Date(at).toISOString().slice(0, 10)
      cached.push(
        { provider: 'nbg', currency: 'RUB', date, scaled: 4_348_959n, jump: false },
        { provider: 'nbg', currency: 'GEL', date, scaled: 139_349_516n, jump: false },
      )
    }
    const home = homeHarness({ cached })
    await home.run()
    // Сначала последний месяц, как при любой дыре.
    expect(home.askedOn[0]).toBe('2026-08-19')
    const day = (date: string, currency: string) =>
      home.cache.filter(
        (row) => row.provider === 'nbg' && row.date === date && row.currency === currency,
      )
    expect(day('2026-09-01', 'RSD')).toHaveLength(1)
    // Записанное не трогается и не дублируется: пишутся только недостающие строки.
    expect(day('2026-09-01', 'RUB')).toHaveLength(1)
  })

  it('wholeDays — только дни со всеми валютами банка', () => {
    const row = (date: string, currency: AmdRate['currency']): AmdRate => ({
      provider: 'nbs',
      currency,
      date,
      scaled: 1_225_700n,
    })
    const rows = [
      ...PUBLISHED.nbs.map((currency) => row('2026-10-02', currency)),
      row('2026-10-05', 'RUB'),
      row('2026-10-05', 'USD'),
    ]
    expect(wholeDays(rows, 'nbs')).toEqual(['2026-10-02'])
    expect(wholeDays([], 'nbg')).toEqual([])
  })
})

describe('банк страны молчит — запасные (MOL-230)', () => {
  // Динара нет ни в одном ответе ЦБ РА: пока молчит НБС, свежий курс пары динара есть только у
  // запасных — а их спрашивали лишь за молчание ЦБ РА.
  function silentHome(bank: { up: boolean; date: string }) {
    const cba = feed('cba')
    const cbr = feed('cbr', true, SATURDAY_NBS)
    const cache: CachedRate[] = []
    const nbs: HomeBankFeed = {
      provider: 'nbs',
      fetchLatest: () =>
        bank.up
          ? Promise.resolve({
              provider: 'nbs',
              date: bank.date,
              rates: PUBLISHED.nbs.map((currency) => ({
                provider: 'nbs',
                currency,
                date: bank.date,
                scaled: 1_225_700n,
              })),
            })
          : Promise.reject(cutOff()),
      fetchOn: () => Promise.reject(cutOff()),
    }
    const run = officialRatesRefresh({
      primary: cba.feed,
      fallbacks: [cbr.feed],
      homeBanks: [nbs],
      rates: {
        upsert: (rates) => {
          cache.push(...rates)
          return Promise.resolve()
        },
        latestOnOrBefore: () => Promise.resolve(cache),
        history: () => Promise.resolve(new Map()),
      },
      log: { warn: () => undefined },
      now: () => NOW,
    })
    return { run, cbr: cbr.state }
  }
  const SATURDAY_NBS = '2026-09-19'

  it('НБС отвечает — запасные не спрашиваются', async () => {
    const h = silentHome({ up: true, date: FRIDAY })
    await times(h.run, FALLBACK_AFTER_FAILURES + 2)
    expect(h.cbr.asked).toBe(0)
  })

  it(`${String(FALLBACK_AFTER_FAILURES + 1)} сбоев НБС подряд — ЦБ РФ спрошен, хотя ЦБ РА в порядке`, async () => {
    const h = silentHome({ up: false, date: FRIDAY })
    await times(h.run, FALLBACK_AFTER_FAILURES)
    expect(h.cbr.asked).toBe(0)
    await h.run()
    expect(h.cbr.asked).toBe(1)
  })

  it('динар запасного мерится по НБ Грузии — запятая не на месте помечена скачком (ревью 2)', async () => {
    async function run(nbgDays: number) {
      const cache: CachedRate[] = []
      for (let day = 1; day <= nbgDays; day += 1) {
        const date = `2026-09-${String(10 + day)}`
        cache.push({ provider: 'nbg', currency: 'RSD', date, scaled: 3_471_475n, jump: false })
      }
      const rsd = (scaled: bigint): RateFeed => ({
        provider: 'cbr',
        fetchLatest: () =>
          Promise.resolve({
            provider: 'cbr',
            date: SATURDAY_NBS,
            rates: [{ provider: 'cbr', currency: 'RSD', date: SATURDAY_NBS, scaled }],
          }),
      })
      const silent: HomeBankFeed = {
        provider: 'nbs',
        fetchLatest: () => Promise.reject(cutOff()),
        fetchOn: () => Promise.reject(cutOff()),
      }
      const refresh = officialRatesRefresh({
        primary: feed('cba').feed,
        fallbacks: [rsd(34_800_000n)],
        homeBanks: [silent],
        rates: {
          upsert: (rates) => {
            cache.push(...rates)
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
      await times(refresh, FALLBACK_AFTER_FAILURES + 1)
      return cache.find((row) => row.provider === 'cbr' && row.currency === 'RSD')
    }
    // 34,80 драма за динар против 3,47 у НБ Грузии — скачок; у ЦБ РА динара нет вовсе.
    expect((await run(5))?.jump).toBe(true)
    // Меньше трёх курсов НБ Грузии — без суждения, как везде.
    expect((await run(2))?.jump).toBe(false)
  })

  it('НБС отвечает листом старше недели — запасные сразу', async () => {
    const h = silentHome({ up: true, date: '2026-09-01' })
    await h.run()
    expect(h.cbr.asked).toBe(1)
  })
})
