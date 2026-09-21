import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ERROR } from '#model/support/errors'
import { convertMoney } from '#model/entities/trip'
import { money } from '#model/values/money'
import {
  OFFICIAL_RATE_FRESH_DAYS,
  RATE_SCALE,
  decimalFromRate,
  exchangeRateSchema,
  formatRate,
  isRateDay,
  isRateFresh,
  isRateJump,
  parseRate,
  pickOfficialRate,
  rateCodec,
  rateFromAmd,
  yerevanDate,
  yerevanMidnight,
} from '#model/values/rates'
import type { AmdRate, CachedRate, ExchangeRate, RateProvider } from '#model/values/rates'
import type { Currency } from '#model/values/money'

const asOf = new Date('2026-09-08T10:00:00Z')

const rate = {
  base: 'RUB',
  quote: 'AMD',
  scaled: 4_820_000n,
  source: 'official',
  asOf,
}

describe('parseRate', () => {
  it('scales a rate the way a receipt writes it', () => {
    expect(parseRate('4.82')).toBe(4_820_000n)
    expect(parseRate('4,82')).toBe(4_820_000n)
    expect(parseRate('4.820000')).toBe(4_820_000n)
    expect(parseRate('1')).toBe(1_000_000n)
  })

  it('rejects a rate that is zero, negative or too precise to be one', () => {
    for (const bad of ['0', '-4.82', '4.8200001', 'abc', '']) {
      expect(() => parseRate(bad)).toThrow(expect.objectContaining({ code: ERROR.INVALID_RATE }))
    }
  })

  it('has its own code: «invalid amount» is the wrong sentence under «мой курс»', () => {
    expect(() => parseRate('abc')).toThrow(expect.objectContaining({ code: ERROR.INVALID_RATE }))
  })

  it('rejects a rate outside any plausible band', () => {
    // A millionth of a dram per rouble turned a 1 000 ֏ trip into ten million roubles.
    for (const bad of ['0.000001', '0.00001', '9999999']) {
      expect(() => parseRate(bad)).toThrow(expect.objectContaining({ code: ERROR.INVALID_RATE }))
    }
    expect(parseRate('0.0001')).toBe(100n)
    expect(parseRate('1000000')).toBe(RATE_SCALE * 1_000_000n)
  })

  it('round-trips through the decimal form', () => {
    expect(decimalFromRate(parseRate('4.82'))).toBe('4.820000')
  })
})

describe('exchangeRateSchema', () => {
  it('accepts a rate between two currencies', () => {
    expect(exchangeRateSchema.parse(rate).scaled).toBe(4_820_000n)
  })

  it('refuses a rate from a currency to itself', () => {
    // Not 1 — a mistake upstream: nothing should have built a rate at all.
    expect(() => exchangeRateSchema.parse({ ...rate, quote: 'RUB' })).toThrow()
  })

  it('refuses a non-positive rate', () => {
    expect(() => exchangeRateSchema.parse({ ...rate, scaled: 0n })).toThrow()
  })
})

describe('rateCodec', () => {
  it('carries the rate and its date over a wire that holds neither natively', () => {
    const value = exchangeRateSchema.parse(rate)
    expect(() => JSON.stringify(value)).toThrow(TypeError)

    const wire = z.encode(rateCodec, value)
    expect(wire).toEqual({
      base: 'RUB',
      quote: 'AMD',
      rate: '4.820000',
      source: 'official',
      asOf: '2026-09-08T10:00:00.000Z',
    })
    expect(rateCodec.parse(JSON.parse(JSON.stringify(wire)))).toEqual(value)
  })

  it('refuses a malformed rate rather than coercing it', () => {
    const wire = {
      base: 'RUB',
      quote: 'AMD',
      rate: 'abc',
      source: 'official',
      asOf: asOf.toISOString(),
    }
    expect(() => rateCodec.parse(wire)).toThrow()
  })

  it('reports a bad rate through safeParse rather than escaping it', () => {
    const parsed = rateCodec.safeParse({
      base: 'RUB',
      quote: 'AMD',
      rate: 'abc',
      source: 'official',
      asOf: asOf.toISOString(),
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0]).toMatchObject({ path: ['rate'] })
  })

  it('refuses a date that is not ISO', () => {
    const wire = {
      base: 'RUB',
      quote: 'AMD',
      rate: '4.820000',
      source: 'official',
      asOf: '08.09.2026',
    }
    expect(() => rateCodec.parse(wire)).toThrow()
  })
})

