import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { actorCodec, actorWireSchema } from '#model/contracts/actor'
import type { ActorWire } from '#model/contracts/actor'
import { actorSchema } from '#model/entities/actor'

const actor = {
  id: '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f',
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  sharedUntil: null,
  createdAt: new Date('2026-09-16T10:00:00.123Z'),
  updatedAt: new Date('2026-09-16T10:00:00.456Z'),
}

describe('actorCodec', () => {
  it('carries the entity over a wire that has no Date of its own', () => {
    const value = actorSchema.parse(actor)
    const wire = z.encode(actorCodec, value)

    expect(wire).toEqual({
      id: '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f',
      country: 'AM',
      city: 'Гюмри',
      spendCurrency: 'AMD',
      incomeCurrency: 'RUB',
      sharedUntil: null,
      createdAt: '2026-09-16T10:00:00.123Z',
      updatedAt: '2026-09-16T10:00:00.456Z',
    })
    expect(actorCodec.parse(JSON.parse(JSON.stringify(wire)))).toEqual(value)
  })

  it('keeps the two timestamps apart to the millisecond', () => {
    // The gap between them is what tells «settings were edited» from «never touched», and
    // the trigger that moves updated_at works in microseconds. A codec that rounded either
    // one would erase the difference on the way out, silently and only sometimes.
    const value = actorSchema.parse(actor)
    const back = actorCodec.parse(JSON.parse(JSON.stringify(z.encode(actorCodec, value))))

    expect(back.updatedAt.getTime() - back.createdAt.getTime()).toBe(333)
  })

  it('refuses a date that is not ISO rather than coercing it', () => {
    const wire = { ...z.encode(actorCodec, actorSchema.parse(actor)), createdAt: '16.09.2026' }

    expect(() => actorCodec.parse(wire)).toThrow()
  })

  it('refuses a wire that drops a field or invents a currency', () => {
    const wire = z.encode(actorCodec, actorSchema.parse(actor))
    const withoutCity: Partial<ActorWire> = { ...wire }
    delete withoutCity.city

    expect(actorWireSchema.safeParse(withoutCity).success).toBe(false)
    // GEL is in the Google Sheet the project grew out of and deliberately not in the schema:
    // a fifth currency is a migration plus four CHECK constraints, not a wire concern.
    expect(actorCodec.safeParse({ ...wire, spendCurrency: 'GEL' }).success).toBe(false)
  })

  it('carries a granted access over the wire, and an empty one as null', () => {
    const granted = actorSchema.parse({ ...actor, sharedUntil: new Date('2026-10-20T00:00:00Z') })
    const wire = z.encode(actorCodec, granted)

    expect(wire.sharedUntil).toBe('2026-10-20T00:00:00.000Z')
    expect(actorCodec.parse(JSON.parse(JSON.stringify(wire)))).toEqual(granted)
    // `undefined` is not `null`: a wire that simply left the field out would read as «no
    // access» while meaning «the server forgot to say», and the two must not collapse.
    expect(actorCodec.safeParse({ ...wire, sharedUntil: undefined }).success).toBe(false)
  })
})
