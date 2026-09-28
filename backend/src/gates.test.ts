import { describe, expect, it, vi } from 'vitest'
import type { GatesReader, GatesReport } from '@/db/gates-reader'
import { GATES_USAGE, gates } from '@/gates'

// 2026-11-20 14:03 in Yerevan.
const NOW = new Date('2026-11-20T10:03:00Z')

const REPORT: GatesReport = {
  readAt: NOW,
  ratings: { cohortSize: 12, reached: 3, pending: 4 },
  products: { cohortSize: 5, returned: 1, pending: 3, withoutAccess: 8 },
  venues: { cohortSize: 5, returned: 0, pending: 3, withoutAccess: 8 },
}

function run(argv: string[], report: GatesReport | Error = REPORT) {
  const read = vi.fn<GatesReader['read']>(async () =>
    report instanceof Error ? Promise.reject(report) : report,
  )
  const lines: string[] = []
  const exit = gates(
    argv,
    { read },
    (line) => lines.push(line),
    () => NOW,
  )
  return { exit, read, lines }
}

describe('gates — чтение ворот вручную', () => {
  it('день --from — полночь по Еревану, без --to — до сейчас', async () => {
    const { exit, read } = run(['--from', '2026-10-05'])
    expect(await exit).toBe(0)
    expect(read).toHaveBeenCalledWith({ from: new Date('2026-10-04T20:00:00Z'), to: NOW })
  })

  it('день --to включается целиком: окно до полуночи следующего дня', async () => {
    const { exit, read } = run(['--to', '2026-10-31', '--from', '2026-10-05'])
    expect(await exit).toBe(0)
    expect(read).toHaveBeenCalledWith({
      from: new Date('2026-10-04T20:00:00Z'),
      to: new Date('2026-10-31T20:00:00Z'),
    })
  })

  it('момент со смещением — как его печатает git log --format=%cI', async () => {
    const { exit, read } = run([
      '--from',
      '2026-10-05T14:20:31+04:00',
      '--to',
      '2026-11-01T00:00:00.500Z',
    ])
    expect(await exit).toBe(0)
    expect(read).toHaveBeenCalledWith({
      from: new Date('2026-10-05T10:20:31Z'),
      to: new Date('2026-11-01T00:00:00.500Z'),
    })
  })

  it('граница: from на миллисекунду раньше to принимается', async () => {
    const { exit } = run(['--from', '2026-10-05T00:00:00.000Z', '--to', '2026-10-05T00:00:00.001Z'])
    expect(await exit).toBe(0)
  })

  it('граница: 9999-12-31 днём — последний день, который читает Postgres', async () => {
    const { exit, read } = run(['--from', '0001-01-02', '--to', '9999-12-31'])
    expect(await exit).toBe(0)
    expect(read).toHaveBeenCalledWith({
      from: new Date('0001-01-01T20:00:00Z'),
      to: new Date('9999-12-31T20:00:00Z'),
    })
  })

  it.each([
    [[]],
    [['--to', '2026-10-05']],
    [['--from']],
    [['--from', '2026-02-31']],
    [['--from', '2026-10-5']],
    [['--from', 'yesterday']],
    [['--from', '2026-10-05T10:00']],
    [['--from', '2026-10-05T10:00:00']],
    [['--from', '2026-10-05T24:00Z']],
    [['--from', '2026-02-31T10:00Z']],
    [['--from', '2026-10-05T10:00+4']],
    [['--from', '0000-12-31']],
    [['--from', '2026-10-05', '--from', '2026-10-06']],
    [['--from', '2026-10-05', '--yes']],
    [['--from', '2026-10-05', '--to']],
    [['--from=2026-10-05']],
    [['2026-10-05']],
    [['--from', '2026-10-05', '--to', '2026-10-04']],
    [['--from', '2026-10-05T00:00Z', '--to', '2026-10-05T00:00Z']],
    [['--from', '2026-11-21']],
  ])('%j — отказ до базы', async (argv) => {
    const { exit, read, lines } = run(argv)
    expect(await exit).toBe(2)
    expect(read).not.toHaveBeenCalled()
    expect(lines).toEqual([GATES_USAGE])
  })

  it('печатает обе половины, n у каждого процента и порог без вердикта', async () => {
    const { exit, lines } = run(['--from', '2026-10-05'])
    await exit
    expect(lines).toEqual([
      'Molvia gates · appeared from 2026-10-05 00:00 until 2026-11-20 14:03, Yerevan time',
      'read at 2026-11-20 14:03',
      '',
      '0.2  do strangers fill the base?                    stop below 20 %',
      '     gave 5 ratings within 14 days       3 of 12     25.0 %',
      '     still inside their 14 days          4          not counted yet',
      '',
      "0.3  do they come back for other people's data?     stop below 15 %",
      '     products   back in week 4           1 of 5      20.0 %',
      '     venues     back in week 4           0 of 5       0.0 %',
      '     week 4 not over yet                 3          not counted yet',
      '     no access in week 4                 8          not in the cohort',
    ])
    expect(lines.join('\n')).not.toMatch(/STOP|pass|fail/)
  })

  it('пустая когорта — «—», а не 0 % и не NaN', async () => {
    const empty = { cohortSize: 0, returned: 0, pending: 2, withoutAccess: 0 }
    const { exit, lines } = run(['--from', '2026-10-05'], {
      ...REPORT,
      ratings: { cohortSize: 0, reached: 0, pending: 10 },
      products: empty,
      venues: empty,
    })
    await exit
    expect(lines).toContain('     gave 5 ratings within 14 days       0 of 0     —')
    expect(lines).toContain('     products   back in week 4           0 of 0     —')
    expect(lines).toContain('     still inside their 14 days          10         not counted yet')
    expect(lines.join('\n')).not.toMatch(/NaN/)
  })

  it.each([
    [1999, 10_000, '19.9 %'],
    [1, 5, '20.0 %'],
    [1, 3, '33.3 %'],
    [2, 3, '66.6 %'],
    [7, 7, '100.0 %'],
  ])('%i из %i — %s: вниз до десятой, через порог не переносит', async (part, whole, percent) => {
    const { exit, lines } = run(['--from', '2026-10-05'], {
      ...REPORT,
      ratings: { cohortSize: whole, reached: part, pending: 0 },
    })
    await exit
    const line = lines.find((text) => text.includes('gave 5 ratings')) ?? ''
    expect(line).toContain(`${String(part)} of ${String(whole)}`)
    expect(line.endsWith(percent)).toBe(true)
  })

  it('сбой базы — код 1, код сбоя и ни слова из его сообщения', async () => {
    const failure = new Error('Failed query: select … from actors\nparams: 2026-10-04T20:00…', {
      cause: Object.assign(new Error('read-only transaction'), { code: '25006' }),
    })
    const { exit, lines } = run(['--from', '2026-10-05'], failure)
    expect(await exit).toBe(1)
    expect(lines).toEqual(['reading the gates failed: 25006'])
  })
})
