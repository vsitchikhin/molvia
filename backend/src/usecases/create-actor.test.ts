import { describe, expect, it } from 'vitest'
import { actorSchema } from '@molvia/model'
import type { Actor, NewActor } from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'
import { createActor } from './create-actor'

// A method nobody expected to be called fails loudly instead of returning undefined: a use
// case that quietly reached the wrong one would otherwise pass its own test.
function fakeActors(overrides: Partial<ActorRepository> = {}): ActorRepository {
  return {
    create: () => Promise.reject(new Error('create was not expected')),
    createIfMissing: () => Promise.reject(new Error('createIfMissing was not expected')),
    byId: () => Promise.reject(new Error('byId was not expected')),
    byTelegramUserId: () => Promise.reject(new Error('byTelegramUserId was not expected')),
    update: () => Promise.reject(new Error('update was not expected')),
    lockAccount: () => Promise.reject(new Error('lockAccount was not expected')),
    ...overrides,
  }
}

/** Any positive number inside 2^53 will do; the use case does not choose it (MOL-52). */
const TELEGRAM_ID = 777_000_123

function actorFrom(id: string, telegramUserId: number, input: NewActor): Actor {
  return actorSchema.parse({
    id,
    telegramUserId,
    ...input,
    sharedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

describe('createActor', () => {
  it('writes the four settings a first visit starts with', async () => {
    let written: NewActor | undefined
    const actors = fakeActors({
      create: (id, telegramUserId, input) => {
        written = input
        return Promise.resolve(actorFrom(id, telegramUserId, input))
      },
    })

    const actor = await createActor(actors, TELEGRAM_ID)

    expect(written).toEqual({
      country: 'AM',
      city: 'Гюмри',
      spendCurrency: 'AMD',
      incomeCurrency: 'RUB',
    })
    expect(actor.spendCurrency).toBe('AMD')
  })

  it('issues the identifier itself, and a different one every time', async () => {
    // The device never names it: this is the only proof of identity in 0.1, so a client
    // that chose its own could choose someone else's.
    const seen: string[] = []
    const actors = fakeActors({
      create: (id, telegramUserId, input) => {
        seen.push(id)
        return Promise.resolve(actorFrom(id, telegramUserId, input))
      },
    })

    await createActor(actors, TELEGRAM_ID)
    await createActor(actors, TELEGRAM_ID)

    expect(seen[0]).not.toBe(seen[1])
    expect(seen[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('hands back what the repository wrote, not what it was asked to write', async () => {
    // created_at and updated_at belong to the database, and the entity only exists once a
    // row does — so the use case returns the row rather than assembling an answer.
    const actors = fakeActors({
      create: (id, telegramUserId, input) => Promise.resolve(actorFrom(id, telegramUserId, input)),
    })

    const actor = await createActor(actors, TELEGRAM_ID)

    expect(actor.createdAt).toBeInstanceOf(Date)
    expect(() => actorSchema.parse(actor)).not.toThrow()
  })
})
