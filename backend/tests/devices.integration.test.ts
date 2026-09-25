/**
 * Выход и список устройств (MOL-57): репозиторий на настоящем Postgres и три ручки через живой
 * сервер. Здесь держится то, что обещано задачей: выгнанная сессия на следующем запросе получает
 * 401, выход одного устройства не трогает другие, последняя сессия выходит так же, как любая,
 * а чужая сессия отвечает тем же, что несуществующая.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { ERROR, LOGIN_HEADER, SESSION_COOKIE, sessionsResponseCodec } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { sessions } from '@/db/schema'
import { createSessionRepository } from '@/db/sessions-repository'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { aStrangersCookie, anHourFromNow, clearAll, insertActor } from './fixtures'

const { db, close } = connectDrizzle()
const repository = createSessionRepository(db)

let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db })
  await app.ready()
})

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await app.close()
  await close()
})

const HOUR = 3_600_000

interface Device {
  readonly id: string
  readonly token: string
  readonly cookie: string
}

/** Одно устройство владельца: сессия с именем и датой последнего визита. */
async function device(
  actorId: string,
  name: string | null,
  lastSeenHoursAgo = 0,
  createdHoursAgo = lastSeenHoursAgo,
): Promise<Device> {
  const token = randomBytes(32).toString('base64url')
  const id = randomUUID()
  await repository.create(id, actorId, token, name, anHourFromNow())
  await db
    .update(sessions)
    .set({
      createdAt: new Date(Date.now() - createdHoursAgo * HOUR),
      lastSeenAt: new Date(Date.now() - lastSeenHoursAgo * HOUR),
    })
    .where(eq(sessions.id, id))
  return { id, token, cookie: `${SESSION_COOKIE}=${token}` }
}

/** Срок кончился час назад; `created_at` отодвинут, иначе строку не примет CHECK о сроке. */
async function expire(id: string): Promise<void> {
  await db
    .update(sessions)
    .set({ createdAt: new Date(Date.now() - 3 * HOUR), expiresAt: new Date(Date.now() - HOUR) })
    .where(eq(sessions.id, id))
}

async function rows(): Promise<string[]> {
  return (await db.select({ id: sessions.id }).from(sessions)).map((row) => row.id).sort()
}

function inject(method: 'GET' | 'POST' | 'DELETE', url: string, cookie?: string, extra = {}) {
  return app.inject({
    method,
    url,
    headers: { ...(cookie === undefined ? {} : { cookie }), ...extra },
  })
}

const logout = (cookie?: string, extra: Record<string, string> = { [LOGIN_HEADER]: '1' }) =>
  inject('POST', '/auth/logout', cookie, extra)

async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) =>
      setTimeout(() => {
        resolve(false)
      }, ms),
    ),
  ])
}

function setCookie(headers: Record<string, unknown>): string | undefined {
  const value = headers['set-cookie']
  return Array.isArray(value) ? value.join('\n') : (value as string | undefined)
}

describe('репозиторий: список', () => {
  it('только живые и только свои, текущая первой, дальше по последнему визиту', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const current = await device(owner, 'iPhone · Safari', 30)
    const recent = await device(owner, 'Windows · Chrome', 1)
    const older = await device(owner, null, 10)
    const dead = await device(owner, 'Mac · Safari', 0)
    await expire(dead.id)
    await device(stranger, 'Android · Chrome', 0)

    const list = await repository.listFor(owner, current.id, 50)

    expect(list.sessions.map((session) => session.id)).toEqual([current.id, recent.id, older.id])
    expect(list.total).toBe(3)
  })

  it('на равном визите решает время входа, потом id', async () => {
    const owner = await insertActor(db)
    const a = await device(owner, null, 5, 10)
    const b = await device(owner, null, 5, 20)
    // Одно и то же мгновение: `device` берёт часы на каждый вызов, и «равный» визит расходился
    // бы на миллисекунды.
    const seen = new Date(Date.now() - 5 * HOUR)
    await db.update(sessions).set({ lastSeenAt: seen }).where(eq(sessions.actorId, owner))
    const list = await repository.listFor(owner, randomUUID(), 50)
    expect(list.sessions.map((session) => session.id)).toEqual([a.id, b.id])
  })

  it('предел режет хвост, но не текущую, и total считает всех', async () => {
    const owner = await insertActor(db)
    const current = await device(owner, null, 23)
    for (let i = 0; i < 3; i += 1) await device(owner, null, i)

    const cut = await repository.listFor(owner, current.id, 2)
    expect(cut.sessions.map((session) => session.id)[0]).toBe(current.id)
    expect(cut.sessions).toHaveLength(2)
    expect(cut.total).toBe(4)

    expect((await repository.listFor(owner, current.id, 4)).sessions).toHaveLength(4)
    expect((await repository.listFor(owner, current.id, 5)).sessions).toHaveLength(4)
  })

  it('у владельца без живых сессий — пусто и ноль', async () => {
    const owner = await insertActor(db)
    const only = await device(owner, null)
    await expire(only.id)
    expect(await repository.listFor(owner, only.id, 50)).toEqual({ sessions: [], total: 0 })
  })
})

