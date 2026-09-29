import { describe, expect, it } from 'vitest'
import type { AdviceRow } from '@molvia/model'
import { searchRemembered } from '@/composables/useAdviceSearch'

const row = (itemId: string, name: string): AdviceRow => ({
  level: 'never',
  itemId,
  name,
  rating: '1.0',
  ratingsCount: 1,
  review: null,
  isMine: true,
})

const lori = row('cccccccc-0000-4000-8000-000000000001', 'Сыр Лори')
const lavash = row('cccccccc-0000-4000-8000-000000000002', 'Лаваш армянский')
const milk = row('cccccccc-0000-4000-8000-000000000003', 'Молоко «Ашхар» 3,2%')
const rows = [lori, lavash, milk]
const names = (text: string) => searchRemembered(rows, text).map((found) => found.name)

describe('searchRemembered — the list on the phone, searched with no connection (В-3)', () => {
  it('finds by the start of a word, in the list`s own order', () => {
    expect(names('сыр')).toEqual(['Сыр Лори'])
    expect(names('лор')).toEqual(['Сыр Лори'])
    expect(names('арм')).toEqual(['Лаваш армянский'])
  })

  it('the transliteration holds: the key is the domain`s own', () => {
    expect(names('syr')).toEqual(['Сыр Лори'])
    expect(names('lavash')).toEqual(['Лаваш армянский'])
    expect(names('ashhar')).toEqual(['Молоко «Ашхар» 3,2%'])
  })

  it('every word typed must start a word of the name', () => {
    expect(names('сыр лори')).toEqual(['Сыр Лори'])
    expect(names('сыр лаваш')).toEqual([])
  })

  // «сыыр» is found: the key folds a doubled letter itself. A typo past the key is the server's.
  it('must not fire: a typo the key does not fold, or the middle of a word', () => {
    expect(names('сыыр')).toEqual(['Сыр Лори'])
    expect(names('сор')).toEqual([])
    expect(names('ори')).toEqual([])
  })

  it('nothing typed that draws finds nothing, not everything', () => {
    expect(names('   ')).toEqual([])
  })

  it('answers each row with the row itself: the verdict as the list had it', () => {
    expect(searchRemembered(rows, 'сыр')).toEqual([
      { itemId: lori.itemId, name: lori.name, advice: lori },
    ])
  })
})
