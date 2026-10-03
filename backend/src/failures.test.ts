import { describe, expect, it, vi } from 'vitest'
import type { FailureRow } from '@/db/failures-repository'
import { FAILURES_USAGE, failures, formatFailures } from './failures'

const ROW: FailureRow = {
  fingerprint: '3f9a1c'.padEnd(64, '0'),
  source: 'api',
  errorName: 'TypeError',
  code: null,
  route: 'PUT /verdicts/:itemId',
  frames: ['at rateItem (src/usecases/rate-item.ts:42:7)', 'at async next (src/server.ts:1:1)'],
  build: 'v0.2.0-4-gabc1234',
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
