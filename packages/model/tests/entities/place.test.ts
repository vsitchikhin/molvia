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
    ['U+2060 and a line break at the end', 'Ереван Сити\u2060\n'],
    ['U+2800 and \\r\\n at the end', 'Ереван Сити\u2800\r\n'],
    ['a tab and U+00AD at the start', '\t\u00adЕреван Сити'],
    ['U+3164 and a tab at the end', 'Ереван Сити\u3164\t'],
  ])('%s — both go, in either order', (_label, name) => {
    expect(place(name)).toBe('Ереван Сити')
  })

  it('keeps what draws the last character: VS16 after an emoji, a flag’s tags', () => {
    expect(place('Кафе ☕\ufe0f')).toBe('Кафе ☕\ufe0f')
    expect(place('Сердце ❤\ufe0f\n')).toBe('Сердце ❤\ufe0f')
    const scotland = '🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}'
    expect(place(`Паб ${scotland}`)).toBe(`Паб ${scotland}`)
  })

  it('a selector after a letter draws nothing and goes, and so does a dangling joiner', () => {
    expect(place('Ереван Сити\ufe0f')).toBe('Ереван Сити')
    expect(place('Бар 👨\u200d')).toBe('Бар 👨')
  })
})

describe('newPlaceSchema: the ends, round three (MOL-21, adversarial round 3)', () => {
  const parse = (name: string) =>
    newPlaceSchema.safeParse({ kind: 'store', name, country: 'AM', city: 'Gyumri' })
  const scotland = '🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}'

  it('А: a megabyte of tags is refused before any trimming, and fast', () => {
    const started = performance.now()
    expect(parse(`Рынок${'\u{e0020}'.repeat(260_000)}`).success).toBe(false)
    expect(performance.now() - started).toBeLessThan(200)
  })

  it('boundary: twice the limit is let in to be trimmed, one more is not', () => {
    const name = `Рынок${' '.repeat(395)}`
    expect(parse(name).success).toBe(true)
    expect(parse(`${name} `).success).toBe(false)
  })

  it('В: tags after 🏴 that spell no flag go whole', () => {
    expect(parse(`Паб 🏴${'\u{e0020}'.repeat(3)}`).data?.name).toBe('Паб 🏴')
    expect(parse('Паб 🏴\u{e007f}').data?.name).toBe('Паб 🏴')
    expect(parse(`Паб ${scotland}\u{e0020}`).data?.name).toBe('Паб 🏴')
  })

  it('must not fire: a real flag stays', () => {
    expect(parse(`Паб ${scotland}`).data?.name).toBe(`Паб ${scotland}`)
  })
})

describe('newPlaceSchema: only drawn flags keep their tags (MOL-21, adversarial round 4, Б)', () => {
  const name = (text: string) =>
    newPlaceSchema.parse({ kind: 'store', name: text, country: 'AM', city: 'Gyumri' }).name
  const BLACK_FLAG = String.fromCodePoint(0x1f3f4)
  const tags = (letters: string) =>
    Array.from(letters)
      .map((letter) => String.fromCodePoint(0xe0000 + (letter.codePointAt(0) ?? 0)))
      .join('') + String.fromCodePoint(0xe007f)

  it.each(['gbeng', 'gbsct', 'gbwls'])('%s — a flag that is drawn — stays', (letters) => {
    expect(name(`Паб ${BLACK_FLAG}${tags(letters)}`)).toBe(`Паб ${BLACK_FLAG}${tags(letters)}`)
  })

  it.each(['zz', '99', 'a', 'gbsctx', ''])(
    'tags of the right shape spelling «%s» — no flag, the same black 🏴 — go',
    (letters) => {
      expect(name(`Паб ${BLACK_FLAG}${tags(letters)}`)).toBe(`Паб ${BLACK_FLAG}`)
    },
  )
})
