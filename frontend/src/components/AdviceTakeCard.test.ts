import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { AdvicePlace } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import AdviceTakeCard from '@/components/AdviceTakeCard.vue'
import type { TakeRow } from '@/components/adviceRow'

/** Intl groups digits with a no-break space; the assertions below are written with plain ones. */
const NBSP = String.fromCharCode(0xa0)
const plain = (text: string): string => text.replaceAll(NBSP, ' ')

function place(name: string, scaledMinor: bigint, unit: 'kg' | 'l' = 'kg'): AdvicePlace {
  return {
    placeId: `aaaaaaaa-0000-4000-8000-00000000000${String(name.length % 10)}`,
    name,
    unitPrice: { scaledMinor, currency: 'AMD', unit },
    observations: 3,
  }
}

const market = place('Рынок в Гюмри', 479_000_000_000n)
const sas = place('SAS', 510_000_000_000n)
const carrefour = place('Carrefour', 524_000_000_000n)

function row(places: AdvicePlace[], review: string | null = null): TakeRow {
  return {
    level: 'take',
    isMine: true,
    itemId: 'cccccccc-0000-4000-8000-000000000001',
    name: 'Говядина, вырезка',
    rating: '4.8',
    ratingsCount: 3,
    review,
    places,
  }
}

const render = (
  places: AdvicePlace[],
  review: string | null = null,
  scope: 'own' | 'shared' = 'shared',
) =>
  mount(AdviceTakeCard, {
    props: { row: row(places, review), scope },
    global: { plugins: [createAppI18n('ru')] },
  })

describe('AdviceTakeCard', () => {
  it('two places and more: «Дешевле всего», the rest in one line, all with the price per unit', () => {
    const view = render([market, sas, carrefour])

    expect(plain(view.get('.where').text())).toBe('Дешевле всего: Рынок в Гюмри')
    expect(plain(view.get('.price').text())).toBe('4 790,00 ֏/кг')
    expect(plain(view.get('.more').text())).toBe('Ещё: SAS 5 100,00 ֏/кг · Carrefour 5 240,00 ֏/кг')
  })

  it('one place is «Брали здесь»: a superlative out of one observation is a conclusion from nothing', () => {
    const view = render([market])

    expect(plain(view.get('.where').text())).toBe('Брали здесь: Рынок в Гюмри')
    expect(view.find('.more').exists()).toBe(false)
  })

  it('А1: a dearer first place is named without the superlative', () => {
    // The places come own city first, then by price (Р-26), so the named one may be the
    // dearest — and «Дешевле всего» over it, with a cheaper line under «Ещё», was a lie.
    const view = render([sas, market])

    expect(plain(view.get('.where').text())).toBe('Брали здесь: SAS')
    expect(plain(view.get('.more').text())).toBe('Ещё: Рынок в Гюмри 4 790,00 ֏/кг')
  })

  it('rated but never bought: no price block at all, rather than an empty one', () => {
    const view = render([])

    expect(view.find('.best').exists()).toBe(false)
    expect(view.text()).toContain('Говядина, вырезка')
    expect(view.text()).toContain('4,8 из 5')
  })

  it('names the verdict and the figure it stands on', () => {
    expect(plain(render([market]).get('.head').text())).toBe('БРАТЬ4,8 из 5 · 3 оценки')
    // In the own mode the count is always one, and the subtitle above already says so.
    expect(plain(render([market], null, 'own').get('.head').text())).toBe('БРАТЬ4,8 из 5')
  })

  it('says that a tap changes the rating — the row is a button with no other name', () => {
    expect(render([market]).get('button .hidden').text()).toBe('Изменить оценку')
  })

  it('says nothing about the shops but their name and their price', () => {
    // No logo, no accent colour, no order but the price: an accent in a list of results reads
    // as a promoted place, and there are none.
    const view = render([market, sas])

    expect(view.find('img').exists()).toBe(false)
    expect(view.html()).not.toMatch(/sponsored|promoted|boost/i)
  })
})
