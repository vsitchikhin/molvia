import { describe, expect, it, vi } from 'vitest'
import type { FailureRow } from '@/db/failures-repository'
import { FAILURES_USAGE, bundleDecoder, failures, formatFailures, phoneDecoder } from './failures'

const ROW: FailureRow = {
  fingerprint: '3f9a1c'.padEnd(64, '0'),
  source: 'api',
  errorName: 'TypeError',
  code: null,
  route: 'PUT /verdicts/:itemId',
  frames: ['at rateItem (src/usecases/rate-item.ts:42:7)', 'at async next (src/server.ts:1:1)'],
  build: 'v0.2.0-4-gabc1234',
  platform: null,
  firstSeenAt: new Date('2026-10-13T08:00:00.000Z'),
  lastSeenAt: new Date('2026-10-14T10:07:31.512Z'),
  count: 37,
  buildCount: 12,
}

async function run(argv: string[], read = vi.fn(() => Promise.resolve([ROW]))) {
  const lines: string[] = []
  const exit = await failures(argv, read, (line) => lines.push(line))
  return { exit, lines, read }
}

describe('make failures (MOL-143)', () => {
  it('по отпечатку: когда, начало отпечатка, откуда, что и где, счёт, кадры', () => {
    expect(formatFailures([ROW])).toEqual([
      '2026-10-14 10:07:31Z  3f9a1c  api  TypeError  PUT /verdicts/:itemId',
      '  37 in all since 2026-10-13 08:00:00Z, 12 in v0.2.0-4-gabc1234',
      '    at rateItem (src/usecases/rate-item.ts:42:7)',
      '    at async next (src/server.ts:1:1)',
      '',
    ])
  })

  it('код рядом с видом, без маршрута — так и сказано', () => {
    const [head] = formatFailures([{ ...ROW, code: '57P01', route: null }])
    expect(head).toContain('TypeError 57P01  (no route)')
  })

  it('пусто — одна строка', () => {
    expect(formatFailures([])).toEqual(['no failures in the last 30 days'])
  })

  it('по умолчанию двадцать, --limit — сколько сказано', async () => {
    expect((await run([])).read).toHaveBeenCalledWith(20)
    expect((await run(['--limit', '50'])).read).toHaveBeenCalledWith(50)
  })

  it.each([
    ['--limit'],
    ['--limit', '0'],
    ['--limit', '201'],
    ['--limit', '5x'],
    ['--from', '1'],
    ['--limit', '5', 'x'],
  ])('неверная команда %j — подсказка и код 2', async (...argv) => {
    const { exit, lines, read } = await run(argv)
    expect(exit).toBe(2)
    expect(lines).toEqual([FAILURES_USAGE])
    expect(read).not.toHaveBeenCalled()
  })

  it('база не ответила — вид сбоя и код 1, без его сообщения', async () => {
    const refused = Object.assign(new Error('password authentication failed for user "molvia"'), {
      code: '28P01',
    })
    const { exit, lines } = await run(
      [],
      vi.fn(() => Promise.reject(refused)),
    )
    expect(exit).toBe(1)
    expect(lines).toEqual(['reading the failures failed: 28P01'])
  })
})

