import { describe, expect, it } from 'vitest'
import { figureChars } from '@/components/figure'

describe('figureChars (MOL-321)', () => {
  it('counts a figure as the eye sees it: the sign and «≈» are one each, a no-break space one', () => {
    expect(figureChars('1 234 567,89 ₽')).toEqual({ '--figure-chars': '14' })
    expect(figureChars('≈ 125 403 ֏')).toEqual({ '--figure-chars': '11' })
  })

  it('must not count the spaces a template leaves around it', () => {
    expect(figureChars('\n  ≈ 0 ₽\n')).toEqual({ '--figure-chars': '5' })
  })
})
