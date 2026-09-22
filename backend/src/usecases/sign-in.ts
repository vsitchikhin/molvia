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

/**
 * Someone proving they are a given Telegram account, and getting a session on this device for
 * it (MOL-53).
 *
 * **Find or create, not create.** A second login from the same account is the ordinary case —
 * a new phone, a browser that lost its cookie — and it has to end in the *same* owner with all
 * their trips behind it. Creating would answer CONFLICT on the unique column and leave the
 * person with nothing to do about it.
 *
 * Who the person is, this use case does not decide: the caller brings the Telegram id. Today
 * that caller is the development seam, which invents one; MOL-54 takes it from a login request
 * the person confirmed with a button in the bot, and calls this same function.
 *
 * `deviceName` is deliberately `null` here. The name a person recognises — «iPhone · Safari» —
 * is shown by the bot before the session exists and listed by MOL-57 afterwards, so it is
 * derived where it is shown; guessing it here from a `User-Agent` would be work to be redone.
 */
export async function signIn(
  actors: ActorRepository,
  sessions: SessionRepository,
  telegramUserId: TelegramUserId,
): Promise<SignedIn> {
  const actor =
    (await actors.byTelegramUserId(telegramUserId)) ?? (await createActor(actors, telegramUserId))

  const token = mintToken()
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_DAYS * 24 * 3_600_000)
  await sessions.create(randomUUID(), actor.id, token, null, expiresAt)

  return { actor, token, expiresAt }
}
