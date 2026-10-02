import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { ERROR, FEEDBACK_DAY_LIMIT, ISSUE } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { VERSION } from '@/env'
import { feedback } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'

const { db, close } = connectDrizzle()

let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db })
  await app.ready()
})

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

function message(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'bug',
    text: 'Не открывается «Деньги»',
    locale: 'ru',
    pageBuild: 'v0.1.3-20-gd90f9cee',
    route: 'money',
    platform: 'ios 18 app',
    fromError: true,
    errorCode: 'error.internal',
    clientKey: randomUUID(),
    ...overrides,
  }
}

function send(body: unknown, cookie?: string) {
  return app.inject({
    method: 'POST',
    url: '/feedback',
    payload: body as Record<string, unknown>,
    headers: cookie === undefined ? {} : { cookie },
  })
}

/** Messages already written by a person, `hoursAgo` back — the window is a rolling day. */
async function written(actorId: string, count: number, hoursAgo: number) {
  const at = new Date(Date.now() - hoursAgo * 3_600_000)
  await db.insert(feedback).values(
    Array.from({ length: count }, () => ({
      actorId,
      kind: 'idea' as const,
      text: 'раньше',
      locale: 'ru',
      apiBuild: 'dev',
      clientKey: randomUUID(),
      createdAt: at,
    })),
  )
}

