import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { actorCodec, actorViewSchema, actorWireSchema } from '#model/contracts/actor'
import type { ActorWire } from '#model/contracts/actor'
import { actorSchema } from '#model/entities/actor'

const actor = {
  id: '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f',
  telegramUserId: 777_000_123,
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
    const value = actorViewSchema.parse(actorSchema.parse(actor))
    const wire = z.encode(actorCodec, value)

    expect(wire).toEqual({
      id: '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f',
      country: 'AM',
      city: 'Гюмри',
      spendCurrency: 'AMD',
      incomeCurrency: 'RUB',
      createdAt: '2026-09-16T10:00:00.123Z',
      updatedAt: '2026-09-16T10:00:00.456Z',
    })
    expect(actorCodec.parse(JSON.parse(JSON.stringify(wire)))).toEqual(value)
  })

  it('leaves the Telegram id behind, and refuses a reply that grew it back', () => {
    // Only the numeric id is *stored*; it is not shown (MOL-52, Р-11). The wire is an
    // `.extend` of the entity, so without the omit the field would have travelled in silence.
    // Strict on both sides for the same reason `catalogueEntryCodec` is: a reply that grew a
    // field fails to parse rather than sliding past a client that never reads it.
    const wire = z.encode(actorCodec, actorViewSchema.parse(actorSchema.parse(actor)))

    expect(wire).not.toHaveProperty('telegramUserId')
    expect(actorWireSchema.safeParse({ ...wire, telegramUserId: 777_000_123 }).success).toBe(false)
    expect(actorCodec.safeParse({ ...wire, telegramUserId: 777_000_123 }).success).toBe(false)
  })

  it('names what it sends, so tomorrow\u2019s field stays on the server by default', () => {
    // The safeguard is that the view is an allowlist. Written by subtraction it protected
    // against exactly one field — the one already known about — and the *next* field added to
    // `Actor` would have joined the view, and then the wire, without a line of the contract
    // changing (adversarial Б2). Checked against the shipped schema rather than a copy of its
    // shape: a copy would go on passing after the real one was rewritten.
    const sent = Object.keys(actorViewSchema.shape)

    expect(sent).not.toContain('telegramUserId')
    expect(sent.sort()).toEqual([
      'city',
      'country',
      'createdAt',
      'id',
      'incomeCurrency',
      'spendCurrency',
      'updatedAt',
    ])
    // And the entity really is the wider of the two — otherwise the list above would be
    // agreeing with nothing.
    expect(Object.keys(actorSchema.shape)).toContain('telegramUserId')
  })

  it('keeps the two timestamps apart to the millisecond', () => {
    // The gap between them is what tells «settings were edited» from «never touched», and
    // the trigger that moves updated_at works in microseconds. A codec that rounded either
    // one would erase the difference on the way out, silently and only sometimes.
    const value = actorViewSchema.parse(actorSchema.parse(actor))
    const back = actorCodec.parse(JSON.parse(JSON.stringify(z.encode(actorCodec, value))))

    expect(back.updatedAt.getTime() - back.createdAt.getTime()).toBe(333)
  })

  it('refuses a date that is not ISO rather than coercing it', () => {
    const wire = {
      ...z.encode(actorCodec, actorViewSchema.parse(actorSchema.parse(actor))),
      createdAt: '16.09.2026',
    }

    expect(() => actorCodec.parse(wire)).toThrow()
  })

  it('refuses a wire that drops a field or invents a currency', () => {
    const wire = z.encode(actorCodec, actorViewSchema.parse(actorSchema.parse(actor)))
    const withoutCity: Partial<ActorWire> = { ...wire }
    delete withoutCity.city

    expect(actorWireSchema.safeParse(withoutCity).success).toBe(false)
    // GEL is in the Google Sheet the project grew out of and deliberately not in the schema:
    // a fifth currency is a migration plus four CHECK constraints, not a wire concern.
    expect(actorCodec.safeParse({ ...wire, spendCurrency: 'GEL' }).success).toBe(false)
  })

  it('keeps the granted access on the server — the allowlist never named it', () => {
    // `sharedUntil` is the person's own, but no screen of 0.1 reads it, and the view is an
    // allowlist: what a screen acts on — whose figures it is shown — travels with the answer
    // that carries them, as `scope` (MOL-31, Р-9).
    const granted = actorSchema.parse({ ...actor, sharedUntil: new Date('2026-10-20T00:00:00Z') })
    const wire = z.encode(actorCodec, granted)

    expect(wire).not.toHaveProperty('sharedUntil')
    expect(actorWireSchema.safeParse({ ...wire, sharedUntil: null }).success).toBe(false)
  })
})