describe('репозиторий: удаление', () => {
  it('своя живая — удаляется одна, остальные целы', async () => {
    const owner = await insertActor(db)
    const phone = await device(owner, null)
    const laptop = await device(owner, null)

    expect(await repository.removeFor(owner, phone.id)).toBe(true)
    expect(await rows()).toEqual([laptop.id])
    expect(await repository.removeFor(owner, phone.id)).toBe(false)
  })

  it('чужая, несуществующая, истёкшая и кривой id не удаляют ничего', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const theirs = await device(stranger, null)
    const dead = await device(owner, null)
    await expire(dead.id)

    expect(await repository.removeFor(owner, theirs.id)).toBe(false)
    expect(await repository.removeFor(owner, randomUUID())).toBe(false)
    expect(await repository.removeFor(owner, dead.id)).toBe(false)
    expect(await repository.removeFor(owner, 'not-a-uuid')).toBe(false)
    expect(await rows()).toEqual([theirs.id, dead.id].sort())
  })

  it('по токену — удаляет ровно ту, повтор отвечает false', async () => {
    const owner = await insertActor(db)
    const phone = await device(owner, null)
    const laptop = await device(owner, null)

    expect(await repository.removeByToken(phone.token)).toBe(true)
    expect(await repository.removeByToken(phone.token)).toBe(false)
    expect(await repository.removeByToken('')).toBe(false)
    expect(await rows()).toEqual([laptop.id])
  })

  it('уборка забирает истёкшие и оставляет живые', async () => {
    const owner = await insertActor(db)
    const live = await device(owner, null)
    const dead = await device(owner, 'Mac · Safari')
    await expire(dead.id)

    await repository.removeExpired()

    expect(await rows()).toEqual([live.id])
  })

  it('уборка не ждёт строку, которую держит стирание, и забирает её следующим проходом', async () => {
    const owner = await insertActor(db)
    const dead = await device(owner, null)
    await expire(dead.id)
    // Второе соединение: у тестового пула оно одно, и ожидание было бы не блокировкой, а очередью.
    const holder = connectDrizzle()
    try {
      await holder.db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from sessions where id = ${dead.id} for update`)
        expect(await settlesWithin(repository.removeExpired(), 2000)).toBe(true)
        expect(await rows()).toEqual([dead.id])
      })
    } finally {
      await holder.close()
    }
    await repository.removeExpired()
    expect(await rows()).toEqual([])
  })
})

describe('GET /sessions', () => {
  it('отдаёт свои живые, текущая помечена и первая, ответ не кешируется', async () => {
    const owner = await insertActor(db)
    const laptop = await device(owner, 'Windows · Chrome', 2)
    const phone = await device(owner, 'iPhone · Safari', 20)

    const response = await inject('GET', '/sessions', phone.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const list = sessionsResponseCodec.parse(response.json())
    expect(
      list.sessions.map(({ id, current, deviceName }) => ({ id, current, deviceName })),
    ).toEqual([
      { id: phone.id, current: true, deviceName: 'iPhone · Safari' },
      { id: laptop.id, current: false, deviceName: 'Windows · Chrome' },
    ])
    expect(list.total).toBe(2)
  })

  it('без сессии — 401, лишний параметр — 400', async () => {
    expect((await inject('GET', '/sessions')).statusCode).toBe(401)
    const owner = await insertActor(db)
    const phone = await device(owner, null)
    const named = await inject('GET', '/sessions?actorId=x', phone.cookie)
    expect(named.statusCode).toBe(400)
    expect(named.json()).toMatchObject({ details: 'actorId' })
  })
})

describe('DELETE /sessions/:id', () => {
  it('выгнанная сессия на следующем запросе получает 401, а соседняя жива', async () => {
    const owner = await insertActor(db)
    const phone = await device(owner, null)
    const laptop = await device(owner, null)

    const ended = await inject('DELETE', `/sessions/${laptop.id}`, phone.cookie)
    expect(ended.statusCode).toBe(204)
    // Завершили чужое устройство — своя cookie остаётся на месте.
    expect(setCookie(ended.headers)).toBeUndefined()

    const kicked = await inject('GET', '/actors/me', laptop.cookie)
    expect(kicked.statusCode).toBe(401)
    expect(kicked.json()).toEqual({ code: ERROR.NO_ACTOR })
    expect(setCookie(kicked.headers)).toContain('Max-Age=0')
    expect((await inject('GET', '/actors/me', phone.cookie)).statusCode).toBe(200)
  })

  it('чужая, несуществующая, уже удалённая и кривой адрес — один 404', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const phone = await device(owner, null)
    const theirs = await device(stranger, null)

    const answers = await Promise.all(
      [theirs.id, randomUUID(), 'not-a-uuid', '%20'].map((id) =>
        inject('DELETE', `/sessions/${id}`, phone.cookie),
      ),
    )
    for (const answer of answers) {
      expect(answer.statusCode).toBe(404)
      expect(answer.json()).toEqual({ code: ERROR.NOT_FOUND })
    }
    expect((await inject('GET', '/actors/me', theirs.cookie)).statusCode).toBe(200)
  })

  it('своя текущая — это выход: 204, cookie гаснет, следующий запрос 401', async () => {
    const owner = await insertActor(db)
    const only = await device(owner, null)

    const ended = await inject('DELETE', `/sessions/${only.id.toUpperCase()}`, only.cookie)

    expect(ended.statusCode).toBe(204)
    expect(ended.headers['cache-control']).toBe('no-store')
    expect(setCookie(ended.headers)).toContain(`${SESSION_COOKIE}=; Max-Age=0`)
    expect((await inject('GET', '/actors/me', only.cookie)).statusCode).toBe(401)
  })
})

describe('POST /auth/logout', () => {
  it('гасит только эту сессию и снимает cookie; соседнее устройство живо', async () => {
    const owner = await insertActor(db)
    const phone = await device(owner, null)
    const laptop = await device(owner, null)

    const out = await logout(phone.cookie)

    expect(out.statusCode).toBe(204)
    expect(out.headers['cache-control']).toBe('no-store')
    expect(setCookie(out.headers)).toContain(`${SESSION_COOKIE}=; Max-Age=0`)
    expect(await rows()).toEqual([laptop.id])
    expect((await inject('GET', '/actors/me', phone.cookie)).statusCode).toBe(401)
    expect((await inject('GET', '/actors/me', laptop.cookie)).statusCode).toBe(200)
  })

  it('последняя сессия выходит так же, как любая', async () => {
    const owner = await insertActor(db)
    const only = await device(owner, null)
    expect((await logout(only.cookie)).statusCode).toBe(204)
    expect(await rows()).toEqual([])
  })

  it('повтор после потерянного ответа, мёртвый токен и отсутствие cookie — тоже 204', async () => {
    const owner = await insertActor(db)
    const phone = await device(owner, null)
    await logout(phone.cookie)

    const again = await logout(phone.cookie)
    expect(again.statusCode).toBe(204)
    expect(setCookie(again.headers)).toContain('Max-Age=0')
    expect((await logout(aStrangersCookie())).statusCode).toBe(204)

    const bare = await logout()
    expect(bare.statusCode).toBe(204)
    expect(setCookie(bare.headers)).toBeUndefined()
  })

  it('две cookie — отказ, и ни одна не гаснет', async () => {
    const owner = await insertActor(db)
    const phone = await device(owner, null)

    const out = await logout(`${phone.cookie}; ${aStrangersCookie()}`)

    expect(out.statusCode).toBe(401)
    expect(out.headers['cache-control']).toBe('no-store')
    expect(setCookie(out.headers)).toBeUndefined()
    expect(await rows()).toEqual([phone.id])
  })

  it('без заголовка входа, с чужого сайта и с телом — отказ, сессия жива', async () => {
    const owner = await insertActor(db)
    const phone = await device(owner, null)

    const bare = await logout(phone.cookie, {})
    const crossSite = await logout(phone.cookie, {
      [LOGIN_HEADER]: '1',
      'sec-fetch-site': 'cross-site',
    })
    const withBody = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: phone.cookie, [LOGIN_HEADER]: '1', 'content-type': 'application/json' },
      payload: '{}',
    })

    expect(bare.statusCode).toBe(403)
    expect(crossSite.statusCode).toBe(403)
    expect(withBody.statusCode).toBe(400)
    for (const answer of [bare, crossSite, withBody]) {
      expect(answer.headers['cache-control']).toBe('no-store')
      expect(setCookie(answer.headers)).toBeUndefined()
    }
    expect(await rows()).toEqual([phone.id])
  })
})
