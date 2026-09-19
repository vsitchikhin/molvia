import { describe, expect, it } from 'vitest'
import { newPlaceSchema, placeSchema } from '#model/entities/place'

const place = {
  id: 'b1e0f2a4-5c6d-4e8f-9a0b-1c2d3e4f5a6b',
  kind: 'store',
  name: 'SAS',
  country: 'AM',
  city: 'Гюмри',
  createdAt: new Date('2026-09-08T10:00:00Z'),
}

describe('placeSchema', () => {
  it('accepts a shop', () => {
    expect(placeSchema.parse(place).name).toBe('SAS')
  })

  it("parses kind 'venue', so 0.3 needs no migration", () => {
    expect(placeSchema.parse({ ...place, kind: 'venue' }).kind).toBe('venue')
  })

  it('rejects a country that is not ISO 3166-1 alpha-2', () => {
    for (const country of ['ARM', 'am', 'A', '']) {
      expect(() => placeSchema.parse({ ...place, country })).toThrow()
    }
  })
})

describe('newPlaceSchema', () => {
  const input = { kind: 'store', name: 'SAS', country: 'AM', city: 'Гюмри' }

  it('takes what a client can know', () => {
    expect(newPlaceSchema.parse(input)).toEqual(input)
  })

  it('refuses an id: the server hands those out', () => {
    expect(() => newPlaceSchema.parse({ ...input, id: place.id })).toThrow()
  })

  it('refuses a currency: money follows the person, not the shop', () => {
    expect(() => newPlaceSchema.parse({ ...input, currency: 'AMD' })).toThrow()
  })
})

describe('newPlaceSchema: the name is an identity (MOL-21, adversarial Д)', () => {
  const place = (name: string) =>
    newPlaceSchema.parse({ kind: 'store', name, country: 'AM', city: 'Gyumri' }).name

  it.each([
    ['U+2060 word joiner', '\u2060'],
    ['U+00AD soft hyphen', '\u00ad'],
    ['U+2800 braille blank', '\u2800'],
    ['U+3164 hangul filler', '\u3164'],
    ['U+200B zero width space', '\u200b'],
    ['U+00A0 no-break space', '\u00a0'],
  ])('%s at either end is dropped', (_label, mark) => {
    expect(place(`${mark}Ереван Сити${mark}`)).toBe('Ереван Сити')
  })

  it('must not fire: inside the name it stays — that is another name', () => {
    expect(place('Ереван\u00adСити')).toBe('Ереван\u00adСити')
  })

  it('a name of invisible characters only is still refused', () => {
    expect(() => place('\u2060\u2800')).toThrow()
  })
})

describe('newPlaceSchema: the ends, round two (MOL-21, adversarial round 2)', () => {
  const place = (name: string) =>
    newPlaceSchema.parse({ kind: 'store', name, country: 'AM', city: 'Gyumri' }).name

  it.each([
    ['U+2060 and a line break at the end', 'Ереван Сити⁠\n'],
    ['U+2800 and \\r\\n at the end', 'Ереван Сити⠀\r\n'],
    ['a tab and U+00AD at the start', '\t­Ереван Сити'],
    ['U+3164 and a tab at the end', 'Ереван Ситиㅤ\t'],
  ])('%s — both go, in either order', (_label, name) => {
    expect(place(name)).toBe('Ереван Сити')
  })

  it('keeps what draws the last character: VS16 after an emoji, a flag’s tags', () => {
    expect(place('Кафе ☕️')).toBe('Кафе ☕️')
    expect(place('Сердце ❤️\n')).toBe('Сердце ❤️')
    const scotland = '🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}'
    expect(place(`Паб ${scotland}`)).toBe(`Паб ${scotland}`)
  })

  it('a selector after a letter draws nothing and goes, and so does a dangling joiner', () => {
    expect(place('Ереван Сити️')).toBe('Ереван Сити')
    expect(place('Бар 👨‍')).toBe('Бар 👨')
  })
})
