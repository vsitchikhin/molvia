import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createAppI18n } from '@/i18n'
import AdviceNeverRow from '@/components/AdviceNeverRow.vue'
import type { NeverRow } from '@/components/adviceRow'

/** Intl groups digits with a no-break space; the assertions below are written with plain ones. */
const NBSP = String.fromCharCode(0xa0)
const plain = (text: string): string => text.replaceAll(NBSP, ' ')

function row(review: string | null): NeverRow {
  return {
    level: 'never',
    itemId: 'cccccccc-0000-4000-8000-000000000003',
    name: 'Колбаса «Молочная»',
    rating: '1.4',
    ratingsCount: 4,
    review,
  }
}

const render = (review: string | null = null) =>
  mount(AdviceNeverRow, { props: { row: row(review) }, global: { plugins: [createAppI18n('ru')] } })

describe('AdviceNeverRow', () => {
  it('the name struck through and the figure behind the verdict', () => {
    const view = render()

    expect(view.get('.name').text()).toBe('Колбаса «Молочная»')
    expect(plain(view.text())).toContain('1,4 из 5 · 4 оценки')
  })

  it('the review explains the verdict better than any figure, and it is always one`s own', () => {
    expect(render('Пахнет крахмалом, а не мясом').get('.review').text()).toBe(
      'Пахнет крахмалом, а не мясом',
    )
    expect(render().find('.review').exists()).toBe(false)
  })

  it('no price and no place — and this is the check that matters on this screen', () => {
    // Not «the price is muted» and not «a dash in the price column»: a column for a price is
    // still a column for a price. The row it draws has no such field at all (MOL-31, Р-8),
    // and nothing in the markup invents one.
    const html = render('Пахнет крахмалом').html()

    expect(html).not.toContain('֏')
    expect(html).not.toMatch(/SAS|Рынок|Carrefour/)
    // The only digits on the line are the rating and how many people gave it.
    expect(plain(render().text()).replace('1,4 из 5 · 4 оценки', '')).not.toMatch(/\d/)
  })
})
