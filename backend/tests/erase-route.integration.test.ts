import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR, ISSUE } from '@molvia/model'
import { buildServer } from '@/server'
import { actors, sessions } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertSession, telegramId } from './fixtures'

const { db, close } = connectDrizzle()
const botSecret = randomBytes(32).toString('base64url')
const app = buildServer({ db, login: { username: 'molvia_bot', botSecret } })
beforeAll(() => app.ready())
beforeEach(() => clearAll(db))
afterAll(async () => {
  await app.close()
  await close()
})

function erase(body: unknown, authorization: string | null = `Bearer ${botSecret}`) {
  return app.inject({
    method: 'POST',
    url: '/internal/actors/erase',
    headers: authorization ? { authorization } : {},
    payload: body as Record<string, unknown>,
  })
}

describe('POST /internal/actors/erase — удаление самим человеком из бота (MOL-58)', () => {
  it('стирает владельца этого Telegram-id вместе с сессиями', async () => {
    const tg = telegramId()
    const actorId = await insertActor(db, { telegramUserId: tg })
    await insertSession(db, { actorId })

    const response = await erase({ telegramUserId: tg })

    expect(response.statusCode).toBe(204)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(await db.select().from(actors).where(eq(actors.id, actorId))).toEqual([])
    expect(await db.select().from(sessions).where(eq(sessions.actorId, actorId))).toEqual([])
  })

  it('повтор и незнакомый id отвечают тем же 204', async () => {
    const tg = telegramId()
    await insertActor(db, { telegramUserId: tg })
    expect((await erase({ telegramUserId: tg })).statusCode).toBe(204)
    expect((await erase({ telegramUserId: tg })).statusCode).toBe(204)
    expect((await erase({ telegramUserId: telegramId() })).statusCode).toBe(204)
  })

  it('без секрета бота или с чужим — отказ, и никто не стёрт', async () => {
    const tg = telegramId()
    const actorId = await insertActor(db, { telegramUserId: tg })

    for (const authorization of [null, 'Bearer wrong', `Bearer ${botSecret}x`]) {
      const response = await erase({ telegramUserId: tg }, authorization)
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ code: ERROR.BOT_UNAUTHORIZED })
      expect(response.headers['cache-control']).toBe('no-store')
    }
    expect(await db.select().from(actors).where(eq(actors.id, actorId))).toHaveLength(1)
  })

  it.each([{}, { telegramUserId: 0 }, { telegramUserId: '42' }, { telegramUserId: 42, extra: 1 }])(
    'тело %j — 400, до базы не доходит',
    async (body) => {
      const response = await erase(body)
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ code: ISSUE.BODY_INVALID })
    },
  )

  it('копия без настроенного входа не стирает никого', async () => {
    const closed = buildServer({ db, login: null })
    await closed.ready()
    const tg = telegramId()
    await insertActor(db, { telegramUserId: tg })

    const response = await closed.inject({
      method: 'POST',
      url: '/internal/actors/erase',
      headers: { authorization: `Bearer ${botSecret}` },
      payload: { telegramUserId: tg },
    })

    expect(response.statusCode).toBe(401)
    await closed.close()
  })
})
