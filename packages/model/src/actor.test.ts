import { describe, expect, it } from 'vitest'
import { actorPatchSchema, actorSchema } from './actor'

const actor = {
  id: '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01',
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  createdAt: new Date('2026-09-08T10:00:00Z'),
  updatedAt: new Date('2026-09-08T10:00:00Z'),
}

describe('actorSchema', () => {
  it('accepts the shape the server builds on first contact', () => {
    expect(actorSchema.parse(actor).city).toBe('Гюмри')
  })

  it('allows spending and earning in the same currency — there is nothing to convert', () => {
    expect(() =>
      actorSchema.parse({ ...actor, spendCurrency: 'RUB', incomeCurrency: 'RUB' }),
    ).not.toThrow()
  })

  it('rejects a country that is not ISO 3166-1 alpha-2', () => {
    for (const country of ['ARM', 'A', 'am', '12', '']) {
      expect(() => actorSchema.parse({ ...actor, country })).toThrow()
    }
  })

  it('rejects an empty city rather than storing a blank one', () => {
    expect(() => actorSchema.parse({ ...actor, city: '   ' })).toThrow()
  })
})

describe('actorPatchSchema', () => {
  it('takes a single field', () => {
    expect(actorPatchSchema.parse({ city: 'Ереван' })).toEqual({ city: 'Ереван' })
  })

  it('takes the pair a move changes at once', () => {
    const patch = { country: 'GE', spendCurrency: 'RUB' as const }
    expect(actorPatchSchema.parse(patch)).toEqual(patch)
  })

  it('refuses an empty patch, which would only bump updatedAt', () => {
    expect(() => actorPatchSchema.parse({})).toThrow()
  })

  it('refuses a patch whose only field is an explicit undefined', () => {
    // `{ city: form.city }` from an unfilled form. Unreachable from JSON, ordinary from
    // the bot and the PWA, and it bumped updatedAt exactly as an empty patch would.
    expect(() => actorPatchSchema.parse({ city: undefined })).toThrow()
    expect(() => actorPatchSchema.parse({ country: undefined, city: undefined })).toThrow()
  })

  it('caps the city the same way a place does — one city, one width', () => {
    expect(() => actorSchema.parse({ ...actor, city: 'а'.repeat(121) })).toThrow()
  })

  it('refuses fields the server owns, so a client cannot smuggle them in', () => {
    for (const smuggled of [
      { id: actor.id },
      { createdAt: new Date() },
      { updatedAt: new Date() },
    ]) {
      expect(() => actorPatchSchema.parse({ city: 'Ереван', ...smuggled })).toThrow()
    }
  })
})
