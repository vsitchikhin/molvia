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
  erased: { count: 2, firstWeek: '2026-10-05', lastWeek: '2026-11-16' },
  logins: {
    firstDay: '2026-10-05',
    lastDay: '2026-11-20',
    days: [
      {
        day: '2026-10-05',
        started: 5,
        again: 2,
        confirmed: 3,
        declined: 0,
        collected: 3,
        expiredUnconfirmed: 2,
        expiredConfirmed: 0,
        refused: 0,
      },
      {
        day: '2026-11-20',
        started: 48,
        again: 10,
        confirmed: 34,
        declined: 1,
        collected: 30,
        expiredUnconfirmed: 13,
        expiredConfirmed: 4,
        refused: 2,
      },
    ],
  },
  reminders: {
    firstDay: '2026-10-05',
    lastDay: '2026-11-20',
    firstSteps: 12,
    secondSteps: 5,
    thirdSteps: 3,
    items: 40,
    rated: 9,
    offButton: 2,
    offSettings: 1,
    offBlocked: 0,
  },
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
  it('нажатий больше, чем спрошено, — край окна: как есть и с причиной, не долей за сотню', async () => {
    const { exit, lines } = run(['--from', '2026-10-05'], {
      ...REPORT,
      reminders: { ...REPORT.reminders, items: 1, rated: 2 },
    })
    await exit
    const rated = lines.find((line) => line.includes('rated by a press in the bot'))
    expect(rated).toContain('2 of 1')
    expect(rated).toContain('forwarded, or asked before the window')
    expect(rated).not.toMatch(/%/)
  })

  it('напоминания без единого — нули и прочерк вместо доли (MOL-101)', async () => {
    const { exit, lines } = run(['--from', '2026-10-05', '--to', '2026-10-05'], {
      ...REPORT,
      reminders: {
        firstDay: '2026-10-05',
        lastDay: '2026-10-05',
        firstSteps: 0,
        secondSteps: 0,
        thirdSteps: 0,
        items: 0,
        rated: 0,
        offButton: 0,
        offSettings: 0,
        offBlocked: 0,
      },
    })
    await exit
    const block = lines.slice(lines.findIndex((line) => line.startsWith('remind ')))
    expect(block[1]).toContain('the day 2026-10-05 in Yerevan')
    expect(block.find((line) => line.includes('rated by a press'))).toBe(
      '     rated by a press in the bot         0 of 0     —',
    )
  })

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
      'Molvia gates · appeared from 2026-10-05 until now, days in Yerevan',
      'read at 2026-11-20 14:03, Yerevan time',
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
      '',
      '     erased                              2          appeared the weeks of 2026-10-05 … 2026-11-16, in neither half',
      '',
      'login how many who began got in?                    second way in above 25 %',
      '     began                               41         days 2026-10-05 … 2026-11-20 in Yerevan',
      '     got in                              33 of 41    80.4 %',
      '     still under way                     0          not counted yet, or erased mid-login',
      '     lost                                8 of 41     19.6 %',
      '       never confirmed in the bot        15',
      '       confirmed, did not come back      4',
      '       «not me» in the bot               1',
      '       refused by the quota              2          starts, not in «began»',
      '     began again on the same device      12         not counted as beginning',
      '',
      '     day            began     again confirmed  declined    got in   expired   refused',
      '     2026-10-05         3         2         3         0         3         2         0',
      '     2026-11-20        38        10        34         1        30        17         2',
      '',
      'remind do reminders bring ratings?                  read beside 0.2',
      '     first step, the next day            12         days 2026-10-05 … 2026-11-20 in Yerevan',
      '     second step, 3 days on              5',
      '     third step, then the pause          3          silent after it: 6 months',
      '     items asked about                   40',
      '     rated by a press in the bot         9 of 40     22.5 %',
      '     turned off under a reminder         2          people',
      '     turned off in the settings          1          people',
      '     blocked the bot                     0          people, reminders off by it',
    ])
    expect(lines.join('\n')).not.toMatch(/STOP|pass|fail/)
  })

  it('удалённые одной недели — «the week of», и нулём тоже печатаются', async () => {
    const { exit, lines } = run(['--from', '2026-10-05', '--to', '2026-10-07'], {
      ...REPORT,
      erased: { count: 0, firstWeek: '2026-10-05', lastWeek: '2026-10-05' },
    })
    await exit
    expect(lines).toContain(
      '     erased                              0          appeared the week of 2026-10-05, in neither half',
    )
  })

  it.each([
    [
      ['--from', '2026-10-05', '--to', '2026-10-31'],
      '2026-10-05 through 2026-10-31, days in Yerevan',
    ],
    // The moment of a tag, seconds and all: «14:20» let a person of 14:20:10 look inside it.
    [['--from', '2026-10-05T14:20:31+04:00'], '2026-10-05T14:20:31+04:00 until now'],
    // The last day Postgres reads, and a moment past midnight of 9999 in Yerevan: no year 10000.
    [
      ['--from', '2026-10-05', '--to', '9999-12-31'],
      '2026-10-05 through 9999-12-31, days in Yerevan',
    ],
    [
      ['--from', '2026-10-05T00:00Z', '--to', '9999-12-31T23:59Z'],
      '2026-10-05T00:00Z until 9999-12-31T23:59Z',
    ],
  ])('%j — заголовок называет окно так, как его задали (adversarial Б)', async (argv, edges) => {
    const { exit, lines } = run(argv)
    expect(await exit).toBe(0)
    expect(lines[0]).toBe(`Molvia gates · appeared from ${edges}`)
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

  it('вход без единого запроса в окне — нули и «—», без таблицы по дням (MOL-68)', async () => {
    const { exit, lines } = run(['--from', '2026-10-05', '--to', '2026-10-05'], {
      ...REPORT,
      logins: { firstDay: '2026-10-05', lastDay: '2026-10-05', days: [] },
    })
    await exit
    // Up to the blank line before the reminder's block (MOL-101).
    const login = lines.slice(
      lines.findIndex((line) => line.startsWith('login ')),
      lines.findIndex((line) => line.startsWith('remind ')) - 1,
    )
    expect(login).toEqual([
      'login how many who began got in?                    second way in above 25 %',
      '     began                               0          the day 2026-10-05 in Yerevan',
      '     got in                              0 of 0     —',
      '     still under way                     0          not counted yet, or erased mid-login',
      '     lost                                0 of 0     —',
      '       never confirmed in the bot        0',
      '       confirmed, did not come back      0',
      '       «not me» in the bot               0',
      '       refused by the quota              0          starts, not in «began»',
      '     began again on the same device      0          not counted as beginning',
    ])
    expect(lines.join('\n')).not.toMatch(/NaN/)
  })

  it('повтор в окне старта до окна — «lost» ниже нуля печатается как есть, с причиной', async () => {
    const day = REPORT.logins.days[0]!
    const { exit, lines } = run(['--from', '2026-10-05'], {
      ...REPORT,
      logins: {
        ...REPORT.logins,
        days: [{ ...day, started: 2, again: 1, collected: 2, expiredUnconfirmed: 0 }],
      },
    })
    await exit
    expect(lines).toContain('     got in                              2 of 1     200.0 %')
    expect(lines).toContain(
      '     lost                                -1 of 1    repeats of starts before the window',
    )
  })

  it('вход, который ещё идёт, не потерян: «still under way», и из «lost» он вычтен (ревью А2)', async () => {
    const day = REPORT.logins.days[0]!
    const { exit, lines } = run(['--from', '2026-10-05'], {
      ...REPORT,
      logins: {
        ...REPORT.logins,
        days: [{ ...day, started: 3, again: 0, collected: 1, expiredUnconfirmed: 0 }],
      },
    })
    await exit
    expect(lines).toContain(
      '     still under way                     2          not counted yet, or erased mid-login',
    )
    expect(lines.find((line) => line.startsWith('     lost'))).toMatch(/ 0 of 3 +0\.0 %$/)
  })

  it('исход без начала — старый образ после отката — «ещё в пути» ниже нуля, с причиной (ревью Г)', async () => {
    const day = REPORT.logins.days[0]!
    const { exit, lines } = run(['--from', '2026-10-05'], {
      ...REPORT,
      logins: {
        ...REPORT.logins,
        days: [{ ...day, started: 0, again: 0, confirmed: 1, collected: 1, expiredUnconfirmed: 0 }],
      },
    })
    await exit
    expect(lines).toContain(
      '     still under way                     -1         outcomes of starts never counted',
    )
  })

  it('исходы без начала не прибавляются к «lost»: один потерянный — «1 of 1» (раунд 2, Р5)', async () => {
    const day = REPORT.logins.days[0]!
    const { exit, lines } = run(['--from', '2026-10-05'], {
      ...REPORT,
      logins: {
        ...REPORT.logins,
        // Один настоящий старт, истёкший, и один запрос старого образа, тоже истёкший.
        days: [{ ...day, started: 1, again: 0, confirmed: 0, collected: 0, expiredUnconfirmed: 2 }],
      },
    })
    await exit
    expect(lines).toContain(
      '     still under way                     -1         outcomes of starts never counted',
    )
    expect(lines.find((line) => line.startsWith('     lost'))).toMatch(/ 1 of 1 +100\.0 %$/)
  })

  it.each([
    [1, 4, '25.0 %'],
    [63, 251, '25.1 %'],
    [1001, 4000, '25.1 %'],
    [2999, 10_000, '30.0 %'],
    [1, 3, '33.4 %'],
  ])(
    'потеряно %i из %i — %s: вверх до десятой, над линией «above» не садится на неё (ревью Б)',
    async (lost, began, percent) => {
      const day = REPORT.logins.days[0]!
      const { exit, lines } = run(['--from', '2026-10-05'], {
        ...REPORT,
        logins: {
          ...REPORT.logins,
          days: [
            {
              ...day,
              started: began,
              again: 0,
              collected: began - lost,
              expiredUnconfirmed: lost,
            },
          ],
        },
      })
      await exit
      const line = lines.find((text) => text.startsWith('     lost')) ?? ''
      expect(line).toContain(`${String(lost)} of ${String(began)}`)
      expect(line.endsWith(percent)).toBe(true)
    },
  )

  it('сбой базы — код 1, код сбоя и ни слова из его сообщения', async () => {
    const failure = new Error('Failed query: select … from actors\nparams: 2026-10-04T20:00…', {
      cause: Object.assign(new Error('read-only transaction'), { code: '25006' }),
    })
    const { exit, lines } = run(['--from', '2026-10-05'], failure)
    expect(await exit).toBe(1)
    expect(lines).toEqual(['reading the gates failed: 25006'])
  })
})
