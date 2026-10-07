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

describe('the client of the Serbian tax office’s check of a receipt', () => {
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

  it('asks the receipt’s link for JSON, with its own UA and a timeout — at its own address, with the link’s path and query', async () => {
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

  it('takes neither the cashier, nor the buyer, nor the payments from the answer', async () => {
    answering(fixture('found.json'))
    const answer = await client().receipt(LINK, ANNA)
    const fields = Object.keys(answer)
    for (const field of ['cashier', 'buyer', 'payments', 'address', 'businessName']) {
      expect(fields).not.toContain(field)
    }
  })

  it('a receipt the tax office does not show yet (404) is «not yet», with no pause and no failure', async () => {
    answering('', 404)
    expect(await client().receipt(LINK, ANNA)).toEqual({ kind: 'not_yet' })
    expect(failures).toEqual([])
  })

  it('400 and isValid: false are the tax office’s refusal, not a failure', async () => {
    answering('', 400)
    expect(await client().receipt(LINK, ANNA)).toEqual({ kind: 'refused' })
    answering(fixture('not-valid.json'))
    expect(await client().receipt(LINK, ANNA)).toEqual({ kind: 'refused' })
    expect(failures).toEqual([])
  })

  it('a failure of the service is «not yet», a minute of silence for everyone, and its reason logged without the link', async () => {
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

  it('an answer that no longer reads goes to the owner by its kind, without the answer; the weather only to the log (review 4)', async () => {
    const broken: { code: string; message: string }[] = []
    const c = (now: () => number) =>
      purs({
        url: 'https://purs.test',
        userAgent: 'Molvia/test (owner@example.com)',
        onBroken: (error) => broken.push({ code: error.code, message: error.message }),
        now,
      })
    for (const [body, status] of [
      ['<html>Сервис недоступан</html>', 200],
      ['{"isValid":true}', 200],
      ['', 503],
      ['', 404],
    ] as const) {
      answering(body, status)
      clock += PURS_PAUSE_MS
      await c(now).receipt(LINK, ANNA)
    }
    expect(broken).toEqual([
      { code: 'NOT_JSON', message: 'tax office: not json' },
      { code: 'UNKNOWN_ANSWER', message: 'tax office: unknown answer' },
    ])
    expect(JSON.stringify(broken)).not.toContain('vl=')
  })

  it('a timeout and a dropped connection log the error’s name, never its text with the link', async () => {
    fetch = vi.fn(() =>
      Promise.reject(new DOMException(`timed out asking ${LINK}`, 'TimeoutError')),
    )
    vi.stubGlobal('fetch', fetch)
    expect(await client().receipt(LINK, ANNA)).toEqual({ kind: 'not_yet' })
    expect(failures).toEqual(['TimeoutError'])
  })

  it('asks at most PURS_PER_MINUTE a minute for everyone, and a third of it for one person', async () => {
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

  it('names itself by the build and a contact, the build encoded as /health’s', () => {
    expect(pursUserAgent('v0.2.0-3-gabc', 'owner@example.com')).toBe(
      'Molvia/v0.2.0-3-gabc (owner@example.com)',
    )
    expect(pursUserAgent('сборка', 'x@y')).toBe(`Molvia/${encodeURIComponent('сборка')} (x@y)`)
  })
})

describe('the specification of a receipt — its lines’ codes (MOL-234, owner’s В-1 «а»)', () => {
  const NUMBER = 'TESTAAAA-TESTBBBB-1'
  const PAGE = `<script>viewModel.InvoiceNumber('${NUMBER}');viewModel.Token('5f0a-test-token');</script>`
  const SPEC = JSON.stringify({
    success: true,
    items: [
      { gtin: '', name: 'Zitopek beli hleb /kom', quantity: 1, total: 62, unitPrice: 62 },
      { gtin: '8602300236022', name: 'Pionir medeno srce', quantity: 1, total: 129.9 },
    ],
  })
  let clock = 1_000_000
  const failures: string[] = []
  let broken = 0
  let fetch: ReturnType<typeof vi.fn>

  function answering(...answers: [string, number][]): void {
    fetch = vi.fn(() => {
      const [body, status] = answers.shift() ?? ['', 500]
      return Promise.resolve(new Response(body, { status }))
    })
    vi.stubGlobal('fetch', fetch)
  }

  function client(perMinute?: number) {
    return purs({
      url: 'https://purs.test',
      userAgent: 'Molvia/test (owner@example.com)',
      onFailure: (reason) => failures.push(reason),
      onBroken: () => (broken += 1),
      now: () => clock,
      ...(perMinute === undefined ? {} : { perMinute }),
    })
  }

  beforeEach(() => {
    clock = 1_000_000
    failures.length = 0
    broken = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads the page for its token, asks /specifications with it, and takes each line’s code and sum', async () => {
    answering([PAGE, 200], [SPEC, 200])
    const answer = await client().specification(LINK, NUMBER, ANNA)
    expect(answer).toEqual({
      kind: 'found',
      items: [
        { totalHundredths: 6_200, gtin: '' },
        { totalHundredths: 12_990, gtin: '8602300236022' },
      ],
    })
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://purs.test/v/?vl=A1RFU1RBQUFBVEVTVEJCQkIwMTAwMDAwMDE3',
      expect.objectContaining({
        headers: { accept: 'text/html', 'user-agent': 'Molvia/test (owner@example.com)' },
      }),
    )
    const [url, init] = fetch.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('https://purs.test/specifications')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(`invoiceNumber=${NUMBER}&token=5f0a-test-token`)
    expect(init.headers).toMatchObject({ 'user-agent': 'Molvia/test (owner@example.com)' })
  })

  it('`success:false` — the way it answers a server two times of three — is no specification, and pauses nobody', async () => {
    answering([PAGE, 200], [JSON.stringify({ success: false }), 200], ['{}', 404])
    const c = client()
    expect(await c.specification(LINK, NUMBER, ANNA)).toEqual({ kind: 'failed' })
    // the receipts' queue goes on: a 404 is «not yet», never «skipped» by a pause
    expect(await c.receipt(LINK, BORIS)).toEqual({ kind: 'not_yet' })
    expect(broken).toBe(0)
    expect(failures).toEqual(['tax office: specification refused'])
  })

  it('a page with no token, or of another receipt, asks no /specifications', async () => {
    answering(['<html>сачекајте неколико минута</html>', 200])
    expect(await client().specification(LINK, NUMBER, ANNA)).toEqual({ kind: 'failed' })
    expect(fetch).toHaveBeenCalledTimes(1)

    answering([PAGE.replace(NUMBER, 'OTHERAAA-OTHERBBB-2'), 200])
    expect(await client().specification(LINK, NUMBER, ANNA)).toEqual({ kind: 'failed' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('an error, a timeout or another shape is no specification, logged without the link', async () => {
    for (const answers of [
      [['', 503]],
      [
        [PAGE, 200],
        ['not json', 200],
      ],
      [
        [PAGE, 200],
        [JSON.stringify({ success: true, items: [{ total: -1 }] }), 200],
      ],
    ] as [string, number][][]) {
      answering(...answers)
      expect(await client().specification(LINK, NUMBER, ANNA)).toEqual({ kind: 'failed' })
    }
    fetch = vi.fn(() => Promise.reject(new DOMException('timed out', 'TimeoutError')))
    vi.stubGlobal('fetch', fetch)
    expect(await client().specification(LINK, NUMBER, ANNA)).toEqual({ kind: 'failed' })
    expect(failures.join(' ')).not.toContain('vl=')
    expect(failures).toContain('TimeoutError')
    expect(broken).toBe(0)
  })

  it('counts both its requests in the limit: over it, the specification is skipped, never failed', async () => {
    answering([PAGE, 200], [SPEC, 200])
    // four a person a minute: two specifications are all of it, and a receipt asked meanwhile leaves
    // the next one no room for both its requests — its page is not asked for nothing
    const c = client(PURS_PER_MINUTE)
    expect(pursShare(PURS_PER_MINUTE)).toBe(4)
    expect((await c.specification(LINK, NUMBER, ANNA)).kind).toBe('found')
    clock += 30_000
    answering(['', 404])
    expect(await c.receipt(LINK, ANNA)).toEqual({ kind: 'not_yet' })
    const calls = fetch.mock.calls.length
    expect(await c.specification(LINK, NUMBER, ANNA)).toEqual({ kind: 'skipped' })
    expect(fetch).toHaveBeenCalledTimes(calls)
    // another person is not held by it
    answering([PAGE, 200], [SPEC, 200])
    expect((await c.specification(LINK, NUMBER, BORIS)).kind).toBe('found')
    // the first two left the window, the receipt's ask has not: two free again
    clock += 30_001
    answering([PAGE, 200], [SPEC, 200])
    expect((await c.specification(LINK, NUMBER, ANNA)).kind).toBe('found')
  })
})
