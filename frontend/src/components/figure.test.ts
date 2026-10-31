import { describe, expect, it } from 'vitest'
import { figureChars } from '@/components/figure'

const width = (text: string) => Number(Object.values(figureChars(text) as object)[0])

describe('figureChars (MOL-321)', () => {
  it('measures a figure in its own size: a figure 0.6, a no-break space 0.279, the dram 0.765', () => {
    // 6 × 0.6 + 0.279 + 0.279 + 0.765, with the room of another engine.
    expect(figureChars('125 403 ֏')).toEqual({ '--figure-width': '5.071' })
  })

  it('must not count the spaces a template leaves around it', () => {
    expect(width('\n  ≈ 0 ₽\n')).toBe(width('≈ 0 ₽'))
  })

  // A share of figures alone was taken for the whole: «֏125,403» in English is 0.578 of its size a character
  // (adversarial В2), and «−999,99 RSD» 0.568 (Б3) — each wider than its count at 0.56.
  it('is never narrower than the widths measured, the English dram and the dinar included', () => {
    expect(width('֏125,403')).toBeGreaterThanOrEqual(0.578 * 8)
    expect(width('−999,99 RSD')).toBeGreaterThanOrEqual(0.568 * 11)
  })

  it('takes a character it does not know as a capital, the widest a figure holds', () => {
    expect(width('Q')).toBeGreaterThan(width('8'))
  })
})
