import { describe, expect, it } from 'vitest'
import { PARSED_FRACTION_DIGITS, RECEIPT_CARDS, receiptCard } from '#model/entities/receipt-card'
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

  it('names only formats of numbers the parse reads', () => {
    for (const { country, photo } of photoCards) {
      expect(photo.numbers.length, country).toBeGreaterThan(0)
      for (const format of photo.numbers) {
        expect(PARSED_FRACTION_DIGITS, country).toContain(format.fractionDigits)
      }
    }
  })

  // the phone knows no reader and doubts by Tesseract's pairs: the server narrows by the model's only while they are
  // among them, or the phone would hide a hint the server sent (MOL-315)
  it('confuses no pair as the model that Tesseract does not', () => {
    for (const { country, photo } of photoCards) {
      for (const [from, to] of Object.entries(photo.modelSwaps)) {
        expect(photo.swaps[from], `${country}: ${from}↔${to}`).toBe(to)
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
