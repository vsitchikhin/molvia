import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OFF_PAUSE_MS, OFF_PER_MINUTE, OFF_TIMEOUT_MS, offUserAgent, openFoodFacts } from './client'

function fixture(name: string): string {
  return readFileSync(
    new URL(`../../tests/fixtures/open-food-facts/${name}`, import.meta.url),
    'utf8',
  )
}

const NUTELLA = '3017620422003'

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

    const answer = await client().product(NUTELLA)

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

    expect(await off.product('4850001270129')).toEqual({ found: false })
    expect(await off.product('4850001270129')).toEqual({ found: false })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(failures).toEqual([])
  })

  it('503 страницей HTML — null, причина в журнал без кода, и минуту база не спрашивается', async () => {
    answering(fixture('unavailable.html'), 503)
    const off = client()

    expect(await off.product(NUTELLA)).toBeNull()
    expect(failures).toEqual(['open food facts: HTTP 503'])
    expect(failures.join()).not.toContain(NUTELLA)

    clock += OFF_PAUSE_MS - 1
    expect(await off.product(NUTELLA)).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)

    answering(fixture('nutella.json'))
    clock += 1
    expect(await off.product(NUTELLA)).toMatchObject({ found: true })
  })

  it('HTML с кодом 200 — тоже сбой, а не промах', async () => {
    answering(fixture('unavailable.html'), 200)

    expect(await client().product(NUTELLA)).toBeNull()
    expect(failures).toEqual(['open food facts: not json'])
  })

  it.each([429, 403, 500])('HTTP %i — база недоступна', async (status) => {
    answering('{}', status)

    expect(await client().product(NUTELLA)).toBeNull()
    expect(failures).toEqual([`open food facts: HTTP ${String(status)}`])
  })

  it('обрыв сети и таймаут — null, в журнал имя ошибки, не её текст', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException(`timed out ${NUTELLA}`, 'TimeoutError'))),
    )

    expect(await client().product(NUTELLA)).toBeNull()
    expect(failures).toEqual(['TimeoutError'])
  })

  it(`не больше ${String(OFF_PER_MINUTE)} вопросов в минуту; сверх — null без запроса и без паузы`, async () => {
    answering(fixture('unknown.json'), 404)
    const off = client()

    for (let i = 0; i < OFF_PER_MINUTE; i += 1) {
      clock += 1000
      expect(await off.product(`48500012701${String(i).padStart(2, '0')}`)).toEqual({
        found: false,
      })
    }
    expect(await off.product('4850001270129')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(OFF_PER_MINUTE)

    // The first question leaves the window a minute after it was asked.
    clock = 1_000_000 + 1000 + 60_000
    expect(await off.product('4850001270129')).toEqual({ found: false })
    expect(fetch).toHaveBeenCalledTimes(OFF_PER_MINUTE + 1)
    expect(failures).toEqual([])
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

    const first = off.product(NUTELLA)
    const second = off.product(NUTELLA)
    resolve(new Response(fixture('nutella.json')))

    expect(await first).toMatchObject({ found: true })
    expect(await second).toBe(await first)
    expect(fetch).toHaveBeenCalledTimes(1)

    answering(fixture('nutella.json'))
    await off.product(NUTELLA)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('UA: сборка закодирована, как в заголовке /health', () => {
    expect(offUserAgent('v0.2-бета', 'owner@example.com')).toBe(
      'Molvia/v0.2-%D0%B1%D0%B5%D1%82%D0%B0 (owner@example.com)',
    )
  })
})
