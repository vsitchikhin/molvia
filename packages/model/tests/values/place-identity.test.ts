import { describe, expect, it } from 'vitest'
import {
  cityWhereNameRepeats,
  isSamePlaceName,
  placeNameIdentity,
} from '#model/values/place-identity'

/**
 * The authority is the unique index over `places`, and an integration test holds this function
 * to it over every letter of the scripts a shop name is written in. What is written down here
 * is the intent — so the reason a case is folded the way it is survives without a database.
 */
describe('when two spellings name one place', () => {
  it('ignores what the index ignores', () => {
    expect(isSamePlaceName(' Ереван Сити ', 'ереван сити')).toBe(true)
    expect(isSamePlaceName('SAS', 'ＳＡＳ')).toBe(true)
    expect(isSamePlaceName('Кафе ☕️', 'Кафе ☕')).toBe(true)
    expect(isSamePlaceName('Գյումրի​', 'Գյումրի')).toBe(true)
  })

  it('keeps apart what the index keeps apart', () => {
    // `btrim` touches the ends only: two spaces inside are two places to the server.
    expect(isSamePlaceName('Ереван  Сити', 'Ереван Сити')).toBe(false)
    expect(isSamePlaceName('SAS', 'Ереван Сити')).toBe(false)
  })

  it('folds each character on its own, as `lower()` does', () => {
    // A final sigma is the dangerous case (Д3): `String.prototype.toLowerCase` writes «ς» at the
    // end of a word and Postgres writes «σ», so a whole-string fold merged two places the server
    // keeps apart — and the screen would then say nothing about prices moving to another shop.
    expect(placeNameIdentity('ΑΣ')).toBe('ασ')
    expect(placeNameIdentity('Ας')).toBe('ας')
    expect(isSamePlaceName('ΑΣ', 'Ας')).toBe(false)
    expect(isSamePlaceName('ΟΔΟΣ', 'Οδοσ')).toBe(true)
  })

  it('folds `İ` the way the index does, without the dot its full mapping adds', () => {
    expect(placeNameIdentity('İstanbul Market')).toBe('istanbul market')
    expect(isSamePlaceName('İstanbul Market', 'Istanbul Market')).toBe(true)
  })
})

describe('the city a place is printed with (MOL-120)', () => {
  const gyumri = { name: 'Ереван Сити', city: 'Гюмри' }
  const yerevan = { name: 'Ереван Сити', city: 'Ереван' }
  const sas = { name: 'SAS', city: 'Ереван' }

  it('is named where one name stands in two cities', () => {
    const city = cityWhereNameRepeats([gyumri, sas, yerevan])
    expect(city(gyumri)).toBe('Гюмри')
    expect(city(yerevan)).toBe('Ереван')
  })

  it('is noise where the name is the only one of its kind', () => {
    expect(cityWhereNameRepeats([gyumri, sas, yerevan])(sas)).toBeNull()
    expect(cityWhereNameRepeats([yerevan, sas])(yerevan)).toBeNull()
    expect(cityWhereNameRepeats([yerevan])(yerevan)).toBeNull()
    expect(cityWhereNameRepeats([])(yerevan)).toBeNull()
  })

  it('does not count one place twice as a repeat', () => {
    // Three cards bought in the same shop are one place, however many of them wait.
    expect(cityWhereNameRepeats([yerevan, { ...yerevan }, yerevan])(yerevan)).toBeNull()
  })

  it('compares names and cities as the index over `places` does', () => {
    const other = { name: ' sas', city: 'Гюмри' }
    const city = cityWhereNameRepeats([sas, other])
    expect(city(sas)).toBe('Ереван')
    expect(city(other)).toBe('Гюмри')
    // One city spelled two ways is one city, and so one place.
    expect(cityWhereNameRepeats([sas, { name: 'SAS', city: 'ереван ' }])(sas)).toBeNull()
  })

  it('names no city at all where one place came without it', () => {
    const city = cityWhereNameRepeats([gyumri, yerevan, { name: 'Ереван Сити' }])
    expect(city(gyumri)).toBeNull()
    expect(city(yerevan)).toBeNull()
  })
})
