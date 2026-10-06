import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PURS_PAUSE_MS,
  PURS_PER_MINUTE,
  PURS_TIMEOUT_MS,
  purs,
  pursShare,
  pursUserAgent,
} from './client'

function fixture(name: string): string {
  return readFileSync(new URL(`../../tests/fixtures/purs/${name}`, import.meta.url), 'utf8')
}

// the link of a made-up receipt; its `vl` carries a buyer's id, which must never reach a log
const LINK = 'https://suf.purs.gov.rs/v/?vl=A1RFU1RBQUFBVEVTVEJCQkIwMTAwMDAwMDE3'
const ANNA = 'anna'
const BORIS = 'boris'

describe('клиент проверки чеков налоговой Сербии', () => {
  let clock = 1_000_000
  const now = (): number => clock
  const failures: string[] = []
  let fetch: ReturnType<typeof vi.fn>

  function answering(body: string, status = 200): void {
    fetch = vi.fn(() => Promise.resolve(new Response(body, { status })))
    vi.stubGlobal('fetch', fetch)
  }

  function client(perMinute?: number) {
    return purs({
      url: 'https://purs.test',
      userAgent: 'Molvia/test (owner@example.com)',
      onFailure: (reason) => failures.push(reason),
      now,
      ...(perMinute === undefined ? {} : { perMinute }),
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

  it('спрашивает ссылку чека в JSON, своим UA и с таймаутом — по своему адресу, с путём и запросом ссылки', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    answering(fixture('found.json'))

    const answer = await client().receipt(LINK, ANNA)

    expect(fetch).toHaveBeenCalledWith(
      'https://purs.test/v/?vl=A1RFU1RBQUFBVEVTVEJCQkIwMTAwMDAwMDE3',
      expect.objectContaining({
        headers: { accept: 'application/json', 'user-agent': 'Molvia/test (owner@example.com)' },
      }),
    )
    expect(timeout).toHaveBeenCalledWith(PURS_TIMEOUT_MS)
    expect(answer).toEqual({
      kind: 'found',
      tin: '100000009',
      locationName: '1000001-ТЕСТ ПРОДАВНИЦА 1',
      city: 'БЕОГРАД (ЗЕМУН)',
      administrativeUnit: 'Београд-Земун',
      number: 'TESTAAAA-TESTBBBB-12218',
      journal: expect.stringContaining('SECER KRISTAL 1KG SUNOKO KOM (Е)') as unknown,
    })
  })

  it('не берёт из ответа ни кассира, ни покупателя, ни оплат', async () => {
    answering(fixture('found.json'))
    const answer = await client().receipt(LINK, ANNA)
    const fields = Object.keys(answer)
    for (const field of ['cashier', 'buyer', 'payments', 'address', 'businessName']) {
      expect(fields).not.toContain(field)
    }
  })

  it('чек, которого налоговая ещё не показывает (404), — «ещё нет», без паузы и без сбоя', async () => {
    answering('', 404)
    expect(await client().receipt(LINK, ANNA)).toEqual({ kind: 'not_yet' })
    expect(failures).toEqual([])
  })

  it('400 и isValid: false — отказ налоговой, не сбой', async () => {
    answering('', 400)
    expect(await client().receipt(LINK, ANNA)).toEqual({ kind: 'refused' })
    answering(fixture('not-valid.json'))
    expect(await client().receipt(LINK, ANNA)).toEqual({ kind: 'refused' })
    expect(failures).toEqual([])
  })

  it('сбой службы — «ещё нет», минута тишины для всех, в журнале причина без ссылки', async () => {
    for (const [body, status] of [
      ['<html>Сервис недоступан</html>', 503],
      ['<html>Сервис недоступан</html>', 200],
      ['{"isValid":true}', 200],
      ['', 429],
      ['', 500],
    ] as const) {
      clock += PURS_PAUSE_MS
      answering(body, status)
      const c = client()
      expect(await c.receipt(LINK, ANNA)).toEqual({ kind: 'not_yet' })
      answering(fixture('found.json'))
      clock += PURS_PAUSE_MS - 1
      expect(await c.receipt(LINK, BORIS)).toEqual({ kind: 'skipped' })
      expect(fetch).not.toHaveBeenCalled()
      clock += 1
      expect((await c.receipt(LINK, BORIS)).kind).toBe('found')
    }
    expect(failures).toEqual([
      'tax office: HTTP 503',
      'tax office: not json',
      'tax office: unknown answer',
      'tax office: HTTP 429',
      'tax office: HTTP 500',
    ])
    expect(failures.join()).not.toContain('vl=')
  })

  it('таймаут и обрыв пишут имя ошибки, а не её текст со ссылкой', async () => {
    fetch = vi.fn(() =>
      Promise.reject(new DOMException(`timed out asking ${LINK}`, 'TimeoutError')),
    )
    vi.stubGlobal('fetch', fetch)
    expect(await client().receipt(LINK, ANNA)).toEqual({ kind: 'not_yet' })
    expect(failures).toEqual(['TimeoutError'])
  })

  it('не больше PURS_PER_MINUTE запросов в минуту на всех и трети — на одного', async () => {
    answering('', 404)
    const c = client()
    const share = pursShare(PURS_PER_MINUTE)
    expect(share).toBe(4)
    for (let i = 0; i < share; i++) expect((await c.receipt(LINK, ANNA)).kind).toBe('not_yet')
    expect(await c.receipt(LINK, ANNA)).toEqual({ kind: 'skipped' })
    // the others still have their turn, to the minute's limit
    const people = ['b', 'c', 'd']
    let asked = share
    for (const who of people) {
      for (let i = 0; i < share && asked < PURS_PER_MINUTE; i++, asked++) {
        expect((await c.receipt(LINK, who)).kind).toBe('not_yet')
      }
    }
    expect(await c.receipt(LINK, 'e')).toEqual({ kind: 'skipped' })
    expect(fetch).toHaveBeenCalledTimes(PURS_PER_MINUTE)
    clock += 60_000
    expect((await c.receipt(LINK, ANNA)).kind).toBe('not_yet')
  })

  it('называет себя сборкой и контактом, сборку — как /health', () => {
    expect(pursUserAgent('v0.2.0-3-gabc', 'owner@example.com')).toBe(
      'Molvia/v0.2.0-3-gabc (owner@example.com)',
    )
    expect(pursUserAgent('сборка', 'x@y')).toBe(`Molvia/${encodeURIComponent('сборка')} (x@y)`)
  })
})
