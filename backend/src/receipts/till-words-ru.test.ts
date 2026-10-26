import { describe, expect, it } from 'vitest'
import { NOUNS_OF_ADJECTIVE_ENDING, POSSESSIVE_ADJECTIVES } from '@molvia/model'
import { CATALOGUE_SEED } from '@/catalogue-seed'
import { TILL_GENITIVES_RU, TILL_PHRASES_RU, TILL_WORDS_RU } from './till-words-ru'

/** Every Russian word the three dictionaries give, each sense of «a/b» apart. */
const russianWords = [TILL_WORDS_RU, TILL_GENITIVES_RU, TILL_PHRASES_RU].flatMap((table) =>
  Object.values(table).flatMap((gloss) =>
    gloss
      .split('/')
      .flatMap((sense) => sense.toLowerCase().split(/[^а-яё-]+/u))
      .filter((word) => word !== ''),
  ),
)

/**
 * The words in «-ий» whose ending agrees by the ordinary rule — «горячая», «свежее», «синие» — reviewed one by one
 * (MOL-261, self-review Р1-1): «телячий» ends as «горячий» does, and agreed so it was «телячее».
 */
const ORDINARY = new Set([
  'верхний',
  'высший',
  'горячий',
  'дезинфицирующий',
  'домашний',
  'лучший',
  'нержавеющий',
  'отбеливающий',
  'рабочий',
  'свежий',
  'синий',
  'средний',
  'увлажняющий',
  'хрустящий',
  'чистящий',
])

describe('the dictionaries a new item is named by (MOL-261)', () => {
  it('holds every word in «-ий» no ending tells to the possessive, the ordinary or a noun', () => {
    const unread = [...new Set(russianWords.filter((word) => /[^кгх]ий$/u.test(word)))].filter(
      (word) =>
        !POSSESSIVE_ADJECTIVES.has(word) &&
        !NOUNS_OF_ADJECTIVE_ENDING.has(word) &&
        !ORDINARY.has(word),
    )
    expect(unread).toEqual([])
  })

  it('writes a phrase in the seed’s number of its kind: «Пирожные» is the seed’s, so `kindKey` is one (self-review Р1-2)', () => {
    const heads = new Set(CATALOGUE_SEED.map(([name]) => (name.split(' ')[0] ?? '').toLowerCase()))
    const apart = Object.values(TILL_PHRASES_RU)
      .map((phrase) => (phrase.split(' ')[0] ?? '').toLowerCase())
      .filter((head) => !heads.has(head))
      // the seed's word of the kind with another ending, its number: «пирожное» beside «пирожные»
      .filter((head) =>
        [...heads].some((one) => one.length > 4 && one.slice(0, -2) === head.slice(0, -2)),
      )
    expect(apart).toEqual([])
  })
})
