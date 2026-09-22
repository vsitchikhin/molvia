import { randomBytes, randomUUID } from 'node:crypto'
import type { LoginStarted } from '@molvia/model'
import type { LoginRequestRepository } from '@/db/login-requests-repository'

export interface StartedLogin {
  readonly view: LoginStarted
  readonly secret: string
}

export async function startLogin(
  requests: LoginRequestRepository,
  username: string,
  deviceName: string | null,
): Promise<StartedLogin> {
  const code = randomBytes(32).toString('base64url')
  const secret = randomBytes(32).toString('base64url')
  const request = await requests.createLimited(randomUUID(), code, secret, deviceName)
  return {
    view: {
      id: request.id,
      url: `https://t.me/${username}?start=${code}`,
      expiresAt: request.expiresAt,
    },
    secret,
  }
}