// What the Central Bank of Armenia published for 18.09.2026, read on 19.09.
const amd = (
  currency: AmdRate['currency'],
  value: string,
  date = '2026-09-18',
  provider: RateProvider = 'cba',
  jump = false,
): CachedRate => ({ provider, currency, date, scaled: parseRate(value), jump })

const cba18 = [amd('RUB', '4.3123'), amd('USD', '363.44'), amd('EUR', '417.05')]

describe('yerevanDate and yerevanMidnight', () => {
  it('turns the day at 20:00 UTC, which is midnight in Yerevan', () => {
    expect(yerevanDate(new Date('2026-09-18T19:59:59.999Z'))).toBe('2026-09-18')
    expect(yerevanDate(new Date('2026-09-18T20:00:00.000Z'))).toBe('2026-09-19')
  })

  it('starts a Yerevan day at 20:00 UTC of the day before', () => {
    expect(yerevanMidnight('2026-09-18').toISOString()).toBe('2026-09-17T20:00:00.000Z')
    expect(yerevanDate(yerevanMidnight('2026-09-18'))).toBe('2026-09-18')
  })
})

describe('rateFromAmd', () => {
  it('takes the published number as it is for a currency against the dram', () => {
    expect(rateFromAmd('RUB', 'AMD', cba18, 'official')).toEqual({
      base: 'RUB',
      quote: 'AMD',
      scaled: 4_312_300n,
      source: 'official',
      asOf: yerevanMidnight('2026-09-18'),
    })
  })

  it('inverts for the dram against a currency, rounding at the sixth digit', () => {
    // 1 / 4.3123 = 0.23189481…
    expect(rateFromAmd('AMD', 'RUB', cba18, 'official')?.scaled).toBe(231_895n)
    // 1 / 363.44 = 0.00275148…: the worst pair, four significant digits.
    expect(rateFromAmd('AMD', 'USD', cba18, 'official')?.scaled).toBe(2_751n)
  })

  it('crosses two currencies through the dram', () => {
    // 4.3123 / 363.44 = 0.01186523…
    expect(rateFromAmd('RUB', 'USD', cba18, 'official')?.scaled).toBe(11_865n)
    // 417.05 / 4.3123 = 96.7117316…
    expect(rateFromAmd('EUR', 'RUB', cba18, 'official')?.scaled).toBe(96_711_732n)
  })

  it('rounds half up rather than truncating', () => {
    // 1 / 1.6 = 0.625 exactly; 1 / 3 = 0.3333333… rounds down, 2 / 3 = 0.6666666… rounds up.
    const three = [amd('RUB', '3'), amd('USD', '1.5')]
    expect(rateFromAmd('AMD', 'RUB', three, 'official')?.scaled).toBe(333_333n)
    expect(rateFromAmd('USD', 'RUB', three, 'official')?.scaled).toBe(500_000n)
    expect(rateFromAmd('RUB', 'USD', [amd('RUB', '2'), amd('USD', '3')], 'official')?.scaled).toBe(
      666_667n,
    )
  })

  it('dates a cross by its older half', () => {
    const mixed = [amd('RUB', '4.3123', '2026-09-18'), amd('USD', '363.44', '2026-09-11')]
    expect(rateFromAmd('RUB', 'USD', mixed, 'official')?.asOf).toEqual(
      yerevanMidnight('2026-09-11'),
    )
  })

  it('builds nothing from half a pair, a pair of one currency, or a rate outside the band', () => {
    expect(rateFromAmd('RUB', 'USD', [amd('RUB', '4.3123')], 'official')).toBeNull()
    expect(rateFromAmd('RUB', 'AMD', [amd('USD', '363.44')], 'official')).toBeNull()
    expect(rateFromAmd('AMD', 'AMD', cba18, 'official')).toBeNull()
    expect(rateFromAmd('RUB', 'RUB', cba18, 'official')).toBeNull()
    // 0.0001 / 1 000 000 is below any plausible rate: refused rather than snapshotted.
    const far = [amd('RUB', '0.0001'), amd('USD', '1000000')]
    expect(rateFromAmd('RUB', 'USD', far, 'official')).toBeNull()
  })

  it('builds nothing the snapshot would refuse for its date', () => {
    // 1970 is what an aggregator's zero update time becomes; a trip refuses anything before 2000.
    expect(rateFromAmd('RUB', 'AMD', [amd('RUB', '4.3148', '1970-01-01')], 'fallback')).toBeNull()
    expect(
      rateFromAmd('RUB', 'AMD', [amd('RUB', '4.3148', '2000-01-02')], 'fallback'),
    ).not.toBeNull()
  })

  it('isRateDay: a calendar day whose Yerevan midnight a snapshot accepts', () => {
    expect(isRateDay('2026-09-18')).toBe(true)
    expect(isRateDay('2024-02-29')).toBe(true)
    expect(isRateDay('2026-02-31')).toBe(false)
    // Its midnight in Yerevan is still 1999 in UTC.
    expect(isRateDay('2000-01-01')).toBe(false)
    expect(isRateDay('2000-01-02')).toBe(true)
    expect(isRateDay('18.09.2026')).toBe(false)
  })

  it('always builds what the snapshot schema accepts', () => {
    for (const [base, quote] of [
      ['RUB', 'AMD'],
      ['AMD', 'RUB'],
      ['RUB', 'USD'],
      ['USD', 'EUR'],
      ['AMD', 'USD'],
    ] as const) {
      const rate = rateFromAmd(base, quote, cba18, 'official')
      expect(exchangeRateSchema.parse(rate)).toEqual(rate)
    }
  })

  it('converts a trip total the way the screen will show it', () => {
    const rate = rateFromAmd('RUB', 'AMD', cba18, 'official')
    if (!rate) throw new Error('no rate')
    // 10 000 ֏ / 4.3123 = 2 318.948… ₽
    expect(convertMoney(money(1_000_000n, 'AMD'), rate)).toEqual(money(231_895n, 'RUB'))
  })
})