describe('POST /feedback (MOL-147)', () => {
  it('пишет сообщение автора сессии с номером, приложенным и сборкой самого API', async () => {
    const anna = await insertActor(db)
    const cookie = await signIn(db, anna)

    const reply = await send(message(), cookie)

    expect(reply.statusCode).toBe(201)
    expect(reply.headers['cache-control']).toBe('no-store')
    const { number } = reply.json<{ number: number }>()
    const [row] = await db.select().from(feedback).where(eq(feedback.id, number))
    expect(row).toMatchObject({
      actorId: anna,
      kind: 'bug',
      text: 'Не открывается «Деньги»',
      locale: 'ru',
      pageBuild: 'v0.1.3-20-gd90f9cee',
      apiBuild: VERSION,
      route: 'money',
      platform: 'ios 18 app',
      fromError: true,
      errorCode: 'error.internal',
      threadId: null,
      inReplyTo: null,
    })
  })

  it('из настроек — без кода и без сборки страницы, текст обрезан по краям', async () => {
    const cookie = await signIn(db, await insertActor(db))

    const reply = await send(
      message({
        kind: 'idea',
        text: '  Хочу видеть цены в рублях \r\n',
        pageBuild: null,
        fromError: false,
        errorCode: null,
      }),
      cookie,
    )

    expect(reply.statusCode).toBe(201)
    const [row] = await db.select().from(feedback)
    expect(row).toMatchObject({
      kind: 'idea',
      text: 'Хочу видеть цены в рублях',
      pageBuild: null,
      errorCode: null,
      fromError: false,
    })
  })

  it('без сессии — 401, и ничего не записано', async () => {
    const reply = await send(message())

    expect(reply.statusCode).toBe(401)
    expect(reply.json()).toEqual({ code: ERROR.NO_ACTOR })
    expect(await db.select().from(feedback)).toEqual([])
  })

  it('автора назвать нельзя: в теле нет такого поля, пишется владелец сессии', async () => {
    const anna = await insertActor(db)
    const boris = await insertActor(db)
    const cookie = await signIn(db, boris)

    const named = await send({ ...message(), actorId: anna }, cookie)
    const own = await send(message(), cookie)

    expect(named.statusCode).toBe(400)
    expect(own.statusCode).toBe(201)
    const rows = await db.select({ actorId: feedback.actorId }).from(feedback)
    expect(rows).toEqual([{ actorId: boris }])
  })

  it('пустой и невидимый текст, вид не выбран, код без экрана ошибки — 400', async () => {
    const cookie = await signIn(db, await insertActor(db))

    const answers = await Promise.all([
      send(message({ text: '' }), cookie),
      send(message({ text: ' \n\u200B\u2060 ' }), cookie),
      send(message({ kind: undefined }), cookie),
      send(message({ fromError: false }), cookie),
      send(message({ text: 'а'.repeat(2001) }), cookie),
    ])

    expect(answers.map((reply) => reply.statusCode)).toEqual([400, 400, 400, 400, 400])
    expect(answers[1].json()).toMatchObject({ code: ISSUE.TEXT_NOT_VISIBLE })
    expect(await db.select().from(feedback)).toEqual([])
  })

  it('повтор с тем же ключом — та же запись, 200 и тот же номер; второй строки нет', async () => {
    const cookie = await signIn(db, await insertActor(db))
    const body = message()

    const first = await send(body, cookie)
    const again = await send(body, cookie)

    expect([first.statusCode, again.statusCode]).toEqual([201, 200])
    expect(again.json()).toEqual(first.json())
    expect(await db.select().from(feedback)).toHaveLength(1)
  })

  it('тот же ключ с другим текстом — 409, первое сообщение не тронуто', async () => {
    const cookie = await signIn(db, await insertActor(db))
    const body = message()

    await send(body, cookie)
    const changed = await send({ ...body, text: 'Другое' }, cookie)

    expect(changed.statusCode).toBe(409)
    expect(changed.json()).toEqual({ code: ERROR.CONFLICT })
    const rows = await db.select({ text: feedback.text }).from(feedback)
    expect(rows).toEqual([{ text: 'Не открывается «Деньги»' }])
  })

  it('ключ другого человека — не повтор: у каждого своё сообщение', async () => {
    const annaCookie = await signIn(db, await insertActor(db))
    const borisCookie = await signIn(db, await insertActor(db))
    const body = message()

    const anna = await send(body, annaCookie)
    const boris = await send(body, borisCookie)

    expect([anna.statusCode, boris.statusCode]).toEqual([201, 201])
    expect(boris.json<{ number: number }>().number).not.toBe(anna.json<{ number: number }>().number)
  })

  it(`${String(FEEDBACK_DAY_LIMIT)}-е за сутки принято, следующее — 429; повтор в счёт не идёт`, async () => {
    const anna = await insertActor(db)
    const cookie = await signIn(db, anna)
    await written(anna, FEEDBACK_DAY_LIMIT - 1, 1)
    const last = message()

    const tenth = await send(last, cookie)
    const repeat = await send(last, cookie)
    const eleventh = await send(message(), cookie)

    expect([tenth.statusCode, repeat.statusCode, eleventh.statusCode]).toEqual([201, 200, 429])
    expect(eleventh.json()).toEqual({ code: ERROR.FEEDBACK_RATE_LIMITED })
    expect(await db.select().from(feedback)).toHaveLength(FEEDBACK_DAY_LIMIT)
  })

  it('сутки скользящие: написанное больше суток назад не считается, чужое тоже', async () => {
    const anna = await insertActor(db)
    const boris = await insertActor(db)
    await written(anna, FEEDBACK_DAY_LIMIT, 25)
    await written(boris, FEEDBACK_DAY_LIMIT, 1)
    const cookie = await signIn(db, anna)

    expect((await send(message(), cookie)).statusCode).toBe(201)
    await written(anna, FEEDBACK_DAY_LIMIT - 1, 23)
    expect((await send(message(), cookie)).statusCode).toBe(429)
  })

  it('разом сверх предела — принято ровно столько, сколько можно', async () => {
    const anna = await insertActor(db)
    const cookie = await signIn(db, anna)

    const answers = await Promise.all(
      Array.from({ length: FEEDBACK_DAY_LIMIT + 3 }, () => send(message(), cookie)),
    )

    const statuses = answers.map((reply) => reply.statusCode)
    expect(statuses.filter((status) => status === 201)).toHaveLength(FEEDBACK_DAY_LIMIT)
    expect(statuses.filter((status) => status === 429)).toHaveLength(3)
    expect(await db.select().from(feedback)).toHaveLength(FEEDBACK_DAY_LIMIT)
  })
})
