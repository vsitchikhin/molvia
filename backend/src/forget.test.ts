import { describe, expect, it, vi } from 'vitest'
import type { ErasureReport, ErasureRepository } from '@/db/erasure-repository'
import { FORGET_USAGE, forget } from '@/forget'

const REPORT: ErasureReport = {
  found: true,
  erased: {
    login_notices: 0,
    sessions: 2,
    search_picks: 1,
    rating_reminders: 1,
    verdicts: 3,
    events: 4,
    feedback: 2,
    expenses: 5,
    trips: 1,
    exchanges: 2,
    incomes: 1,
    spendings: 7,
    account_transfers: 1,
    receipts: 1,
    budget_plans: 2,
    spending_categories: 13,
    money_month_rates: 1,
    money_account_checks: 1,
    money_accounts: 1,
    login_requests: 1,
    actors: 1,
  },
  itemsLeaving: 3,
  leavingItems: ['a', 'b', 'c'],
  itemsReleased: 1,
  barcodesReleased: 2,
  memoryReleased: 0,
  counted: true,
}

function run(
  argv: string[],
  report: ErasureReport | Error = REPORT,
  swept: number | Error = REPORT.itemsLeaving,
) {
  const erase = vi.fn<ErasureRepository['erase']>(async () =>
    report instanceof Error ? Promise.reject(report) : report,
  )
  const sweepReleased = vi.fn<ErasureRepository['sweepReleased']>(async () =>
    swept instanceof Error ? Promise.reject(swept) : swept,
  )
  const lines: string[] = []
  const exit = forget(argv, { erase, sweepReleased }, (line) => lines.push(line))
  return { exit, erase, sweepReleased, lines }
}

describe('forget — стирание вручную', () => {
  it('без --yes только считает: сухой прогон, и ничего не убирает', async () => {
    const { exit, erase, sweepReleased, lines } = run(['184467331'])
    expect(await exit).toBe(0)
    expect(erase).toHaveBeenCalledWith(184467331, { dryRun: true })
    expect(sweepReleased).not.toHaveBeenCalled()
    expect(lines.at(-1)).toMatch(/dry run: nothing changed/)
  })

  // Review 4, №19: the items leaving go at once, as by either door.
  it('с --yes убирает товары своего стирания и печатает сколько', async () => {
    const { exit, sweepReleased, lines } = run(['184467331', '--yes'])
    expect(await exit).toBe(0)
    expect(sweepReleased).toHaveBeenCalledWith(REPORT.leavingItems)
    expect(lines).toContain('  items swept         3')
  })

  it('сбой уборки после стирания называет код и не меняет исход', async () => {
    const broken = Object.assign(new Error('boom'), { code: '40P01' })
    const { exit, lines } = run(['184467331', '--yes'], REPORT, broken)
    expect(await exit).toBe(0)
    expect(lines).toContain("  sweep failed: 40P01 — the API's minute takes them")
    expect(lines.at(-1)).toBe('erased.')
  })

  it('с --yes стирает, где бы флаг ни стоял', async () => {
    for (const argv of [
      ['184467331', '--yes'],
      ['--yes', '184467331'],
    ]) {
      const { exit, erase, lines } = run(argv)
      expect(await exit).toBe(0)
      expect(erase).toHaveBeenCalledWith(184467331, { dryRun: false })
      expect(lines.at(-1)).toBe('erased.')
    }
  })

  it.each([
    [[]],
    [['0']],
    [['-1']],
    [['1.5']],
    [['abc']],
    [['1e3']],
    [['0x10']],
    [[' 42']],
    [[String(2 ** 53)]],
    [['1', '2']],
    [['42', '--force']],
    [['42', '-y']],
  ])('%j — отказ до базы', async (argv) => {
    const { exit, erase, lines } = run(argv)
    expect(await exit).toBe(2)
    expect(erase).not.toHaveBeenCalled()
    expect(lines).toEqual([FORGET_USAGE])
  })

  it('граница: 2^53 − 1 принимается', async () => {
    const { exit, erase } = run([String(Number.MAX_SAFE_INTEGER)])
    expect(await exit).toBe(0)
    expect(erase).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER, { dryRun: true })
  })

  it('печатает счёт по каждой таблице и ничего о человеке', async () => {
    const { exit, lines } = run(['184467331'])
    await exit
    expect(lines).toContain('  verdicts            3')
    expect(lines).toContain('  items leaving       3 (nobody alive stands on them)')
    expect(lines).toContain('  items kept          1 (author removed)')
    expect(lines).toContain('  codes kept          2 (author removed)')
    expect(lines).toContain(
      '  erasures            +1 (a count by week of arrival, no id — the gates read it)',
    )
    expect(lines.join('\n')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
  })

  it('неизвестный владелец — не ошибка', async () => {
    const { exit, lines } = run(['184467331'], { ...REPORT, found: false, counted: false })
    expect(await exit).toBe(0)
    expect(lines[0]).toBe('no owner with this Telegram id')
    expect(lines.join('\n')).not.toMatch(/erasures/)
  })

  it('сбой базы — код 1, код сбоя и ни слова из его сообщения', async () => {
    // What the driver really throws: drizzle's wrapper, the query and its parameters in the
    // message, the SQLSTATE underneath (adversarial О-4).
    const failure = new Error(
      'Failed query: delete from events where actor_id = $1 returning 1\nparams: 1f0e2c4a-…',
      { cause: Object.assign(new Error('relation "events" does not exist'), { code: '42P01' }) },
    )
    const { exit, lines } = run(['184467331', '--yes'], failure)
    expect(await exit).toBe(1)
    expect(lines).toEqual(['erasure failed, nothing changed: 42P01'])
  })

  it('сбой без кода называется своим видом', async () => {
    const { exit, lines } = run(['184467331', '--yes'], new TypeError('secret detail'))
    expect(await exit).toBe(1)
    expect(lines).toEqual(['erasure failed, nothing changed: TypeError'])
  })
})