describe('pickOfficialRate', () => {
  const pick = (...args: Parameters<typeof pickOfficialRate>) =>
    pickOfficialRate(...args)?.rate ?? null
  const sunday = '2026-09-20'

  it('takes the Friday rate of the central bank on a Sunday, not a fresher open source', () => {
    const rows = [
      ...cba18,
      amd('RUB', '4.3165', sunday, 'cbr'),
      amd('RUB', '4.3148', sunday, 'erapi'),
    ]
    expect(pick('RUB', 'AMD', rows, sunday)).toMatchObject({
      scaled: 4_312_300n,
      source: 'official',
      asOf: yerevanMidnight('2026-09-18'),
    })
  })

  it('keeps the central bank up to exactly a week of silence, and not a day more', () => {
    const rows = [amd('RUB', '4.3123', '2026-09-18'), amd('RUB', '4.3165', '2026-09-26', 'cbr')]
    expect(OFFICIAL_RATE_FRESH_DAYS).toBe(7)
    expect(pick('RUB', 'AMD', rows, '2026-09-25')?.source).toBe('official')
    expect(pick('RUB', 'AMD', rows, '2026-09-26')).toMatchObject({
      scaled: 4_316_500n,
      source: 'fallback',
    })
  })

  it('keeps a stale central bank rate, with its date, when no open source is fresher', () => {
    const rows = [amd('RUB', '4.3123', '2026-09-01'), amd('RUB', '4.30', '2026-08-30', 'cbr')]
    expect(pick('RUB', 'AMD', rows, sunday)).toMatchObject({
      source: 'official',
      asOf: yerevanMidnight('2026-09-01'),
    })
  })

  it('takes the freshest open source, the other central bank on a tie', () => {
    const cbr = amd('RUB', '4.3165', '2026-09-19', 'cbr')
    const erapi = amd('RUB', '4.3148', '2026-09-19', 'erapi')
    expect(pick('RUB', 'AMD', [erapi, cbr], sunday)?.scaled).toBe(4_316_500n)
    const newer = amd('RUB', '4.3148', sunday, 'erapi')
    expect(pick('RUB', 'AMD', [cbr, newer], sunday)?.scaled).toBe(4_314_800n)
  })

  it('takes an open source when the central bank has never answered', () => {
    const rows = [amd('RUB', '4.3148', '2026-09-19', 'erapi')]
    expect(pick('RUB', 'AMD', rows, sunday)?.source).toBe('fallback')
  })

  it('never builds a pair from two providers', () => {
    // The central bank has the rouble, only the aggregator has the dollar: no rate at all.
    const rows = [amd('RUB', '4.3123'), amd('USD', '363.50', '2026-09-19', 'erapi')]
    expect(pick('RUB', 'USD', rows, sunday)).toBeNull()
  })

  it('ignores a rate dated after today, as a bank that sets tomorrow early publishes it', () => {
    const rows = [amd('RUB', '4.3123', '2026-09-18'), amd('RUB', '4.40', '2026-09-21')]
    expect(pick('RUB', 'AMD', rows, sunday)?.scaled).toBe(4_312_300n)
    expect(pick('RUB', 'AMD', [amd('RUB', '4.40', '2026-09-21')], sunday)).toBeNull()
  })

  it('takes the latest row of a provider when the cache holds several days', () => {
    const rows = [amd('RUB', '4.2971', '2026-09-11'), amd('RUB', '4.3123', '2026-09-18')]
    expect(pick('RUB', 'AMD', rows, sunday)?.scaled).toBe(4_312_300n)
  })

  it('has nothing for an empty cache or for spending what one earns', () => {
    expect(pick('RUB', 'AMD', [], sunday)).toBeNull()
    expect(pick('AMD', 'AMD', cba18, sunday)).toBeNull()
  })
})

