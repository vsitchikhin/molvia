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
    await requests.lock(id, secret)
    const request = await requests.byIdAndSecret(id, secret)
    if (!request) throw new DomainError(ERROR.LOGIN_UNAVAILABLE)
    if (request.telegramUserId === null) {
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
