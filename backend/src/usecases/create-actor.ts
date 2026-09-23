import { randomUUID } from 'node:crypto'
import { newActorSchema } from '@molvia/model'
import type { Actor, NewActor, TelegramUserId } from '@molvia/model'
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
 * The identifier is issued here, not brought by the device: a client that named its own could
 * name someone else's and read their trips whole.
 *
 * The Telegram id comes from the caller rather than from here, because who the person is is
 * not this use case's to know: MOL-54 takes it from a login request the person confirmed in
 * the bot, and until then the development seam mints one (MOL-52, Р-3).
 */
export async function createActor(
  actors: Pick<ActorRepository, 'create'>,
  telegramUserId: TelegramUserId,
): Promise<Actor> {
  return actors.create(randomUUID(), telegramUserId, FIRST_VISIT)
}
