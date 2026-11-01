import { describe, expect, it } from 'vitest'
import { figureChars } from '@/components/figure'

const width = (text: string) => Number(Object.values(figureChars(text) as object)[0])

describe('figureChars (MOL-321)', () => {
  it('measures a figure in its own size: a figure 0.6, a no-break space 0.279, the dram 0.765', () => {
    // 6 × 0.6 + 0.279 + 0.279 + 0.765, with the room of another engine: CI's Chromium sets a character on a whole pixel.
    expect(figureChars('125 403 ֏')).toEqual({ '--figure-width': '5.169' })
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

  // A sum in a row is set in the words' face, whose figure is 12 % wider (adversarial Г2): «124 597 ֏» in Onest.
  it('measures a sum set in the words’ face by that face', () => {
    const text = (sum: string) => Number(Object.values(figureChars(sum, 'text') as object)[0])
    expect(text('124\u00a0597\u00a0֏')).toBeGreaterThanOrEqual(6 * 0.673 + 2 * 0.278 + 0.747)
    expect(text('124\u00a0597\u00a0֏')).toBeGreaterThan(width('124\u00a0597\u00a0֏'))
  })

  // A tile's figure is Onest at 700: its comma, «≈» and «₽» are wider than 600's, and «≈ 1 433 318 ₽» stood 2.3 px into
  // its tile in CI by the table of 600 (round 9).
  it('measures a tile’s figure by the face at 700', () => {
    const at = (sum: string, face: 'text' | 'strong') =>
      Number(Object.values(figureChars(sum, face) as object)[0])
    const sum = '≈ 1\u00a0433\u00a0318,89 ₽'
    expect(at(sum, 'strong')).toBeGreaterThanOrEqual(
      0.647 + 0.282 + 9 * 0.673 + 3 * 0.282 + 0.335 + 0.647,
    )
    expect(at(sum, 'strong')).toBeGreaterThan(at(sum, 'text'))
  })

  it('takes a character it does not know as a capital, the widest a figure holds', () => {
    expect(width('Q')).toBeGreaterThan(width('8'))
  })
})
