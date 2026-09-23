import { describe, expect, it } from 'vitest'
import { isSamePlaceName, placeNameIdentity } from '#model/values/place-identity'

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
