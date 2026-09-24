import { describe, expect, it, vi } from 'vitest'
import type { ErasureReport, ErasureRepository } from '@/db/erasure-repository'
import { FORGET_USAGE, forget } from '@/forget'

const REPORT: ErasureReport = {
  found: true,
  erased: {
    sessions: 2,
    search_picks: 1,
    verdicts: 3,
    events: 4,
    expenses: 5,
    trips: 1,
    login_requests: 1,
    actors: 1,
  },
  itemsReleased: 1,
}

function run(argv: string[], report: ErasureReport | Error = REPORT) {
  const erase = vi.fn<ErasureRepository['erase']>(async () =>
    report instanceof Error ? Promise.reject(report) : report,
  )
  const lines: string[] = []
  const exit = forget(argv, { erase }, (line) => lines.push(line))
  return { exit, erase, lines }
}

describe('forget — стирание вручную', () => {
  it('без --yes только считает: сухой прогон', async () => {
    const { exit, erase, lines } = run(['184467331'])
    expect(await exit).toBe(0)
    expect(erase).toHaveBeenCalledWith(184467331, { dryRun: true })
    expect(lines.at(-1)).toMatch(/dry run: nothing changed/)
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
    expect(lines).toContain('  verdicts        3')
    expect(lines).toContain('  items kept      1 (author removed)')
    expect(lines.join('\n')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
  })

  it('неизвестный владелец — не ошибка', async () => {
    const { exit, lines } = run(['184467331'], { ...REPORT, found: false })
    expect(await exit).toBe(0)
    expect(lines[0]).toBe('no owner with this Telegram id')
  })

  it('сбой базы — код 1 и слова о том, что ничего не изменилось', async () => {
    const { exit, lines } = run(['184467331', '--yes'], new Error('connection refused'))
    expect(await exit).toBe(1)
    expect(lines).toEqual(['erasure failed, nothing changed: connection refused'])
  })
})
