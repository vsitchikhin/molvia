import { describe, expect, it } from 'vitest'
import { ERROR, actorSchema } from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'
import { getActor } from './get-actor'

const ID = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

function fakeActors(overrides: Partial<ActorRepository> = {}): ActorRepository {
  return {
    create: () => Promise.reject(new Error('create was not expected')),
    byId: () => Promise.reject(new Error('byId was not expected')),
    update: () => Promise.reject(new Error('update was not expected')),
    ...overrides,
  }
}

const actor = actorSchema.parse({
  id: ID,
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  createdAt: new Date('2026-09-16T10:00:00.000Z'),
  updatedAt: new Date('2026-09-16T10:00:00.000Z'),
})

describe('getActor', () => {
  it('returns the actor whose identifier was presented', async () => {
    const actors = fakeActors({ byId: (id) => Promise.resolve(id === ID ? actor : null) })

    await expect(getActor(actors, ID)).resolves.toEqual(actor)
  })

  it('refuses with NO_ACTOR when the identifier matches nothing', async () => {
    const actors = fakeActors({ byId: () => Promise.resolve(null) })

    await expect(getActor(actors, ID)).rejects.toThrow(
      expect.objectContaining({ code: ERROR.NO_ACTOR }),
    )
  })

  it('answers a malformed identifier exactly as it answers an unknown one', async () => {
    // The repository turns a non-uuid into `null` rather than letting Postgres answer 22P02,
    // and the use case must not add a third kind of reply: a difference between «malformed»
    // and «unknown» is how someone else's identifiers get found by comparing answers.
    const actors = fakeActors({ byId: () => Promise.resolve(null) })

    await expect(getActor(actors, 'not-a-uuid')).rejects.toThrow(
      expect.objectContaining({ code: ERROR.NO_ACTOR }),
    )
  })
})
