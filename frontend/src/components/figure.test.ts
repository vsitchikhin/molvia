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

  // A capital Latin letter and a minus are wider than a figure (adversarial Б3): «−999,99 RSD».
  it('counts a capital Latin letter and a minus a little more, a figure and a sign as one', () => {
    expect(figureChars('−999,99 RSD')).toEqual({ '--figure-chars': '11.6' })
    expect(figureChars('-5 $')).toEqual({ '--figure-chars': '4.15' })
    expect(figureChars('999,99 ₽')).toEqual({ '--figure-chars': '8' })
  })
})
