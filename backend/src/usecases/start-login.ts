import { randomBytes, randomUUID } from 'node:crypto'
import { DomainError, ERROR } from '@molvia/model'
import type { LoginStarted } from '@molvia/model'
import type { LoginRequestRepository } from '@/db/login-requests-repository'
import type { AddressMinute } from './address-minute'

export interface StartedLogin {
  readonly view: LoginStarted
  readonly secret: string
}

/** Whose minute a start counts in (MOL-359): the address's, kept in memory, and the moment. */
export interface LoginQuota {
  readonly limit: AddressMinute
  readonly address: string
  readonly now: number
}

/**
 * A start under two quotas (MOL-359): the address's minute first, in memory — a start it turns away
 * takes no lock and writes no request, only its count — then everybody's, in the database under its
 * lock. A start that passed the address and that the database refused keeps its place in the minute.
 */
export async function startLogin(
  requests: LoginRequestRepository,
  { limit, address, now }: LoginQuota,
  username: string,
  deviceName: string | null,
  again = false,
): Promise<StartedLogin> {
  if (!limit(address, 1, now)) {
    await requests.refuse()
    throw new DomainError(ERROR.LOGIN_RATE_LIMITED)
  }
  const code = randomBytes(32).toString('base64url')
  const secret = randomBytes(32).toString('base64url')
  const request = await requests.createLimited(randomUUID(), code, secret, deviceName, again)
  return {
    view: {
      id: request.id,
      url: `https://t.me/${username}?start=${code}`,
      expiresAt: request.expiresAt,
    },
    secret,
  }
}
