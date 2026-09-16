import { randomUUID } from 'node:crypto'
import { newActorSchema } from '@molvia/model'
import type { Actor, NewActor } from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'

/**
 * Four columns are NOT NULL and 0.1 has no settings screen, so the server names them.
 * The first market is Gyumri and Yerevan (the product plan); the spend currency follows the
 * country a person moved to, and the income currency is the author's — the only user gate
 * 0.1 asks about. MOL-41 gives the screen that changes them; until then nothing else does.
 *
 * Parsed here rather than merely typed: a later edit that breaks the shape should fail when
 * the module loads, not on somebody's first visit.
 */
const FIRST_VISIT: NewActor = Object.freeze(
  newActorSchema.parse({
    country: 'AM',
    city: 'Гюмри',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
  }),
)

/**
 * The identifier is issued here, not brought by the device: it is the only proof of identity
 * this release has, so a client that named its own could name someone else's and read their
 * trips whole.
 */
export async function createActor(actors: ActorRepository): Promise<Actor> {
  return actors.create(randomUUID(), FIRST_VISIT)
}
