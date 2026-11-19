import { describe, expect, it } from 'vitest'
import { guessedTripCategory, servesFood } from '#model/entities/spending-category'
import type { ChoosableCategory } from '#model/entities/spending-category'

const groceries: ChoosableCategory = { id: 'g', preset: 'groceries', archived: false }
const cafe: ChoosableCategory = { id: 'c', preset: 'cafe', archived: false }
const pets: ChoosableCategory = { id: 'p', preset: 'pets', archived: false }
const own: ChoosableCategory = { id: 'o', preset: null, archived: false }
const all = [groceries, cafe, pets, own]

const at = (placeId: string, categoryId: string) => ({ placeId, categoryId })

describe('servesFood (MOL-400)', () => {
  it('is a line of the class 56 or a café’s service', () => {
    expect(servesFood([null, '0401', '56.10'], false)).toBe(true)
    expect(servesFood(['56.30'], false)).toBe(true)
    expect(servesFood([], true)).toBe(true)
  })

  it('is not a heading of goods, another class of services, or nothing', () => {
    expect(servesFood(['0401', '5610', null], false)).toBe(false)
    expect(servesFood(['96.02'], false)).toBe(false)
    expect(servesFood([], false)).toBe(false)
  })
})

describe('guessedTripCategory (MOL-400, Р-6)', () => {
  it('takes the category of the last trip at this place first, the receipt’s food after it', () => {
    const lastAt = [at('zoo', 'p'), at('kfc', 'o')]
    expect(guessedTripCategory(all, { placeId: 'zoo', lastAt, food: false })).toBe('p')
    expect(guessedTripCategory(all, { placeId: 'kfc', lastAt, food: true })).toBe('o')
  })

  it('is a café for food service at a place with no trip before', () => {
    expect(guessedTripCategory(all, { placeId: 'new', lastAt: [], food: true })).toBe('c')
    expect(guessedTripCategory(all, { placeId: null, lastAt: [], food: true })).toBe('c')
  })

  it('is «Продукты» otherwise', () => {
    expect(
      guessedTripCategory(all, { placeId: 'new', lastAt: [at('zoo', 'p')], food: false }),
    ).toBe('g')
  })

  it('passes over a category taken out of the choice, or one the phone does not know', () => {
    const archived = [groceries, { ...pets, archived: true }, { ...cafe, archived: true }]
    expect(
      guessedTripCategory(archived, { placeId: 'zoo', lastAt: [at('zoo', 'p')], food: true }),
    ).toBe('g')
    expect(
      guessedTripCategory(all, { placeId: 'zoo', lastAt: [at('zoo', 'gone')], food: false }),
    ).toBe('g')
  })

  it('offers nothing with «Продукты» taken out of the choice and nothing else to say', () => {
    expect(
      guessedTripCategory([{ ...groceries, archived: true }], {
        placeId: null,
        lastAt: [],
        food: false,
      }),
    ).toBeNull()
    expect(guessedTripCategory([], { placeId: null, lastAt: [], food: true })).toBeNull()
  })
})
