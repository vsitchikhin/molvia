import { describe, expect, it } from 'vitest'
import { backLabelFit } from '@/composables/useBackLabel'

describe('backLabelFit', () => {
  // «Настройки» is 91 wide and «Назад» 51, in the button's type at 17px.
  it.each([
    [92, 'full'],
    [91, 'full'],
    [90, 'short'],
    [51, 'short'],
    [50, 'none'],
    [0, 'none'],
  ] as const)('with %ipx for a 91px label and a 51px «Back»: %s', (room, fit) => {
    expect(backLabelFit(room, 91, 51)).toBe(fit)
  })

  // «Trip» is 31 and «Back» 40: where the title itself does not fit, the longer word does not
  // either, and the chevron stands alone rather than saying less than it could.
  it('never trades a label for a longer «Back»', () => {
    expect(backLabelFit(35, 31, 40)).toBe('full')
    expect(backLabelFit(30, 31, 40)).toBe('none')
  })

  it('draws nothing beside the chevron in a column narrower than the chevron', () => {
    expect(backLabelFit(-4, 91, 51)).toBe('none')
  })
})
