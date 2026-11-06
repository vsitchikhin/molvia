import { describe, expect, it } from 'vitest'
import { DomainError, ERROR, LOGIN_ADDRESS_LIMIT, LOGIN_WINDOW_LIMIT } from '@molvia/model'
import type { LoginRequest } from '@molvia/model'
import type { LoginRequestRepository } from '@/db/login-requests-repository'
import { addressMinute } from './address-minute'
import { startLogin } from './start-login'

const ADDRESS = '203.0.113.5'

/** A repository whose start answers as `answer` says; how many refusals of an address it counted. */
function repository(answer: { current: 'ok' | 'down' | 'full' }) {
  const counted = { refused: 0, created: 0 }
  const requests: Pick<LoginRequestRepository, 'refuse' | 'createLimited'> = {
    refuse: () => {
      counted.refused += 1
      return Promise.resolve()
    },
    createLimited: (id, code) => {
      if (answer.current === 'down') return Promise.reject(new Error('connect ECONNREFUSED'))
      if (answer.current === 'full') {
        return Promise.reject(new DomainError(ERROR.LOGIN_RATE_LIMITED))
      }
      counted.created += 1
      const now = new Date()
      const request: LoginRequest = {
        id,
        code,
        deviceName: null,
        telegramUserId: null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 300_000),
        consumedAt: null,
      }
      return Promise.resolve(request)
    },
  }
  return { requests: requests as LoginRequestRepository, counted }
}

describe('startLogin — the place of a start in the minute of its address (MOL-359)', () => {
  it('five starts the database failed leave the address all five (adversarial А2)', async () => {
    const answer: { current: 'ok' | 'down' | 'full' } = { current: 'down' }
    const { requests, counted } = repository(answer)
    const quota = {
      limit: addressMinute(LOGIN_ADDRESS_LIMIT, LOGIN_WINDOW_LIMIT),
      address: ADDRESS,
    }
    for (let i = 0; i < LOGIN_ADDRESS_LIMIT; i += 1) {
      await expect(startLogin(requests, quota, 'molvia_bot', null)).rejects.toThrow('ECONNREFUSED')
    }
    answer.current = 'ok'
    for (let i = 0; i < LOGIN_ADDRESS_LIMIT; i += 1) {
      await expect(startLogin(requests, quota, 'molvia_bot', null)).resolves.toBeTruthy()
    }
    expect(counted).toEqual({ refused: 0, created: LOGIN_ADDRESS_LIMIT })
  })

  it('five starts refused by everybody keep their places: the sixth is refused by the address (review №5)', async () => {
    const answer: { current: 'ok' | 'down' | 'full' } = { current: 'full' }
    const { requests, counted } = repository(answer)
    const quota = {
      limit: addressMinute(LOGIN_ADDRESS_LIMIT, LOGIN_WINDOW_LIMIT),
      address: ADDRESS,
    }
    for (let i = 0; i < LOGIN_ADDRESS_LIMIT; i += 1) {
      await expect(startLogin(requests, quota, 'molvia_bot', null)).rejects.toMatchObject({
        code: ERROR.LOGIN_RATE_LIMITED,
      })
    }
    answer.current = 'ok'
    await expect(startLogin(requests, quota, 'molvia_bot', null)).rejects.toMatchObject({
      code: ERROR.LOGIN_RATE_LIMITED,
    })
    expect(counted).toEqual({ refused: 1, created: 0 })
  })

  it('a start that made one keeps its place: the sixth is refused by the address, and counted', async () => {
    const { requests, counted } = repository({ current: 'ok' })
    const quota = {
      limit: addressMinute(LOGIN_ADDRESS_LIMIT, LOGIN_WINDOW_LIMIT),
      address: ADDRESS,
    }
    for (let i = 0; i < LOGIN_ADDRESS_LIMIT; i += 1) {
      await startLogin(requests, quota, 'molvia_bot', null)
    }
    await expect(startLogin(requests, quota, 'molvia_bot', null)).rejects.toMatchObject({
      code: ERROR.LOGIN_RATE_LIMITED,
    })
    expect(counted).toEqual({ refused: 1, created: LOGIN_ADDRESS_LIMIT })
  })
})
