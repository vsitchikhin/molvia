import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCba } from './cba'
import { parseCbr } from './cbr'
import { parseErapi } from './erapi'

// Answers recorded from the providers on 19.09.2026 (a Saturday), byte for byte.
function fixture(name: string): string {
  const bytes = readFileSync(new URL(`../../tests/fixtures/rates/${name}`, import.meta.url))
  return name.startsWith('cbr')
    ? new TextDecoder('windows-1251').decode(bytes)
    : bytes.toString('utf8')
}

const cba = fixture('cba-latest-2026-09-19.xml')
const cbr = fixture('cbr-daily-2026-09-19.xml')
const erapi = fixture('erapi-latest-2026-09-19.json')

describe('ЦБ РА', () => {
  it('читает субботний ответ как пятничный курс: в выходные банк не публикует', () => {
    expect(parseCba(cba)).toEqual({
      provider: 'cba',
      date: '2026-09-18',
      rates: [
        { provider: 'cba', currency: 'RUB', date: '2026-09-18', scaled: 4_312_300n },
        { provider: 'cba', currency: 'USD', date: '2026-09-18', scaled: 363_440_000n },
        { provider: 'cba', currency: 'EUR', date: '2026-09-18', scaled: 417_050_000n },
      ],
    })
  })

  it('делит курс на Amount: риал идёт за 100, иена за 10', () => {
    const per10 = cba.replace(
      '<ISO>RUB</ISO><Amount>1</Amount><Rate>4.3123</Rate>',
      '<ISO>RUB</ISO><Amount>10</Amount><Rate>43.123</Rate>',
    )
    expect(parseCba(per10).rates[0]?.scaled).toBe(4_312_300n)
  })

  it('пропускает валюты, которых нет в продукте, — риал, иену, лари', () => {
    expect(parseCba(cba).rates.map((rate) => rate.currency)).toEqual(['RUB', 'USD', 'EUR'])
  })

  it('отвергает ответ целиком на SOAP Fault и на страницу ошибки вместо XML', () => {
    expect(() => parseCba(fixture('cba-fault.xml'))).toThrow('cba: SOAP fault')
    expect(() => parseCba(fixture('cba-runtime-error.html'))).toThrow('cba: no CurrentDate')
  })

  it('отвергает ответ целиком, если у одной нужной валюты курс нулевой, кривой или без Amount', () => {
    const broken = [
      cba.replace('<Rate>363.44</Rate>', '<Rate>0</Rate>'),
      cba.replace('<Rate>363.44</Rate>', '<Rate>abc</Rate>'),
      cba.replace('<ISO>USD</ISO><Amount>1</Amount>', '<ISO>USD</ISO><Amount>0</Amount>'),
      cba.replace('<ISO>USD</ISO><Amount>1</Amount>', '<ISO>USD</ISO>'),
    ]
    for (const xml of broken) expect(() => parseCba(xml)).toThrow('cba: implausible USD')
  })

  it('отвергает ответ целиком, если нужной валюты нет вовсе', () => {
    const noEuro = cba.replace(/<ExchangeRate><ISO>EUR<\/ISO>[\s\S]*?<\/ExchangeRate>/, '')
    expect(() => parseCba(noEuro)).toThrow('cba: no EUR')
  })

  it('отвергает курс вне полосы правдоподобия, а не пишет его', () => {
    const tiny = cba.replace('<Rate>4.3123</Rate>', '<Rate>0.00001</Rate>')
    expect(() => parseCba(tiny)).toThrow('cba: implausible RUB')
  })
})

describe('ЦБ РФ', () => {
  it('переводит рублёвые котировки в драмы: драм за 100, доллар через рубль', () => {
    // 100 / 23.1668 = 4.3165219…; 84.1975 × 4.3165219… = 363.440354…
    expect(parseCbr(cbr)).toEqual({
      provider: 'cbr',
      date: '2026-09-19',
      rates: [
        { provider: 'cbr', currency: 'RUB', date: '2026-09-19', scaled: 4_316_522n },
        { provider: 'cbr', currency: 'USD', date: '2026-09-19', scaled: 363_440_354n },
        { provider: 'cbr', currency: 'EUR', date: '2026-09-19', scaled: 417_265_656n },
      ],
    })
  })

  it('отвергает ответ без драма или без даты', () => {
    const noDram = cbr.replace('<CharCode>AMD</CharCode>', '<CharCode>XXX</CharCode>')
    expect(() => parseCbr(noDram)).toThrow('cbr: no AMD')
    expect(() => parseCbr(cbr.replace('Date="19.09.2026"', ''))).toThrow('cbr: no ValCurs date')
  })

  it('отвергает ответ целиком, если у доллара нет котировки', () => {
    const noDollar = cbr.replace('<CharCode>USD</CharCode>', '<CharCode>XXX</CharCode>')
    expect(() => parseCbr(noDollar)).toThrow('cbr: implausible USD')
  })
})

describe('ExchangeRate-API', () => {
  it('обращает «валюты за драм» в «драмы за валюту», дата — день в Ереване на момент обновления', () => {
    // 00:02 UTC 19.09 is 04:02 in Yerevan; 1 / 0.231762 = 4.3147712…
    expect(parseErapi(erapi)).toEqual({
      provider: 'erapi',
      date: '2026-09-19',
      rates: [
        { provider: 'erapi', currency: 'RUB', date: '2026-09-19', scaled: 4_314_771n },
        { provider: 'erapi', currency: 'USD', date: '2026-09-19', scaled: 363_504_180n },
        { provider: 'erapi', currency: 'EUR', date: '2026-09-19', scaled: 417_188_152n },
      ],
    })
  })

  it('отвергает неуспешный ответ, ответ не против драма и ответ без времени', () => {
    const body = JSON.parse(erapi) as Record<string, unknown>
    const variants = [
      { ...body, result: 'error' },
      { ...body, base_code: 'USD' },
      { ...body, time_last_update_unix: undefined },
    ]
    for (const variant of variants) expect(() => parseErapi(JSON.stringify(variant))).toThrow()
  })

  it('отвергает курс в экспоненциальной записи, строкой или нулём', () => {
    const body = JSON.parse(erapi) as { rates: Record<string, unknown> }
    for (const bad of [1e-7, '0.231762', 0]) {
      const variant = { ...body, rates: { ...body.rates, RUB: bad } }
      expect(() => parseErapi(JSON.stringify(variant))).toThrow('erapi: implausible RUB')
    }
  })
})