describe('isRateJump', () => {
  const r = (value: string) => parseRate(value)
  const recent = ['4.3123', '4.3050', '4.2971', '4.3100', '4.2900'].map(r)

  it('ловит сдвиг запятой в обе стороны', () => {
    expect(isRateJump(r('431.23'), recent)).toBe(true)
    expect(isRateJump(r('0.043123'), recent)).toBe(true)
  })

  it('четверть от медианы — ещё не скачок, чуть больше — уже скачок', () => {
    // median 4.3050; a quarter of it is 1.07625
    expect(isRateJump(r('5.38125'), recent)).toBe(false)
    expect(isRateJump(r('5.381251'), recent)).toBe(true)
    expect(isRateJump(r('3.22875'), recent)).toBe(false)
    expect(isRateJump(r('3.228749'), recent)).toBe(true)
  })

  it('первый курс не с чем сравнить — не скачок', () => {
    expect(isRateJump(r('431.23'), [])).toBe(false)
  })

  it('isRateFresh: завтра — ещё свежий (ЦБ РФ ставит курс заранее), дальше — нет (З)', () => {
    expect(isRateFresh('2026-09-20', '2026-09-19')).toBe(true)
    expect(isRateFresh('2026-09-21', '2026-09-19')).toBe(false)
    expect(isRateFresh('9999-12-31', '2026-09-19')).toBe(false)
  })

  it('медиана, а не последний: один неверный день в истории не делает скачком верный', () => {
    expect(isRateJump(r('4.3123'), [r('431.23'), ...recent.slice(0, 4)])).toBe(false)
  })

  it('движение, продержавшееся три дня из пяти, перестаёт быть скачком', () => {
    const moved = ['6.0', '6.0', '6.0', '4.31', '4.30'].map(r)
    expect(isRateJump(r('6.0'), moved)).toBe(false)
  })

  it('смотрит только на пять последних', () => {
    const long = [...recent, ...Array.from({ length: 10 }, () => r('100'))]
    expect(isRateJump(r('4.31'), long)).toBe(false)
  })

  it('чётное число — нижняя медиана: среднее двух сдвинулось бы от одной ошибки', () => {
    // lower median of 4, 4.2, 6, 431.23 is 4.2
    const four = ['4', '4.2', '6', '431.23'].map(r)
    expect(isRateJump(r('5.25'), four)).toBe(false)
    expect(isRateJump(r('5.250001'), four)).toBe(true)
  })

  it('Ж: меньше трёх прошлых курсов — не судим, иначе одна ошибка делает скачком верный день', () => {
    expect(isRateJump(r('4.3123'), [r('431.23'), r('4.31')])).toBe(false)
    expect(isRateJump(r('4.3123'), [r('431.23')])).toBe(false)
    expect(isRateJump(r('4.3123'), [r('431.23'), r('4.31'), r('4.311')])).toBe(false)
    expect(isRateJump(r('431.23'), [r('4.31'), r('4.30'), r('4.311')])).toBe(true)
  })
})

