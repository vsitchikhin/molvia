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
    isMine: true,
    itemId: 'cccccccc-0000-4000-8000-000000000002',
    name: 'Сыр «Чанах»',
    rating: '2.8',
    ratingsCount: 4,
    review: null,
    places,
    threshold,
  }
}

const render = (
  places: AdvicePlace[],
  threshold: UnitPrice | null,
  scope: 'own' | 'shared' = 'shared',
) =>
  mount(AdviceCheapRow, {
    props: { row: row(places, threshold), scope },
    global: { plugins: [createAppI18n('ru')] },
  })

describe('AdviceCheapRow', () => {
  it('Ф-21: the price and its place first, the threshold under them', () => {
    const view = render([sas], price(300_000_000_000n))

    expect(plain(view.get('.at').text())).toBe('3 200,00 ֏/кг · SAS')
    expect(plain(view.get('.threshold').text())).toBe('Стоит брать дешевле 3 000,00 ֏/кг')
    expect(plain(view.get('.title').text())).toBe('Сыр «Чанах»2,8 из 5 · 4 оценки')
  })

  it('under three purchases there is no threshold: the price and the place alone', () => {
    // A median of two is a number with nothing under it (MOL-33).
    const view = render([sas], null)

    expect(plain(view.get('.at').text())).toBe('3 200,00 ֏/кг · SAS')
    expect(view.find('.threshold').exists()).toBe(false)
  })

  it('rated but never bought with a price: the threshold alone, and no line for a place', () => {
    const view = render([], price(300_000_000_000n))

    expect(view.find('.at').exists()).toBe(false)
    expect(plain(view.get('.threshold').text())).toBe('Стоит брать дешевле 3 000,00 ֏/кг')
  })

  it('neither a threshold nor a place: the name and the rating, and no empty line', () => {
    const view = render([], null)

    expect(view.find('.at').exists()).toBe(false)
    expect(view.find('.threshold').exists()).toBe(false)
    expect(plain(view.get('.title').text())).toBe('Сыр «Чанах»2,8 из 5 · 4 оценки')
  })

  it('MOL-120: the place named is told from a namesake of another city on the row', () => {
    const gyumri = { ...place('SAS', 320_000_000_000n), city: 'Гюмри' }
    const yerevan = { ...place('sas', 335_000_000_000n), city: 'Ереван' }

    expect(plain(render([gyumri, yerevan], null).get('.at').text())).toBe(
      '3 200,00 ֏/кг · SAS в Гюмри',
    )
    expect(plain(render([gyumri], null).get('.at').text())).toBe('3 200,00 ֏/кг · SAS')
  })

  it('А1: the price shown is the named place`s, and no word claims anything of the others', () => {
    // Own city first, then by price: the first place can be the dearer one. Its own price is
    // printed beside it, and with no «Дешевле всего» there is nothing to be false.
    const dearerFirst = render([market, sas], null)
    const cheaperFirst = render([sas, market], null)

    expect(plain(dearerFirst.get('.at').text())).toBe('3 350,00 ֏/кг · Рынок в Гюмри')
    expect(plain(cheaperFirst.get('.at').text())).toBe('3 200,00 ֏/кг · SAS')
    for (const view of [dearerFirst, cheaperFirst]) {
      expect(view.text()).not.toMatch(/Дешевле всего|Брали здесь/)
    }
  })

  it('carries the verdict as a circle, so the row reads without colour', () => {
    expect(render([sas], null).get('[role="img"]').attributes('aria-label')).toBe(
      'Только если дёшево',
    )
  })

  it('says that a tap changes the rating — the row is a button with no other name', () => {
    expect(render([sas], null).get('button .hidden').text()).toBe('Изменить оценку')
  })
})
