import { describe, expect, it } from 'vitest'
import {
  actorPatchSchema,
  actorSchema,
  newActorSchema,
  telegramUserIdSchema,
} from '#model/entities/actor'

const actor = {
  id: '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01',
  telegramUserId: 777_000_123,
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

describe('telegramUserIdSchema', () => {
  it('takes the id Telegram issues today, and the largest one it promised never to exceed', () => {
    // 2^53 − 1. The promise is what makes `number` safe here and `bigint` unnecessary — and
    // it is the same bound `actors_telegram_user_id_safe` holds in the database.
    expect(telegramUserIdSchema.parse(777_000_123)).toBe(777_000_123)
    expect(telegramUserIdSchema.parse(9_007_199_254_740_991)).toBe(9_007_199_254_740_991)
  })

  it('refuses 2^53 itself, where a number stops being able to tell itself from its neighbour', () => {
    expect(() => telegramUserIdSchema.parse(9_007_199_254_740_992)).toThrow()
  })

  it('refuses what is not an account: zero, a negative, a fraction, a string', () => {
    for (const value of [0, -1, -777_000_123, 1.5, '777000123', null]) {
      expect(() => telegramUserIdSchema.parse(value)).toThrow()
    }
  })

  it('is required on the entity: an owner nobody can come back to is not one', () => {
    const without: Record<string, unknown> = { ...actor }
    delete without.telegramUserId

    expect(() => actorSchema.parse(without)).toThrow()
  })
})

describe('newActorSchema', () => {
  const settings = {
    country: 'AM' as const,
    city: 'Гюмри',
    spendCurrency: 'AMD' as const,
    incomeCurrency: 'RUB' as const,
  }

  it('takes the four settings a person arrives with', () => {
    expect(newActorSchema.parse(settings)).toEqual(settings)
  })

  it('has no place for an id — the device brings it, the server writes it', () => {
    expect(() => newActorSchema.parse({ ...settings, id: actor.id })).toThrow()
  })

  it('refuses the timestamps the server owns', () => {
    expect(() => newActorSchema.parse({ ...settings, createdAt: new Date() })).toThrow()
    expect(() => newActorSchema.parse({ ...settings, updatedAt: new Date() })).toThrow()
  })

  it('refuses a half-filled screen: all four travel together or none do', () => {
    for (const missing of ['country', 'city', 'spendCurrency', 'incomeCurrency'] as const) {
      const partial = Object.fromEntries(
        Object.entries(settings).filter(([field]) => field !== missing),
      )
      expect(() => newActorSchema.parse(partial)).toThrow()
    }
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
      { telegramUserId: 42 },
      { createdAt: new Date() },
      { updatedAt: new Date() },
    ]) {
      expect(() => actorPatchSchema.parse({ city: 'Ереван', ...smuggled })).toThrow()
    }
  })
})
