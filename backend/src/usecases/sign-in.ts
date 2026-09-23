import { randomBytes, randomUUID } from 'node:crypto'
import { SESSION_LIFETIME_DAYS } from '@molvia/model'
import type { Actor, TelegramUserId } from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'
import type { SessionRepository } from '@/db/sessions-repository'
import { createActor } from '@/usecases/create-actor'

export interface SignedIn {
  readonly actor: Actor
  /** The only moment the token exists outside the browser: it goes into the cookie and nowhere
   * else. The database has its `sha256` and never had this. */
  readonly token: string
  readonly expiresAt: Date
}

/**
 * 32 bytes, base64url — 43 characters of the alphabet `secretOrNull` accepts and the cookie can
 * carry without escaping. 256 bits of randomness is why the digest beside it is a plain sha256:
 * there is no dictionary to make expensive (MOL-52, Р-5).
 */
function mintToken(): string {
  return randomBytes(32).toString('base64url')
}

/** The caller proves the Telegram identity; defaults remain owned by createActor. */
export async function signIn(
  actors: ActorRepository,
  sessions: SessionRepository,
  telegramUserId: TelegramUserId,
  deviceName: string | null = null,
): Promise<SignedIn> {
  const actor =
    (await actors.byTelegramUserId(telegramUserId)) ??
    (await createActor(
      { create: (id, telegramId, input) => actors.createIfMissing(id, telegramId, input) },
      telegramUserId,
    ))

  const token = mintToken()
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_DAYS * 24 * 3_600_000)
  await sessions.create(randomUUID(), actor.id, token, deviceName, expiresAt)

  return { actor, token, expiresAt }
}
