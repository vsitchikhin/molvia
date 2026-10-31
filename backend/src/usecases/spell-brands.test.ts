import { describe, expect, it, vi } from 'vitest'
import type { BrandSpellingRepository, BrandSpelt } from '@/db/brand-spellings-repository'
import type { ModelSpendRepository } from '@/db/model-spend-repository'
import { ModelRejected, ModelUnavailable } from '@/receipts/model-reader'
import type { BrandAsked, BrandSpelling, ReceiptModel } from '@/receipts/model-reader'
import { spelledBrands } from './spell-brands'
import type { SpellReport } from './spell-brands'

const NOW = new Date('2026-10-31T12:00:00Z')
const PAID = { costMicroUsd: 120, tokens: { input: 400, output: 60 } }

const FELIX: BrandAsked = { brand: 'Ֆելիքս', line: 'Կատվի կեր «Ֆելիքս» 85գ' }
const LOCAL: BrandAsked = { brand: 'Աշտարակ Կաթ', line: 'Կաթ «Աշտարակ Կաթ» 1լ' }

function harness(
  answer: () => Promise<BrandSpelling>,
  {
    said = new Map<string, string | null>(),
    room = true,
  }: { said?: Map<string, string | null>; room?: boolean } = {},
) {
  const remembered: BrandSpelt[] = []
  const spellings: BrandSpellingRepository = {
    said: (brands) =>
      Promise.resolve(new Map([...said].filter(([brand]) => brands.includes(brand)))),
    spelt: () => Promise.resolve(new Map()),
    remember: (rows) => {
      remembered.push(...rows)
      return Promise.resolve()
    },
  }
  const reserve = vi.fn<ModelSpendRepository['reserve']>(() => Promise.resolve(room))
  const settle = vi.fn<ModelSpendRepository['settle']>(() => Promise.resolve())
  const spellBrands = vi.fn<ReceiptModel['spellBrands']>(answer)
  const reader = {
    version: 'claude-haiku-5-5@v5',
    brandsVersion: 'claude-haiku-5-5@brands-v1',
    inputTokensMax: () => null,
    read: () => Promise.reject(new Error('no reading here')),
    brandsInputTokensMax: () => 500,
    spellBrands,
  } satisfies ReceiptModel
  const reports: SpellReport[] = []
  const deps = {
    spellings,
    model: {
      reader,
      spend: { reserve, settle, month: () => Promise.resolve(null) },
      capMicroUsd: 200_000_000,
    },
    report: (event: SpellReport) => reports.push(event),
    now: () => NOW,
  }
  return { deps, remembered, reserve, settle, spellBrands, reports }
}

const read = (spellings: (string | null)[]): Promise<BrandSpelling> =>
  Promise.resolve({ kind: 'read', spellings, ...PAID })

describe('the brands of a receipt the model read, asked of it (MOL-326, В-1 «б»)', () => {
  it('takes a spelling that sounds as the till printed it, and remembers what was said of each', async () => {
    const h = harness(() => read(['Felix', null]))
    const spelt = await spelledBrands(h.deps, [FELIX, LOCAL, FELIX])
    expect(spelt).toEqual(new Map([['ֆելիքս', 'Felix']]))
    // asked once a brand, the same brand twice on a receipt one question
    expect(h.spellBrands).toHaveBeenCalledWith([FELIX, LOCAL])
    expect(h.remembered).toEqual([
      { brand: 'ֆելիքս', spelling: 'Felix' },
      { brand: 'աշտարակ կաթ', spelling: null },
    ])
    expect(h.settle).toHaveBeenCalledWith('2026-10-01', expect.any(Number), 120, 200_000_000, NOW)
    expect(h.reports).toEqual([{ kind: 'brands_spelt', asked: 2, taken: 1, paid: PAID }])
  })

  it('remembers a spelling that does not sound so as none: «Ֆելիքս» is never Whiskas', async () => {
    const h = harness(() => read(['Whiskas']))
    expect(await spelledBrands(h.deps, [FELIX])).toEqual(new Map())
    expect(h.remembered).toEqual([{ brand: 'ֆելիքս', spelling: null }])
  })

  it('must not ask of a brand said before, a spelling or none', async () => {
    const said = new Map<string, string | null>([
      ['ֆելիքս', 'Felix'],
      ['աշտարակ կաթ', null],
    ])
    const h = harness(() => read([]), { said })
    expect(await spelledBrands(h.deps, [FELIX, LOCAL])).toEqual(new Map([['ֆելիքս', 'Felix']]))
    expect(h.spellBrands).not.toHaveBeenCalled()
    expect(h.reserve).not.toHaveBeenCalled()
  })

  it('must not ask over the cap: the brands are spelt in letters, and asked with the next receipt', async () => {
    const h = harness(() => read(['Felix']), { room: false })
    expect(await spelledBrands(h.deps, [FELIX])).toEqual(new Map())
    expect(h.spellBrands).not.toHaveBeenCalled()
    expect(h.remembered).toEqual([])
    expect(h.reports).toEqual([{ kind: 'brands_passed', reason: 'cap' }])
  })

  it('remembers nothing of a refusal, a cut answer or one of no schema — each paid', async () => {
    for (const kind of ['refused', 'cut', 'invalid'] as const) {
      const h = harness(() => Promise.resolve({ kind, ...PAID }))
      expect(await spelledBrands(h.deps, [FELIX])).toEqual(new Map())
      expect(h.remembered).toEqual([])
      expect(h.settle).toHaveBeenCalledWith('2026-10-01', expect.any(Number), 120, 200_000_000, NOW)
      expect(h.reports).toEqual([{ kind: 'brands_passed', reason: kind, paid: PAID }])
    }
  })

  it('keeps the worst counted of a call whose price is not known, and settles one refused before the model', async () => {
    const away = harness(() => Promise.reject(new ModelUnavailable('timeout', null)))
    expect(await spelledBrands(away.deps, [FELIX])).toEqual(new Map())
    expect(away.settle).not.toHaveBeenCalled()
    expect(away.reports).toEqual([{ kind: 'brands_unavailable', reason: 'timeout' }])

    const busy = harness(() => Promise.reject(new ModelUnavailable('status 429', 0)))
    await spelledBrands(busy.deps, [FELIX])
    expect(busy.settle).toHaveBeenCalledWith('2026-10-01', expect.any(Number), 0, 200_000_000, NOW)

    const rejected = new ModelRejected(400)
    const refused = harness(() => Promise.reject(rejected))
    await spelledBrands(refused.deps, [FELIX])
    expect(refused.settle).toHaveBeenCalledWith(
      '2026-10-01',
      expect.any(Number),
      0,
      200_000_000,
      NOW,
    )
    expect(refused.reports).toEqual([{ kind: 'brands_rejected', error: rejected }])
  })

  it('asks nothing of no brand', async () => {
    const h = harness(() => read([]))
    expect(await spelledBrands(h.deps, [])).toEqual(new Map())
    expect(h.spellBrands).not.toHaveBeenCalled()
  })
})
