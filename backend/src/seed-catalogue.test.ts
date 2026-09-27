import { describe, expect, it, vi } from 'vitest'
import type { SeedReport, SeedRepository } from '@/db/seed-repository'
import { CATALOGUE_SEED } from '@/catalogue-seed'
import { SEED_USAGE, seedCatalogue } from '@/seed-catalogue'

const REPORT: SeedReport = {
  added: 590,
  kept: [
    { name: 'Молоко', unit: 'kg', seeded: 'l' },
    { name: 'хлеб', unit: 'piece', seeded: 'piece' },
  ],
  twins: [{ name: 'Мед', seed: 'Мёд' }],
}

function run(argv: string[], report: SeedReport | Error = REPORT) {
  const seed = vi.fn<SeedRepository['seed']>(async () =>
    report instanceof Error ? Promise.reject(report) : report,
  )
  const lines: string[] = []
  const exit = seedCatalogue(argv, { seed }, (line) => lines.push(line))
  return { exit, seed, lines }
}

describe('seed-catalogue (MOL-112)', () => {
  it('без --yes только считает: сухой прогон', async () => {
    const { exit, seed, lines } = run([])
    expect(await exit).toBe(0)
    expect(seed).toHaveBeenCalledWith(expect.any(Array), { dryRun: true })
    expect(lines.at(-1)).toMatch(/dry run: nothing changed/)
  })

  it('с --yes пишет', async () => {
    const { exit, seed, lines } = run(['--yes'])
    expect(await exit).toBe(0)
    expect(seed).toHaveBeenCalledWith(expect.any(Array), { dryRun: false })
    expect(lines.at(-1)).toBe('written.')
  })

  it('отдаёт весь список товарами, без штрихкодов', async () => {
    const { exit, seed } = run([])
    await exit
    const items = seed.mock.calls[0]?.[0] ?? []
    expect(items).toHaveLength(CATALOGUE_SEED.length)
    expect(items[0]).toEqual({
      kind: 'product',
      name: CATALOGUE_SEED[0]?.[0],
      defaultUnit: CATALOGUE_SEED[0]?.[1],
      barcodes: [],
    })
  })

  it.each([[['--force']], [['-y']], [['--yes', 'extra']], [['yes']]])(
    '%j — отказ до базы',
    async (argv) => {
      const { exit, seed, lines } = run(argv)
      expect(await exit).toBe(2)
      expect(seed).not.toHaveBeenCalled()
      expect(lines).toEqual([SEED_USAGE])
    },
  )

  it('называет, что добавится, что уже есть, где единица расходится и что есть другим написанием', async () => {
    const { exit, lines } = run([])
    await exit
    expect(lines).toEqual([
      '  added           590',
      '  already there   2',
      '  another unit    1 (kept as they are)',
      '    Молоко: kg, the seed says l',
      '  same key        1 (another spelling there, not written)',
      '    Мед ← Мёд',
      'dry run: nothing changed. Run again with --yes to write.',
    ])
  })

  it('без расхождений и двойников строк о них нет', async () => {
    const { exit, lines } = run(['--yes'], { added: 0, kept: [], twins: [] })
    await exit
    expect(lines).toEqual(['  added           0', '  already there   0', 'written.'])
  })

  it('сбой базы — код 1, код сбоя и ни слова из его сообщения', async () => {
    const failure = new Error('Failed query: insert into items … params: Молоко', {
      cause: Object.assign(new Error('deadlock detected'), { code: '40P01' }),
    })
    const { exit, lines } = run(['--yes'], failure)
    expect(await exit).toBe(1)
    expect(lines).toEqual(['seeding failed, nothing changed: 40P01'])
  })
})
