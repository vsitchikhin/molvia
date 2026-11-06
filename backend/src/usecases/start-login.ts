import { randomBytes, randomUUID } from 'node:crypto'
import { DomainError, ERROR } from '@molvia/model'
import type { LoginRequest, LoginStarted } from '@molvia/model'
import type { LoginRequestRepository } from '@/db/login-requests-repository'
import type { AddressMinute } from './address-minute'

export interface StartedLogin {
  readonly view: LoginStarted
  readonly secret: string
}

/** Whose minute a start counts in (MOL-359): the address's, kept in memory. */
export interface LoginQuota {
  readonly limit: AddressMinute
  readonly address: string
}

/**
 * A start under two quotas (MOL-359): the address's minute first, in memory — a start it turns away
 * takes no lock and writes no request, only its count — then everybody's, in the database under its
 * lock. The memory's minute holds the same three hundred as the bound of its own map, so in one
 * process it is the one that refuses the three hundred and first; the database's is the ceiling that
 * survives a restart and counts every process. **A start that made no request gives its place back**
 * (adversarial А2): refused by everybody's quota, or the database failing — five answers of 500 were
 * a 429 at the sixth tap, with not one link given.
 */
export async function startLogin(
  requests: LoginRequestRepository,
  { limit, address }: LoginQuota,
  username: string,
  deviceName: string | null,
  again = false,
): Promise<StartedLogin> {
  if (!limit(address, 1)) {
    await requests.refuse()
    throw new DomainError(ERROR.LOGIN_RATE_LIMITED)
  }
  const code = randomBytes(32).toString('base64url')
  const secret = randomBytes(32).toString('base64url')
  let request: LoginRequest
  try {
    request = await requests.createLimited(randomUUID(), code, secret, deviceName, again)
  } catch (error) {
    limit.giveBack(address, 1)
    throw error
  }
  return {
    view: {
      id: request.id,
      url: `https://t.me/${username}?start=${code}`,
      expiresAt: request.expiresAt,
    },
    secret,
  }
}
