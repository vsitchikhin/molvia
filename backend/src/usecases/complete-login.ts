import { DomainError, ERROR } from '@molvia/model'
import type { AuthTransact } from '@/db/auth-unit-of-work'
import { signIn } from './sign-in'
import type { SignedIn } from './sign-in'

export type CompletedLogin =
  | { readonly status: 'pending'; readonly expiresAt: Date }
  | { readonly status: 'authenticated'; readonly signedIn: SignedIn }

export async function completeLogin(
  transact: AuthTransact,
  id: string,
  secret: string,
): Promise<CompletedLogin> {
  return transact(async ({ actors, sessions, requests }) => {
    // The account's lock before the request's row, the order erasure takes them in (MOL-58,
    // adversarial Р-1): making the owner takes the account's lock, and taken only then — with
    // the row already held — a collection and an erasure could each wait on the other. The
    // account is read off the row before it is locked, so it is checked again after.
    const seen = await requests.byIdAndSecret(id, secret)
    if (seen?.telegramUserId != null) await actors.lockAccount(seen.telegramUserId)
    await requests.lock(id, secret)
    const request = await requests.byIdAndSecret(id, secret)
    if (!request) throw new DomainError(ERROR.LOGIN_UNAVAILABLE)
    // Confirmed between the two reads: its account is not locked yet, and the next poll — a
    // second or two away — collects it in the right order.
    if (request.telegramUserId === null || request.telegramUserId !== seen?.telegramUserId) {
      return { status: 'pending', expiresAt: request.expiresAt }
    }
    const consumed = await requests.consume(id, secret)
    if (consumed?.telegramUserId === null || consumed === null) {
      throw new DomainError(ERROR.LOGIN_UNAVAILABLE)
    }
    const signedIn = await signIn(actors, sessions, consumed.telegramUserId, consumed.deviceName)
    return { status: 'authenticated', signedIn }
  })
}
