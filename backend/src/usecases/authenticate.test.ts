import { describe, expect, it, vi } from 'vitest'
import {
  ERROR,
  SESSION_LIFETIME_DAYS,
  SESSION_TOUCH_AFTER_HOURS,
  actorSchema,
  sessionSchema,
} from '@molvia/model'
import type { LiveSession, SessionRepository } from '@/db/sessions-repository'
import { authenticate } from './authenticate'

const ACTOR_ID = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const SESSION_ID = 'b1b1b1b1-1111-4111-8111-111111111111'
const TOKEN = 'Zm9vYmFyLXRva2VuLTMyLWJ5dGVzLWJhc2U2NHVybA'

const actor = actorSchema.parse({
  id: ACTOR_ID,
  telegramUserId: 777_000_123,
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  sharedUntil: null,
  createdAt: new Date('2026-09-16T10:00:00.000Z'),
  updatedAt: new Date('2026-09-16T10:00:00.000Z'),
})

function live(lastSeenAt: Date): LiveSession {
  return {
    actor,
    session: sessionSchema.parse({
      id: SESSION_ID,
      actorId: ACTOR_ID,
      deviceName: null,
      createdAt: new Date('2026-09-16T10:00:00.000Z'),
      lastSeenAt,
      expiresAt: new Date(Date.now() + 3_600_000),
    }),
  }
}

function fakeSessions(overrides: Partial<SessionRepository> = {}): SessionRepository {
  return {
    create: () => Promise.reject(new Error('create was not expected')),
    liveByToken: () => Promise.reject(new Error('liveByToken was not expected')),
    touch: () => Promise.reject(new Error('touch was not expected')),
    ...overrides,
  }
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000)

describe('чем запрос доказывает личность', () => {
  it('отдаёт владельца живой сессии', async () => {
    const sessions = fakeSessions({ liveByToken: () => Promise.resolve(live(hoursAgo(1))) })

    await expect(authenticate(sessions, TOKEN)).resolves.toEqual({
      actor,
      refreshedUntil: null,
    })
  })

  it('на любое «сессии нет» отвечает одним и тем же', async () => {
    // Нет cookie, чужой токен, отозванная строка, истёкшая — до сценария они доезжают одним
    // `null` из одного `WHERE`, и разбирать их тут нечем и незачем: разница в ответах — это
    // способ подбирать чужое по ответам сервера.
    const sessions = fakeSessions({ liveByToken: () => Promise.resolve(null) })

    await expect(authenticate(sessions, TOKEN)).rejects.toMatchObject({ code: ERROR.NO_ACTOR })
    await expect(authenticate(sessions, '')).rejects.toMatchObject({ code: ERROR.NO_ACTOR })
    await expect(authenticate(sessions, 'мусор')).rejects.toMatchObject({ code: ERROR.NO_ACTOR })
  })
})

describe('скользящий срок', () => {
  it('свежую сессию не трогает вовсе — ни записи, ни похода в базу', async () => {
    // Не «записал те же значения», а не пошёл: `UPDATE` на каждый запрос к API — это новая
    // версия строки в таблице, в которую стучится каждый запрос (Р-2).
    const touch = vi.fn()
    const sessions = fakeSessions({
      liveByToken: () => Promise.resolve(live(hoursAgo(SESSION_TOUCH_AFTER_HOURS - 1))),
      touch,
    })

    const authenticated = await authenticate(sessions, TOKEN)

    expect(touch).not.toHaveBeenCalled()
    expect(authenticated.refreshedUntil).toBeNull()
  })

  it('засидевшуюся продлевает и называет новый срок', async () => {
    const until = new Date(Date.now() + SESSION_LIFETIME_DAYS * 24 * 3_600_000)
    const touch = vi.fn(() => Promise.resolve(until))
    const sessions = fakeSessions({
      liveByToken: () => Promise.resolve(live(hoursAgo(SESSION_TOUCH_AFTER_HOURS + 1))),
      touch,
    })

    const authenticated = await authenticate(sessions, TOKEN)

    expect(touch).toHaveBeenCalledWith(SESSION_ID, SESSION_TOUCH_AFTER_HOURS, SESSION_LIFETIME_DAYS)
    expect(authenticated.refreshedUntil).toBe(until)
  })

  it('если продлила соседняя вкладка, вторая молча обходится без cookie', async () => {
    // Условие «пора» живёт и в `WHERE`, поэтому у второго одновременного запроса `UPDATE` не
    // находит строки. Это не сбой: продлевать второй раз нечего, и переставлять cookie незачем.
    const sessions = fakeSessions({
      liveByToken: () => Promise.resolve(live(hoursAgo(SESSION_TOUCH_AFTER_HOURS + 1))),
      touch: () => Promise.resolve(null),
    })

    await expect(authenticate(sessions, TOKEN)).resolves.toMatchObject({ refreshedUntil: null })
  })
})
