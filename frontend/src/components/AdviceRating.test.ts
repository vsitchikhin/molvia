import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createAppI18n } from '@/i18n'
import AdviceRating from '@/components/AdviceRating.vue'

/** Intl groups digits with a no-break space; the assertions below are written with plain ones. */
const NBSP = String.fromCharCode(0xa0)
const plain = (text: string): string => text.replaceAll(NBSP, ' ')

const render = (rating: string, count: number) =>
  mount(AdviceRating, { props: { rating, count }, global: { plugins: [createAppI18n('ru')] } })

describe('AdviceRating', () => {
  it('prints the figure and how much it is worth', () => {
    expect(plain(render('4.3', 3).text())).toBe('4,3 из 5 · 3 оценки')
  })

  it('one rating is one`s own, and the word agrees with the number', () => {
    expect(plain(render('5.0', 1).text())).toBe('5,0 из 5 · 1 оценка')
    expect(plain(render('4.0', 5).text())).toBe('4,0 из 5 · 5 оценок')
  })

  it('keeps the tenth on a whole score: «5» would read as a different scale', () => {
    expect(render('5.0', 1).text()).toContain('5,0')
  })
})
