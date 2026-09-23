import { describe, expect, it, vi } from 'vitest'
import { SESSION_LIFETIME_DAYS, actorSchema, sessionSchema } from '@molvia/model'
import type { Actor, NewActor } from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'
import type { SessionRepository } from '@/db/sessions-repository'
import { signIn } from './sign-in'

const TELEGRAM_ID = 777_000_123
const RETURNING_ID = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

function actorFrom(id: string, telegramUserId: number, input: NewActor): Actor {
  return actorSchema.parse({
    id,
    telegramUserId,
    ...input,
    sharedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

const returning = actorFrom(RETURNING_ID, TELEGRAM_ID, {
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
})

function fakeActors(overrides: Partial<ActorRepository> = {}): ActorRepository {
  return {
    create: () => Promise.reject(new Error('create was not expected')),
    createIfMissing: () => Promise.reject(new Error('createIfMissing was not expected')),
    byId: () => Promise.reject(new Error('byId was not expected')),
    byTelegramUserId: () => Promise.reject(new Error('byTelegramUserId was not expected')),
    update: () => Promise.reject(new Error('update was not expected')),
    ...overrides,
  }
}

function fakeSessions(overrides: Partial<SessionRepository> = {}): SessionRepository {
  return {
    create: (id, actorId, _token, deviceName, expiresAt) =>
      Promise.resolve(
        sessionSchema.parse({
          id,
          actorId,
          deviceName,
          createdAt: new Date(),
          lastSeenAt: new Date(),
          expiresAt,
        }),
      ),
    liveByToken: () => Promise.reject(new Error('liveByToken was not expected')),
    touch: () => Promise.reject(new Error('touch was not expected')),
    ...overrides,
  }
}

describe('вход', () => {
  it('человека, который уже был, находит, а не заводит второго', async () => {
    // Обычный случай, а не край: новый телефон, браузер, потерявший cookie. Заводить второго
    // значило бы упереться в уникальную колонку и оставить человека без единственного, что он
    // мог бы сделать, — войти.
    const create = vi.fn()
    const actors = fakeActors({
      byTelegramUserId: () => Promise.resolve(returning),
      create,
    })

    const { actor } = await signIn(actors, fakeSessions(), TELEGRAM_ID)

    expect(actor.id).toBe(RETURNING_ID)
    expect(create).not.toHaveBeenCalled()
  })

  it('нового заводит с настройками первого визита', async () => {
    const actors = fakeActors({
      byTelegramUserId: () => Promise.resolve(null),
      createIfMissing: (id, telegramUserId, input) =>
        Promise.resolve(actorFrom(id, telegramUserId, input)),
    })

    const { actor } = await signIn(actors, fakeSessions(), TELEGRAM_ID)

    expect(actor.telegramUserId).toBe(TELEGRAM_ID)
    expect(actor.spendCurrency).toBe('AMD')
    expect(actor.city).toBe('Гюмри')
  })

  it('выдаёт сессию тому же владельцу, и каждый раз новый токен', async () => {
    const written: { actorId: string; token: string }[] = []
    const actors = fakeActors({ byTelegramUserId: () => Promise.resolve(returning) })
    const sessions = fakeSessions({
      create: (id, actorId, token, deviceName, expiresAt) => {
        written.push({ actorId, token })
        return Promise.resolve(
          sessionSchema.parse({
            id,
            actorId,
            deviceName,
            createdAt: new Date(),
            lastSeenAt: new Date(),
            expiresAt,
          }),
        )
      },
    })

    const first = await signIn(actors, sessions, TELEGRAM_ID)
    const second = await signIn(actors, sessions, TELEGRAM_ID)

    expect(written.map((row) => row.actorId)).toEqual([RETURNING_ID, RETURNING_ID])
    expect(first.token).not.toBe(second.token)
    // 32 байта в base64url — алфавит, который принимает `secretOrNull` и который cookie везёт
    // без экранирования.
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('называет срок, который потом станет Max-Age у cookie', async () => {
    const actors = fakeActors({ byTelegramUserId: () => Promise.resolve(returning) })

    const { expiresAt } = await signIn(actors, fakeSessions(), TELEGRAM_ID)

    const days = (expiresAt.getTime() - Date.now()) / (24 * 3_600_000)
    expect(days).toBeGreaterThan(SESSION_LIFETIME_DAYS - 1)
    expect(days).toBeLessThanOrEqual(SESSION_LIFETIME_DAYS)
  })

  it('имя устройства не выдумывает', async () => {
    // Имя показывает бот (MOL-54) и список устройств (MOL-57) — там, где его видно. Угаданное
    // здесь из `User-Agent` пришлось бы переделывать.
    const names: (string | null)[] = []
    const actors = fakeActors({ byTelegramUserId: () => Promise.resolve(returning) })
    const sessions = fakeSessions({
      create: (id, actorId, _token, deviceName, expiresAt) => {
        names.push(deviceName)
        return Promise.resolve(
          sessionSchema.parse({
            id,
            actorId,
            deviceName,
            createdAt: new Date(),
            lastSeenAt: new Date(),
            expiresAt,
          }),
        )
      },
    })

    await signIn(actors, sessions, TELEGRAM_ID)

    expect(names).toEqual([null])
  })
})
