/**
 * Язык приложения у аккаунта через живой сервер (MOL-398, В-1 «в»): запрос телефона называет язык
 * экранов, страж пишет его в `actors.locale`, только когда он другой; чужое значение и запрос без
 * заголовка ничего не меняют; `updated_at` язык не двигает — это не правка настроек.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { LOCALE_HEADER, SESSION_COOKIE } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors } from '@/db/schema'
import { createActorRepository } from '@/db/actors-repository'
import { createSessionRepository } from '@/db/sessions-repository'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { anHourFromNow, clearAll, insertActor } from './fixtures'
import { onlyRow } from './rows'

const { db, close } = connectDrizzle()
const actorRepository = createActorRepository(db)
const sessionRepository = createSessionRepository(db)

let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({
    db,
    login: { username: 'molvia_bot', botSecret: randomBytes(32).toString('base64url') },
  })
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

const LONG_AGO = new Date('2026-01-01T00:00:00.000Z')

async function owner() {
  const actorId = await insertActor(db, { updatedAt: LONG_AGO })
  const token = randomBytes(32).toString('base64url')
  await sessionRepository.create(randomUUID(), actorId, token, null, anHourFromNow())
  return { actorId, cookie: `${SESSION_COOKIE}=${token}` }
}

async function rowOf(actorId: string) {
  const row = onlyRow(
    await db
      .select({ locale: actors.locale, updatedAt: actors.updatedAt })
      .from(actors)
      .where(eq(actors.id, actorId)),
  )
  if (row === undefined) throw new Error('the owner is gone')
  return row
}

function whoAmI(cookie: string, locale?: string | string[]) {
  return app.inject({
    method: 'GET',
    url: '/actors/me',
    headers: { cookie, ...(locale === undefined ? {} : { [LOCALE_HEADER]: locale }) },
  })
}

describe('язык, который назвал телефон', () => {
  it('пустой до первого запроса с ним, затем — названный; смена пишется', async () => {
    const { actorId, cookie } = await owner()
    expect((await rowOf(actorId)).locale).toBeNull()

    expect((await whoAmI(cookie, 'en')).statusCode).toBe(200)
    expect((await rowOf(actorId)).locale).toBe('en')

    await whoAmI(cookie, 'ru')
    expect((await rowOf(actorId)).locale).toBe('ru')
  })

  it.each([
    ['без заголовка — бот, старая страница', undefined],
    ['тег, а не язык', 'en-GB'],
    ['чужой язык', 'hy'],
    ['пустой', ''],
    ['два раза', ['en', 'en']],
  ])('%s — ничего не меняет', async (_, named) => {
    const { actorId, cookie } = await owner()
    await whoAmI(cookie, 'en')

    expect((await whoAmI(cookie, named)).statusCode).toBe(200)
    expect((await rowOf(actorId)).locale).toBe('en')
  })

  it('язык не правка: `updated_at` стоит', async () => {
    const { actorId, cookie } = await owner()

    await whoAmI(cookie, 'en')

    expect((await rowOf(actorId)).updatedAt).toEqual(LONG_AGO)
  })
})

describe('markLocale', () => {
  it('отвечает, писал ли: тот же язык второй раз — нет', async () => {
    const { actorId } = await owner()

    await expect(actorRepository.markLocale(actorId, 'en')).resolves.toBe(true)
    await expect(actorRepository.markLocale(actorId, 'en')).resolves.toBe(false)
    await expect(actorRepository.markLocale(actorId, 'ru')).resolves.toBe(true)
  })

  it('несуществующий или кривой id — не ошибка, а «не писал»', async () => {
    await expect(actorRepository.markLocale(randomUUID(), 'en')).resolves.toBe(false)
    await expect(actorRepository.markLocale('мусор', 'en')).resolves.toBe(false)
  })
})
