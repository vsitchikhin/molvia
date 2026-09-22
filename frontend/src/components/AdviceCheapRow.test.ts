import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { AdvicePlace, UnitPrice } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import AdviceCheapRow from '@/components/AdviceCheapRow.vue'
import type { CheapRow } from '@/components/adviceRow'

/** Intl groups digits with a no-break space; the assertions below are written with plain ones. */
const NBSP = String.fromCharCode(0xa0)
const plain = (text: string): string => text.replaceAll(NBSP, ' ')

const price = (scaledMinor: bigint): UnitPrice => ({ scaledMinor, currency: 'AMD', unit: 'kg' })

function place(name: string, scaledMinor: bigint): AdvicePlace {
  return {
    placeId: 'aaaaaaaa-0000-4000-8000-000000000001',
    name,
    unitPrice: price(scaledMinor),
    observations: 2,
  }
}

const sas = place('SAS', 320_000_000_000n)
const market = place('Рынок в Гюмри', 335_000_000_000n)

function row(places: AdvicePlace[], threshold: UnitPrice | null): CheapRow {
  return {
    level: 'if_cheap',
    itemId: 'cccccccc-0000-4000-8000-000000000002',
    name: 'Сыр «Чанах»',
    rating: '2.8',
    ratingsCount: 4,
    review: null,
    places,
    threshold,
  }
}

const render = (places: AdvicePlace[], threshold: UnitPrice | null) =>
  mount(AdviceCheapRow, {
    props: { row: row(places, threshold) },
    global: { plugins: [createAppI18n('ru')] },
  })

describe('AdviceCheapRow', () => {
  it('says from what price the thing is worth taking, and at what it is sold', () => {
    const view = render([sas], price(300_000_000_000n))

    expect(plain(view.get('.second').text())).toBe('Стоит брать дешевле 3 000,00 ֏/кг')
    expect(plain(view.get('.price').text())).toBe('3 200,00 ֏/кг')
  })

  it('under three purchases there is no threshold, and the line names the place instead', () => {
    // A median of two is a number with nothing under it (MOL-33), and a line left empty would
    // leave the row without an answer to «where did I buy this» (В-2).
    expect(plain(render([sas], null).get('.second').text())).toBe('Брали здесь: SAS')
    expect(plain(render([sas, market], null).get('.second').text())).toBe('Дешевле всего: SAS')
  })

  it('neither a threshold nor a place: the name and the rating, and no empty line', () => {
    const view = render([], null)

    expect(view.find('.second').exists()).toBe(false)
    expect(view.find('.price').exists()).toBe(false)
    expect(plain(view.text())).toContain('2,8 из 5 · 4 оценки')
  })

  it('carries the verdict as a circle, so the row reads without colour', () => {
    expect(render([sas], null).get('[role="img"]').attributes('aria-label')).toBe(
      'Только если дёшево',
    )
  })
})
