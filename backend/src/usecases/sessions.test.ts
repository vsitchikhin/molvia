import { describe, expect, it, vi } from 'vitest'
import { ERROR, SESSIONS_LIMIT, sessionSchema } from '@molvia/model'
import type { SessionRepository } from '@/db/sessions-repository'
import { endSession, listSessions, logout } from './sessions'

const ACTOR_ID = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const CURRENT = 'b1b1b1b1-1111-4111-8111-111111111111'
const OTHER = 'c2c2c2c2-2222-4222-8222-222222222222'
const TOKEN = 'Zm9vYmFyLXRva2VuLTMyLWJ5dGVzLWJhc2U2NHVybA'

function session(id: string, deviceName: string | null) {
  return sessionSchema.parse({
    id,
    actorId: ACTOR_ID,
    deviceName,
    createdAt: new Date('2026-09-16T10:00:00.000Z'),
    lastSeenAt: new Date('2026-09-20T10:00:00.000Z'),
    expiresAt: new Date(Date.now() + 3_600_000),
  })
}

function fakeSessions(overrides: Partial<SessionRepository> = {}): SessionRepository {
  return {
    create: () => Promise.reject(new Error('create was not expected')),
    liveByToken: () => Promise.reject(new Error('liveByToken was not expected')),
    touch: () => Promise.reject(new Error('touch was not expected')),
    listFor: () => Promise.reject(new Error('listFor was not expected')),
    removeFor: () => Promise.reject(new Error('removeFor was not expected')),
    removeByToken: () => Promise.reject(new Error('removeByToken was not expected')),
    removeExpired: () => Promise.reject(new Error('removeExpired was not expected')),
    ...overrides,
  }
}

describe('список устройств', () => {
  it('помечает текущей ровно ту сессию, с которой пришёл запрос', async () => {
    const listFor = vi.fn(() =>
      Promise.resolve({
        sessions: [session(CURRENT, 'iPhone · Safari'), session(OTHER, null)],
        total: 2,
      }),
    )

    const list = await listSessions(fakeSessions({ listFor }), ACTOR_ID, CURRENT)

    expect(listFor).toHaveBeenCalledWith(ACTOR_ID, CURRENT, SESSIONS_LIMIT)
    expect(list.total).toBe(2)
    expect(
      list.sessions.map(({ id, current, deviceName }) => ({ id, current, deviceName })),
    ).toEqual([
      { id: CURRENT, current: true, deviceName: 'iPhone · Safari' },
      { id: OTHER, current: false, deviceName: null },
    ])
  })

  it('не отдаёт наружу ни срока, ни владельца', async () => {
    const listFor = () => Promise.resolve({ sessions: [session(CURRENT, null)], total: 1 })
    const [row] = (await listSessions(fakeSessions({ listFor }), ACTOR_ID, CURRENT)).sessions
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'createdAt',
      'current',
      'deviceName',
      'id',
      'lastSeenAt',
    ])
  })
})

describe('завершить сессию', () => {
  it('чужую или несуществующую — NOT_FOUND, как и было обещано (IDOR)', async () => {
    const sessions = fakeSessions({ removeFor: () => Promise.resolve(false) })
    await expect(endSession(sessions, ACTOR_ID, CURRENT, OTHER)).rejects.toMatchObject({
      code: ERROR.NOT_FOUND,
    })
  })

  it('другую свою — без снятия cookie', async () => {
    const removeFor = vi.fn(() => Promise.resolve(true))
    await expect(
      endSession(fakeSessions({ removeFor }), ACTOR_ID, CURRENT, OTHER),
    ).resolves.toEqual({
      endedCurrent: false,
    })
    expect(removeFor).toHaveBeenCalledWith(ACTOR_ID, OTHER)
  })

  it('текущую — это выход, в любом регистре адреса', async () => {
    const sessions = fakeSessions({ removeFor: () => Promise.resolve(true) })
    await expect(endSession(sessions, ACTOR_ID, CURRENT, CURRENT.toUpperCase())).resolves.toEqual({
      endedCurrent: true,
    })
  })
})

describe('выход', () => {
  it('удаляет по токену и не спорит, если сессии уже нет', async () => {
    const removeByToken = vi.fn(() => Promise.resolve(false))
    await expect(logout(fakeSessions({ removeByToken }), TOKEN)).resolves.toBeUndefined()
    expect(removeByToken).toHaveBeenCalledWith(TOKEN)
  })
})
