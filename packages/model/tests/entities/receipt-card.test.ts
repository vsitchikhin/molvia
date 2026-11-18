import { describe, expect, it } from 'vitest'
import {
  PARSED_FRACTION_DIGITS,
  RECEIPT_CARDS,
  findsAreGuesses,
  modelAlone,
  receiptCard,
} from '#model/entities/receipt-card'
import type { ReceiptWords } from '#model/entities/receipt-card'
import { receiptCountrySchema, receiptSourceOf } from '#model/entities/receipt'
import { parseReceiptText, rowsOf } from '#model/entities/receipt-text'

const countries = receiptCountrySchema.options
const photoCards = countries.flatMap((country) => {
  const photo = receiptCard(country).photo
  return photo === null ? [] : [{ country, photo }]
})

/** Every word of a card, each fragment by its field's name — `letters` are a class's ranges, no fragment. */
function fragments(words: ReceiptWords): [string, string][] {
  return Object.entries(words).flatMap(([field, value]): [string, string][] => {
    if (field === 'letters') return []
    if (typeof value === 'string') return [[field, value]]
    if (Array.isArray(value)) return value.map((one: string) => [field, one])
    return Object.entries(value as Record<string, string>).map(([k, v]) => [`${field}.${k}`, v])
  })
}

describe('a country’s card (MOL-247)', () => {
  it('every country a receipt is read in has its card, and no other', () => {
    expect(Object.keys(RECEIPT_CARDS).sort()).toEqual([...countries].sort())
  })

  it('reads off a photo exactly the countries whose receipts come by photo', () => {
    for (const country of countries) {
      expect(receiptCard(country).photo !== null, country).toBe(
        receiptSourceOf(country) === 'photo',
      )
    }
    // must not: Serbia's receipts come by their link, and the reader is never asked of them
    expect(receiptCard('RS').photo).toBeNull()
  })

  it('Armenia keeps what the product read before the card', () => {
    expect(receiptCard('AM')).toMatchObject({ currency: 'AMD', nameLanguage: 'hy' })
    expect(receiptCard('AM').photo?.languages).toBe('hye+rus+eng')
    expect(receiptCard('RS')).toEqual({ currency: 'RSD', nameLanguage: null, photo: null })
  })

  it('Georgia is read by the model alone, in lari, with no names of its own in the catalogue (MOL-408)', () => {
    expect(receiptCard('GE')).toMatchObject({ currency: 'GEL', nameLanguage: null })
    expect(receiptCard('GE').photo).toMatchObject({ languages: null, tinDigits: [9, 11] })
    // must not: no swap of the model's until the bench measures one
    expect(receiptCard('GE').photo?.modelSwaps).toEqual({})
    expect(receiptCard('AM').photo?.tinDigits).toEqual([8])
  })

  it('says which country the model alone reads: Georgia, never Armenia nor a country read by its link', () => {
    expect(countries.filter(modelAlone)).toEqual(['GE'])
    // must not: Serbia has no photo to read, so no reader of one
    expect(modelAlone('RS')).toBe(false)
  })

  it('takes every find of a line as a guess only off a photo in a language the catalogue names nothing in', () => {
    expect(findsAreGuesses(receiptCard('GE'))).toBe(true)
    expect(findsAreGuesses(receiptCard('RS'))).toBe(false)
    expect(findsAreGuesses(receiptCard('AM'))).toBe(false)
  })

  it('names only formats of numbers the parse reads', () => {
    for (const { country, photo } of photoCards) {
      expect(photo.numbers.length, country).toBeGreaterThan(0)
      for (const format of photo.numbers) {
        expect(PARSED_FRACTION_DIGITS, country).toContain(format.fractionDigits)
      }
    }
  })

  it('swaps a digit for a digit, and back', () => {
    for (const { country, photo } of photoCards) {
      for (const [from, to] of Object.entries(photo.swaps)) {
        expect(`${from}${to}`, country).toMatch(/^\d\d$/)
        expect(photo.swaps[to], `${country}: ${from}↔${to}`).toBe(from)
      }
      for (const [letter, digit] of Object.entries(photo.digitLike)) {
        expect(letter, country).toMatch(/^\D$/u)
        expect(digit, country).toMatch(/^\d$/)
      }
    }
  })

  it('every word is a fragment that captures nothing and never finds an empty word', () => {
    for (const { country, photo } of photoCards) {
      for (const [field, fragment] of fragments(photo.words)) {
        const name = `${country}.${field} «${fragment}»`
        // a fragment that matches nothing at all would find a word in every row
        expect(new RegExp(`(?:${fragment})`, 'u').test(''), name).toBe(false)
        // a group of its own would move the figures the parse reads after the word (adversarial А1)
        expect(new RegExp(`(?:${fragment})|`, 'u').exec('')?.length, name).toBe(1)
      }
    }
  })

  it('every card builds the parse’s patterns, its letters’ ranges and its digit-like letters too', () => {
    for (const { country, photo } of photoCards) {
      expect(
        () => parseReceiptText(photo, rowsOf('1. —\n0401/1163909 1 1,00/0,00 1', 0)),
        country,
      ).not.toThrow()
    }
  })
})