describe('кадры бандла по карте образа (В-6)', () => {
  // Line 1 of the bundle is line 1 of `rate-item.ts`, line 2 — line 5 of `server.ts`; line 3 has none.
  const decode = bundleDecoder({
    version: 3,
    sources: ['../src/usecases/rate-item.ts', '../src/server.ts'],
    names: [],
    mappings: 'AAAA;ACIA',
  })
  const frame = (line: number) => `at rateItem (file:///app/dist/index.js:${String(line)}:1)`
  const api = { ...ROW, frames: [frame(1), frame(2), frame(3), 'at async Promise.all (index 0)'] }

  it('кадр бандла — строка исходника под ним; без записи в карте и не кадр бандла — как есть', () => {
    expect(decode(frame(1))).toBe('src/usecases/rate-item.ts:1:1')
    expect(decode(frame(2))).toBe('src/server.ts:5:1')
    expect(decode('at file:///app/dist/index.js:2:1')).toBe('src/server.ts:5:1')
    expect(decode(frame(3))).toBeUndefined()
    expect(decode('at async Promise.all (index 0)')).toBeUndefined()
  })

  it('make failures подписывает кадры API своей сборки', () => {
    expect(formatFailures([api], { build: ROW.build, decode }).slice(2, 7)).toEqual([
      `    ${frame(1)}`,
      '      → src/usecases/rate-item.ts:1:1',
      `    ${frame(2)}`,
      '      → src/server.ts:5:1',
      `    ${frame(3)}`,
    ])
  })

  it('чужая сборка и бот — без расшифровки: их строки читались бы не по той карте', () => {
    const plain = formatFailures([api])
    expect(formatFailures([api], { build: 'v0.2.0-9-gfffffff', decode })).toEqual(plain)
    const bot = { ...api, source: 'bot' }
    expect(formatFailures([bot], { build: ROW.build, decode })).toEqual(formatFailures([bot]))
  })
})

describe('кадры телефона по карте с сайта (MOL-144, Р-9)', () => {
  // Line 1 of the phone's script is line 1 of `AdviceView.vue`, line 2 — line 5 of `useAdvice.ts`.
  const MAP = {
    version: 3,
    sources: ['../../src/views/AdviceView.vue', '../../src/composables/useAdvice.ts'],
    names: [],
    mappings: 'AAAA;ACIA',
  }
  const frame = (file: string, line: number) => `at Xe (/assets/${file}.js:${String(line)}:1)`
  const phone = {
    ...ROW,
    source: 'phone',
    route: 'screen:advice',
    build: 'index-BTCsHrpw',
    platform: 'ios 18 app',
    frames: [frame('index-BTCsHrpw', 1), frame('index-BTCsHrpw', 2), frame('index-Gone0000', 1)],
  }
  const asked: string[] = []
  const site = (url: URL) => {
    asked.push(url.href)
    return Promise.resolve(
      url.pathname === '/assets/index-BTCsHrpw.js.map'
        ? new Response(JSON.stringify(MAP))
        : new Response('not found', { status: 404 }),
    )
  }

  it('карта — по имени файла кадра, одна на файл; без карты кадр как есть', async () => {
    asked.length = 0
    const decode = await phoneDecoder([phone, ROW], 'https://molvia.net', site)
    expect(asked).toEqual([
      'https://molvia.net/assets/index-BTCsHrpw.js.map',
      'https://molvia.net/assets/index-Gone0000.js.map',
    ])
    expect(decode(frame('index-BTCsHrpw', 1))).toBe('src/views/AdviceView.vue:1:1')
    expect(decode(frame('index-BTCsHrpw', 2))).toBe('src/composables/useAdvice.ts:5:1')
    expect(decode(frame('index-Gone0000', 1))).toBeUndefined()
  })

  it('сайт не ответил — кадры как есть, без сбоя', async () => {
    const decode = await phoneDecoder([phone], 'https://molvia.net', () =>
      Promise.reject(new TypeError('fetch failed')),
    )
    expect(decode(frame('index-BTCsHrpw', 1))).toBeUndefined()
  })

  it('make failures: платформа рядом со сборкой, строки исходника под кадрами телефона', async () => {
    const decode = await phoneDecoder([phone], 'https://molvia.net', site)
    expect(formatFailures([phone], undefined, decode).slice(1, 6)).toEqual([
      '  37 in all since 2026-10-13 08:00:00Z, 12 in index-BTCsHrpw · ios 18 app',
      `    ${frame('index-BTCsHrpw', 1)}`,
      '      → src/views/AdviceView.vue:1:1',
      `    ${frame('index-BTCsHrpw', 2)}`,
      '      → src/composables/useAdvice.ts:5:1',
    ])
  })

  it('расшифровщик телефона не трогает кадры API', async () => {
    const decode = await phoneDecoder([phone], 'https://molvia.net', site)
    expect(formatFailures([ROW], undefined, decode)).toEqual(formatFailures([ROW]))
  })
})
