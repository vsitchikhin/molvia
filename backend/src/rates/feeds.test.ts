import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cbaFeed, parseCba } from './cba'
import { parseCbr } from './cbr'
import { parseErapi } from './erapi'
import { parseNbg } from './nbg'
import { FEED_TIMEOUT_MS, FOREIGN, FeedError, request } from './feed'

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
// Recorded on 04.10.2026: the rate in force on Saturday 03.10, set by the bank on Friday evening.
const nbg = fixture('nbg-2026-10-03.json')

describe('ЦБ РА', () => {
  it('читает субботний ответ как пятничный курс: в выходные банк не публикует', () => {
    expect(parseCba(cba)).toEqual({
      provider: 'cba',
      date: '2026-09-18',
      rates: [
        { provider: 'cba', currency: 'RUB', date: '2026-09-18', scaled: 4_312_300n },
        { provider: 'cba', currency: 'USD', date: '2026-09-18', scaled: 363_440_000n },
        { provider: 'cba', currency: 'EUR', date: '2026-09-18', scaled: 417_050_000n },
        { provider: 'cba', currency: 'GEL', date: '2026-09-18', scaled: 139_530_000n },
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

  it('пропускает валюты, которых нет в продукте, — риал, иену; лари теперь в продукте (MOL-110)', () => {
    expect(parseCba(cba).rates.map((rate) => rate.currency)).toEqual(['RUB', 'USD', 'EUR', 'GEL'])
  })

  it('отвергает ответ целиком, если в нём нет лари (MOL-110)', () => {
    const noLari = cba.replace(/<ExchangeRate><ISO>GEL<\/ISO>[\s\S]*?<\/ExchangeRate>/, '')
    expect(() => parseCba(noLari)).toThrow('cba: no GEL')
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
        // 32.2893 × 100 / 23.1668 = 139.377471…
        { provider: 'cbr', currency: 'GEL', date: '2026-09-19', scaled: 139_377_471n },
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
        // 1 / 0.007165 = 139.567341…
        { provider: 'erapi', currency: 'GEL', date: '2026-09-19', scaled: 139_567_341n },
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

  it('страница вместо JSON — сбой его словами, как у XML-источников, а не SyntaxError (MOL-153)', () => {
    const page = '<!doctype html><title>Access denied in your region</title>'
    expect(() => parseErapi(page)).toThrow(new FeedError('erapi', 'not JSON'))
  })

  it('отвергает курс в экспоненциальной записи, строкой или нулём', () => {
    const body = JSON.parse(erapi) as { rates: Record<string, unknown> }
    for (const bad of [1e-7, '0.231762', 0]) {
      const variant = { ...body, rates: { ...body.rates, RUB: bad } }
      expect(() => parseErapi(JSON.stringify(variant))).toThrow('erapi: implausible RUB')
    }
  })
})

describe('НБ Грузии (MOL-110)', () => {
  it('переводит котировки в лари в драмы внутри одного ответа: драм за 1000', () => {
    // Лари за драм — 7.1762 / 1000; рубль — 3.1209 / 100 / 0.0071762 = 4.348959…;
    // лари — 1000 / 7.1762 = 139.349516…
    expect(parseNbg(nbg)).toEqual({
      provider: 'nbg',
      date: '2026-10-03',
      rates: [
        { provider: 'nbg', currency: 'RUB', date: '2026-10-03', scaled: 4_348_959n },
        { provider: 'nbg', currency: 'USD', date: '2026-10-03', scaled: 362_852_206n },
        { provider: 'nbg', currency: 'EUR', date: '2026-10-03', scaled: 407_694_880n },
        { provider: 'nbg', currency: 'GEL', date: '2026-10-03', scaled: 139_349_516n },
      ],
    })
  })

  it('читает число строкой банка, а не числом JSON', () => {
    const body = JSON.parse(nbg) as [{ currencies: Record<string, unknown>[] }]
    const usd = body[0].currencies.find((entry) => entry.code === 'USD')
    if (usd) usd.rate = 99
    expect(parseNbg(JSON.stringify(body)).rates[1]?.scaled).toBe(362_852_206n)
  })

  it('отвергает ответ без драма, без даты, не одним ответом и страницу вместо JSON', () => {
    const body = JSON.parse(nbg) as [{ date: string; currencies: Record<string, unknown>[] }]
    const noDram = [{ ...body[0], currencies: body[0].currencies.filter((c) => c.code !== 'AMD') }]
    expect(() => parseNbg(JSON.stringify(noDram))).toThrow('nbg: no AMD')
    expect(() => parseNbg(JSON.stringify([{ ...body[0], date: 'вчера' }]))).toThrow('nbg: no date')
    expect(() => parseNbg(JSON.stringify([body[0], body[0]]))).toThrow('nbg: not one answer')
    expect(() => parseNbg('<html>')).toThrow(new FeedError('nbg', 'not JSON'))
  })

  it('отвергает ответ целиком: у валюты нет котировки, она дважды, курс нулевой или без количества', () => {
    const body = JSON.parse(nbg) as [{ currencies: Record<string, unknown>[] }]
    const variants: Record<string, unknown>[][] = [
      body[0].currencies.filter((entry) => entry.code !== 'USD'),
      [...body[0].currencies, ...body[0].currencies.filter((entry) => entry.code === 'USD')],
      body[0].currencies.map((entry) =>
        entry.code === 'USD' ? { ...entry, rateFormated: '0' } : entry,
      ),
      body[0].currencies.map((entry) => (entry.code === 'USD' ? { ...entry, quantity: 0 } : entry)),
    ]
    for (const currencies of variants) {
      expect(() => parseNbg(JSON.stringify([{ ...body[0], currencies }]))).toThrow(
        'nbg: implausible USD',
      )
    }
  })
})

describe('дата ответа', () => {
  it('отвергает день, которого нет в календаре, — V8 читает 31 февраля как 3 марта', () => {
    const february = cba.replace('<CurrentDate>2026-09-18T', '<CurrentDate>2026-02-31T')
    expect(() => parseCba(february)).toThrow('cba: unreadable date "2026-02-31"')
  })

  it('отвергает дату до 2000 года: 0001-01-01 — «нет даты» у .NET, 1970 — нулевое время', () => {
    const dotnet = cba.replace('<CurrentDate>2026-09-18T', '<CurrentDate>0001-01-01T')
    expect(() => parseCba(dotnet)).toThrow('cba: unreadable date')
    const epoch = erapi.replace(/"time_last_update_unix":\d+/, '"time_last_update_unix":0')
    expect(() => parseErapi(epoch)).toThrow('erapi: unreadable date "1970-01-01"')
  })

  it('отвергает 1 января 2000: его полночь в Ереване — ещё 1999 год по UTC, снимок её не возьмёт', () => {
    const xml = cba.replace('<CurrentDate>2026-09-18T', '<CurrentDate>2000-01-01T')
    expect(() => parseCba(xml)).toThrow('cba: unreadable date "2000-01-01"')
  })

  it('принимает 2 января 2000 и 29 февраля високосного', () => {
    for (const day of ['2000-01-02', '2024-02-29']) {
      const xml = cba.replace('<CurrentDate>2026-09-18T', `<CurrentDate>${day}T`)
      expect(parseCba(xml).date).toBe(day)
    }
  })
})

describe('список валют', () => {
  it('берётся из схемы: всё, кроме драма', () => {
    expect(FOREIGN).toEqual(['RUB', 'USD', 'EUR', 'GEL'])
  })
})

describe('транспорт', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ответ не 200 — сбой поставщика с кодом, разбор не начинается', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('busy', { status: 503 }))),
    )
    await expect(cbaFeed().fetchLatest()).rejects.toThrow('cba: HTTP 503')
  })

  it('поставщик, который молчит дольше таймаута, обрывается, а не держит обновление', async () => {
    // AbortSignal.timeout runs on a timer fake timers do not reach: its delay is checked here,
    // and the abort it would fire is fired by hand.
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('timed out', 'TimeoutError'))
            })
          }),
      ),
    )

    const pending = request('cba', 'https://example.invalid')
    controller.abort()

    await expect(pending).rejects.toThrow(new FeedError('cba', 'timed out'))
    expect(timeout).toHaveBeenCalledWith(FEED_TIMEOUT_MS)
    timeout.mockRestore()
  })

  // How Node 22's `fetch` fails, measured on 01.10.2026: the reason is in `cause`, as a message, a
  // code, or both (MOL-153).
  it.each([
    [
      'хост не находится',
      Object.assign(new Error('getaddrinfo ENOTFOUND api.cba.am'), { code: 'ENOTFOUND' }),
      'getaddrinfo ENOTFOUND api.cba.am',
    ],
    [
      'редирект по кругу — у причины нет кода',
      new Error('redirect count exceeded'),
      'redirect count exceeded',
    ],
    [
      'localhost отказал по обоим адресам — у причины нет сообщения',
      Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' }),
      'ECONNREFUSED',
    ],
  ])('запрос без ответа (%s) — сбой источника его причиной', async (_, cause, said) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed', { cause }))),
    )
    await expect(request('cba', 'https://example.invalid')).rejects.toThrow(
      new FeedError('cba', said),
    )
  })

  it('шлёт SOAP-конверт операции ExchangeRatesLatest', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(cba, { status: 200 })))
    vi.stubGlobal('fetch', fetch)

    await cbaFeed().fetchLatest()

    expect(fetch).toHaveBeenCalledWith(
      'https://api.cba.am/exchangerates.asmx',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          SOAPAction: '"http://www.cba.am/ExchangeRatesLatest"',
        }) as unknown,
        body: expect.stringContaining('<ExchangeRatesLatest') as unknown,
      }),
    )
  })
})
