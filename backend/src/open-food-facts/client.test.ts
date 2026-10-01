import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OFF_PAUSE_MS,
  OFF_PER_MINUTE,
  OFF_TIMEOUT_MS,
  offUserAgent,
  openFoodFacts,
  personalShare,
} from './client'

function fixture(name: string): string {
  return readFileSync(
    new URL(`../../tests/fixtures/open-food-facts/${name}`, import.meta.url),
    'utf8',
  )
}

const NUTELLA = '3017620422003'
const ANNA = 'anna'
const BORIS = 'boris'

describe('клиент Open Food Facts', () => {
  let clock = 1_000_000
  const now = (): number => clock
  const failures: string[] = []
  let fetch: ReturnType<typeof vi.fn>

  function answering(body: string, status = 200): void {
    fetch = vi.fn(() => Promise.resolve(new Response(body, { status })))
    vi.stubGlobal('fetch', fetch)
  }

  function client() {
    return openFoodFacts({
      url: 'https://off.test',
      userAgent: 'Molvia/test (owner@example.com)',
      onFailure: (reason) => failures.push(reason),
      now,
    })
  }

  beforeEach(() => {
    clock = 1_000_000
    failures.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('спрашивает один продукт с нужными полями, своим UA и коротким таймаутом', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    answering(fixture('nutella.json'))

    const answer = await client().product(NUTELLA, ANNA)

    expect(answer).toMatchObject({ found: true, product: { names: { ru: 'Nutella' } } })
    expect(fetch).toHaveBeenCalledWith(
      `https://off.test/api/v2/product/${NUTELLA}?fields=product_name,product_name_ru,product_name_en,lang,brands,product_quantity,product_quantity_unit`,
      expect.objectContaining({
        headers: { accept: 'application/json', 'user-agent': 'Molvia/test (owner@example.com)' },
      }),
    )
    expect(timeout).toHaveBeenCalledWith(OFF_TIMEOUT_MS)
  })

  it('404 с ответом внутри — промах, а не сбой: паузы нет', async () => {
    answering(fixture('unknown.json'), 404)
    const off = client()

    expect(await off.product('4850001270129', ANNA)).toEqual({ found: false })
    expect(await off.product('4850001270129', ANNA)).toEqual({ found: false })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(failures).toEqual([])
  })

  it('503 страницей HTML — null, причина в журнал без кода, и минуту база не спрашивается', async () => {
    answering(fixture('unavailable.html'), 503)
    const off = client()

    expect(await off.product(NUTELLA, ANNA)).toBeNull()
    expect(failures).toEqual(['open food facts: HTTP 503'])
    expect(failures.join()).not.toContain(NUTELLA)

    clock += OFF_PAUSE_MS - 1
    expect(await off.product(NUTELLA, ANNA)).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)

    answering(fixture('nutella.json'))
    clock += 1
    expect(await off.product(NUTELLA, ANNA)).toMatchObject({ found: true })
  })

  it('HTML с кодом 200 — тоже сбой, а не промах', async () => {
    answering(fixture('unavailable.html'), 200)

    expect(await client().product(NUTELLA, ANNA)).toBeNull()
    expect(failures).toEqual(['open food facts: not json'])
  })

  it.each([429, 403, 500])('HTTP %i — база недоступна', async (status) => {
    answering('{}', status)

    expect(await client().product(NUTELLA, ANNA)).toBeNull()
    expect(failures).toEqual([`open food facts: HTTP ${String(status)}`])
  })

  it('обрыв сети и таймаут — null, в журнал имя ошибки, не её текст', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException(`timed out ${NUTELLA}`, 'TimeoutError'))),
    )

    expect(await client().product(NUTELLA, ANNA)).toBeNull()
    expect(failures).toEqual(['TimeoutError'])
  })

  it(`не больше ${String(OFF_PER_MINUTE)} вопросов в минуту на всех; сверх — null без запроса и без паузы`, async () => {
    answering(fixture('unknown.json'), 404)
    const off = client()

    for (let i = 0; i < OFF_PER_MINUTE; i += 1) {
      clock += 1000
      const who = `person ${String(i % 3)}`
      expect(await off.product(`48500012701${String(i).padStart(2, '0')}`, who)).toEqual({
        found: false,
      })
    }
    expect(await off.product('4850001270129', 'someone else')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(OFF_PER_MINUTE)

    // The first question leaves the window a minute after it was asked.
    clock = 1_000_000 + 1000 + 60_000
    expect(await off.product('4850001270129', 'someone else')).toEqual({ found: false })
    expect(fetch).toHaveBeenCalledTimes(OFF_PER_MINUTE + 1)
    expect(failures).toEqual([])
  })

  it('доля человека — треть минуты: четыре из двенадцати; другой человек свою долю получает (В-6)', async () => {
    answering(fixture('unknown.json'), 404)
    const off = client()
    expect(personalShare(OFF_PER_MINUTE)).toBe(4)

    for (let i = 0; i < 4; i += 1) {
      expect(await off.product(`4850001270${String(i).padStart(3, '0')}`, BORIS)).toEqual({
        found: false,
      })
    }
    expect(await off.product('4850001270999', BORIS)).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(4)

    answering(fixture('nutella.json'))
    expect(await off.product(NUTELLA, ANNA)).toMatchObject({ found: true })
    expect(failures).toEqual([])
  })

  it('доля возвращается через минуту после первого вопроса', async () => {
    answering(fixture('unknown.json'), 404)
    const off = client()
    for (let i = 0; i < 4; i += 1)
      await off.product(`4850001270${String(i).padStart(3, '0')}`, BORIS)
    expect(await off.product('4850001270999', BORIS)).toBeNull()

    clock += 60_000
    expect(await off.product('4850001270999', BORIS)).toEqual({ found: false })
  })

  it('код, уже спрошенный другим, долю не тратит: тот же вопрос', async () => {
    let resolve: (response: Response) => void = () => undefined
    fetch = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const off = client()
    const first = off.product(NUTELLA, ANNA)
    for (let i = 0; i < 5; i += 1) void off.product(NUTELLA, BORIS)
    resolve(new Response(fixture('nutella.json')))
    await first
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('предел задаётся, доля идёт за ним: шестьсот в минуту — двести человеку', async () => {
    answering(fixture('unknown.json'), 404)
    const off = openFoodFacts({ userAgent: 'Molvia/test (x)', perMinute: 600, now })
    for (let i = 0; i < 200; i += 1) {
      expect(await off.product(`4850${String(i).padStart(9, '0')}`, ANNA)).toEqual({ found: false })
    }
    expect(await off.product('4851000000000', ANNA)).toBeNull()
    expect(personalShare(1)).toBe(1)
  })

  it('второй вопрос о коде, пока первый в пути, — тот же ответ без второго запроса', async () => {
    let resolve: (response: Response) => void = () => undefined
    fetch = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const off = client()

    const first = off.product(NUTELLA, ANNA)
    const second = off.product(NUTELLA, ANNA)
    resolve(new Response(fixture('nutella.json')))

    expect(await first).toMatchObject({ found: true })
    expect(await second).toBe(await first)
    expect(fetch).toHaveBeenCalledTimes(1)

    answering(fixture('nutella.json'))
    await off.product(NUTELLA, ANNA)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('UA: сборка закодирована, как в заголовке /health', () => {
    expect(offUserAgent('v0.2-бета', 'owner@example.com')).toBe(
      'Molvia/v0.2-%D0%B1%D0%B5%D1%82%D0%B0 (owner@example.com)',
    )
  })
})