describe('pickOfficialRate: скачок', () => {
  const sunday = '2026-09-20'

  it('курс скачком — поход считает по нему, а прежний отдаётся на выбор', () => {
    const rows = [
      amd('RUB', '431.23', '2026-09-18', 'cba', true),
      amd('RUB', '4.3050', '2026-09-17'),
    ]
    expect(pickOfficialRate('RUB', 'AMD', rows, sunday)).toEqual({
      jumped: true,
      // Прежний — того же издателя и того же источника: пара из двух источников не пара.
      provider: 'cba',
      rate: expect.objectContaining({
        scaled: 431_230_000n,
        asOf: yerevanMidnight('2026-09-18'),
      }) as unknown,
      previous: expect.objectContaining({
        scaled: 4_305_000n,
        source: 'official',
        asOf: yerevanMidnight('2026-09-17'),
      }) as unknown,
    })
  })

  it('у запасного издателя и прежний курс — его же, а не банка', () => {
    const rows = [
      amd('RUB', '431.23', '2026-09-18', 'cbr', true),
      amd('RUB', '4.3050', '2026-09-17', 'cbr'),
      amd('RUB', '4.3123', '2026-09-01'),
    ]
    expect(pickOfficialRate('RUB', 'AMD', rows, sunday)).toMatchObject({
      provider: 'cbr',
      rate: { source: 'fallback' },
      previous: { source: 'fallback', scaled: 4_305_000n },
    })
  })

  it('без скачка нет ни метки, ни прежнего', () => {
    expect(pickOfficialRate('RUB', 'AMD', [amd('RUB', '4.3123')], sunday)).toMatchObject({
      jumped: false,
      previous: null,
    })
  })

  it('скачок без более раннего курса — скачок виден, прежнего нет', () => {
    const rows = [amd('RUB', '431.23', '2026-09-18', 'cba', true)]
    expect(pickOfficialRate('RUB', 'AMD', rows, sunday)).toMatchObject({
      rate: { scaled: 431_230_000n },
      jumped: true,
      previous: null,
    })
  })

  it('прежний старше недели от скачка не предлагается (С-13)', () => {
    const rows = [
      amd('RUB', '431.23', '2026-09-18', 'cba', true),
      amd('RUB', '4.3050', '2026-09-09'),
      amd('RUB', '4.3050', '2026-09-10'),
    ]
    expect(pickOfficialRate('RUB', 'AMD', rows, sunday)).toMatchObject({
      jumped: true,
      previous: null,
    })
    const week = [
      amd('RUB', '431.23', '2026-09-18', 'cba', true),
      amd('RUB', '4.3050', '2026-09-11'),
    ]
    expect(pickOfficialRate('RUB', 'AMD', week, sunday)?.previous).not.toBeNull()
  })

  it('в кроссе прыгнула одна половина — прежний собирается из прежней и неизменной', () => {
    const rows = [
      amd('RUB', '4.3123', '2026-09-18'),
      amd('USD', '36344', '2026-09-18', 'cba', true),
      amd('USD', '363.44', '2026-09-17'),
    ]
    const picked = pickOfficialRate('RUB', 'USD', rows, sunday)
    expect(picked?.rate.scaled).toBe(119n)
    // 4.3123 / 363.44 = 0.011865, dated by its older half
    expect(picked?.previous).toMatchObject({ scaled: 11_865n, asOf: yerevanMidnight('2026-09-17') })
  })

  it('скачок у валюты не из пары пару не метит', () => {
    const rows = [amd('RUB', '4.3123'), amd('USD', '36344', '2026-09-18', 'cba', true)]
    expect(pickOfficialRate('RUB', 'AMD', rows, sunday)).toMatchObject({
      jumped: false,
      previous: null,
    })
  })
})

describe('formatRate', () => {
  const at = new Date('2026-09-18T20:00:00Z')
  const of = (value: string, base: Currency = 'RUB', quote: Currency = 'AMD'): ExchangeRate => ({
    base,
    quote,
    scaled: parseRate(value),
    source: 'official',
    asOf: at,
  })

  it('печатает оба знака: число без них не говорит, в какую сторону курс', () => {
    expect(formatRate(of('4.82')).replaceAll('\u00a0', ' ')).toBe('4,82 ֏/₽')
    expect(formatRate(of('363.44', 'USD')).replaceAll('\u00a0', ' ')).toBe('363,44 ֏/$')
  })

  it('мелкий курс не округляется в ноль', () => {
    expect(formatRate(of('0.0001')).replaceAll('\u00a0', ' ')).toBe('0,0001 ֏/₽')
  })

  it('лишние знаки снимка на экран не выносит', () => {
    expect(formatRate(of('4.821234')).replaceAll('\u00a0', ' ')).toBe('4,82 ֏/₽')
  })
})
