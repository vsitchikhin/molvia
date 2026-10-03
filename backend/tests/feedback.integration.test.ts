import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  ERROR,
  FEEDBACK_BODY_BYTES_MAX,
  FEEDBACK_DAY_LIMIT,
  FEEDBACK_HEAVY_DAY_LIMIT,
  FEEDBACK_PICTURE_BYTES_MAX,
  ISSUE,
} from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { VERSION } from '@/env'
import { createFeedbackRepository } from '@/db/feedback-repository'
import { createErasureRepository } from '@/db/erasure-repository'
import {
  actors,
  feedback,
  feedbackPictureFiles,
  feedbackPictures,
  feedbackReplies,
} from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { aScreenshot, clearAll, insertActor, signIn } from './fixtures'

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

/** The thread a message is of — the first message's number — as a reply to it carries it. */
async function threadOf(feedbackId: number): Promise<number> {
  const [row] = await db
    .select({ thread: feedback.threadKey })
    .from(feedback)
    .where(eq(feedback.id, feedbackId))
  if (row === undefined) throw new Error('no message')
  return row.thread
}

const monthsAgo = (months: number) => new Date(Date.now() - months * 30.5 * 86_400_000)

async function aMessage(actorId: string, at: Date, thread?: { id: number; reply?: number }) {
  const [row] = await db
    .insert(feedback)
    .values({
      actorId,
      kind: 'bug',
      text: 'текст',
      locale: 'ru',
      apiBuild: 'dev',
      threadId: thread?.id,
      inReplyTo: thread?.reply,
      createdAt: at,
    })
    .returning({ id: feedback.id })
  if (row === undefined) throw new Error('no message')
  return row.id
}

async function aReply(actorId: string, feedbackId: number, at: Date) {
  const [row] = await db
    .insert(feedbackReplies)
    .values({
      feedbackId,
      actorId,
      threadId: await threadOf(feedbackId),
      text: 'ответ',
      delivered: 'sent',
      createdAt: at,
    })
    .returning({ id: feedbackReplies.id })
  if (row === undefined) throw new Error('no reply')
  return row.id
}

describe('срок — год от последнего сообщения нити (MOL-147, В-4 MOL-150)', () => {
  it('уходит нить, где всё старше года; живёт та, где хоть что-то моложе', async () => {
    const anna = await insertActor(db)
    const old = await aMessage(anna, monthsAgo(24))
    await aReply(anna, old, monthsAgo(23))
    const answered = await aMessage(anna, monthsAgo(24))
    await aReply(anna, answered, monthsAgo(2))
    const continued = await aMessage(anna, monthsAgo(24))
    const reply = await aReply(anna, continued, monthsAgo(23))
    await aMessage(anna, monthsAgo(1), { id: continued, reply })
    const lapsed = await aMessage(anna, monthsAgo(24))
    const lapsedReply = await aReply(anna, lapsed, monthsAgo(24))
    await aMessage(anna, monthsAgo(13), { id: lapsed, reply: lapsedReply })
    const recent = await aMessage(anna, monthsAgo(11))
    const stale = await aMessage(anna, monthsAgo(13))

    await createFeedbackRepository(db).purgeStale()

    const left = await db.select({ id: feedback.id, thread: feedback.threadId }).from(feedback)
    const threads = new Set(left.map((row) => row.thread ?? row.id))
    expect([...threads].sort((a, b) => a - b)).toEqual([answered, continued, recent])
    expect(threads).not.toContain(old)
    expect(threads).not.toContain(lapsed)
    expect(threads).not.toContain(stale)
    expect(left).toHaveLength(4)
    const replies = await db
      .select({ feedbackId: feedbackReplies.feedbackId })
      .from(feedbackReplies)
    expect(replies.map((row) => row.feedbackId).sort((a, b) => a - b)).toEqual([
      answered,
      continued,
    ])
  })

  it('не трогает ничего моложе года — ни чужого, ни своего', async () => {
    const anna = await insertActor(db)
    const boris = await insertActor(db)
    await aMessage(anna, monthsAgo(11))
    await aReply(boris, await aMessage(boris, monthsAgo(6)), monthsAgo(5))

    await createFeedbackRepository(db).purgeStale()

    expect(await db.select().from(feedback)).toHaveLength(2)
    expect(await db.select().from(feedbackReplies)).toHaveLength(1)
  })
})

/** The constraint a write broke, as Postgres names it — under drizzle's wrapper. */
async function refusedBy(write: Promise<unknown>): Promise<string | undefined> {
  try {
    await write
  } catch (error) {
    const cause = (error as { cause?: { constraint_name?: string } }).cause
    return cause?.constraint_name
  }
  return undefined
}

async function telegramOf(actorId: string) {
  const [row] = await db
    .select({ telegram: actors.telegramUserId })
    .from(actors)
    .where(eq(actors.id, actorId))
  if (row === undefined) throw new Error('no actor')
  return row.telegram
}

describe('схема нитей держит первое сообщение и одного человека (MOL-148, В5 ревью MOL-147)', () => {
  const now = new Date()

  it('продолжение не может отвечать на ответ чужой нити — стирание Анны не уносит Бориса (В5а)', async () => {
    const anna = await insertActor(db)
    const boris = await insertActor(db)
    const replyToAnna = await aReply(anna, await aMessage(anna, now), now)
    const borisFirst = await aMessage(boris, now)

    expect(await refusedBy(aMessage(boris, now, { id: borisFirst, reply: replyToAnna }))).toBe(
      'feedback_answers_own_reply',
    )

    const replyToBoris = await aReply(boris, borisFirst, now)
    const borisContinued = await aMessage(boris, now, { id: borisFirst, reply: replyToBoris })
    await createErasureRepository(db).erase(await telegramOf(anna), { dryRun: false })
    const left = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.actorId, boris))
    expect(left.map((row) => row.id).sort((a, b) => a - b)).toEqual([borisFirst, borisContinued])
  })

  it('продолжение называет только первое сообщение нити, не продолжение (В5б)', async () => {
    const anna = await insertActor(db)
    const first = await aMessage(anna, monthsAgo(24))
    const reply = await aReply(anna, first, monthsAgo(23))
    const continued = await aMessage(anna, monthsAgo(23), { id: first, reply })
    const second = await aReply(anna, continued, monthsAgo(22))

    expect(await refusedBy(aMessage(anna, now, { id: continued, reply: second }))).toBe(
      'feedback_thread_is_owners',
    )
    // The same word, written under the first message, keeps the whole thread for a year.
    await aMessage(anna, now, { id: first, reply: second })
    await createFeedbackRepository(db).purgeStale()
    expect(await db.select().from(feedback)).toHaveLength(3)
  })

  it('продолжение свежей нити не отвечает на ответ старой нити того же человека (В5 MOL-148)', async () => {
    const anna = await insertActor(db)
    const old = await aMessage(anna, monthsAgo(14))
    const oldReply = await aReply(anna, old, monthsAgo(14))
    const fresh = await aMessage(anna, now)
    const freshReply = await aReply(anna, fresh, now)

    expect(await refusedBy(aMessage(anna, now, { id: fresh, reply: oldReply }))).toBe(
      'feedback_answers_own_reply',
    )
    // The same word answering its own thread's reply outlives the old thread's purge.
    const word = await aMessage(anna, now, { id: fresh, reply: freshReply })
    await createFeedbackRepository(db).purgeStale()
    const left = await db.select({ id: feedback.id }).from(feedback)
    expect(left.map((row) => row.id).sort((a, b) => a - b)).toEqual([fresh, word])
  })

  it('ответ не встаёт под сообщение с чужой нитью в своей колонке', async () => {
    const anna = await insertActor(db)
    const first = await aMessage(anna, now)
    const second = await aMessage(anna, now)

    expect(
      await refusedBy(
        db
          .insert(feedbackReplies)
          .values({ feedbackId: first, actorId: anna, threadId: second, text: 'ответ' }),
      ),
    ).toBe('feedback_replies_message_is_owners')
  })

  it('продолжение не встаёт в нить другого человека', async () => {
    const anna = await insertActor(db)
    const boris = await insertActor(db)
    const annas = await aMessage(anna, now)
    const reply = await aReply(boris, await aMessage(boris, now), now)

    expect(await refusedBy(aMessage(boris, now, { id: annas, reply }))).toBe(
      'feedback_thread_is_owners',
    )
  })

  it('ответ стоит только под сообщением того же человека, что в его actor_id', async () => {
    const anna = await insertActor(db)
    const boris = await insertActor(db)
    const annas = await aMessage(anna, now)

    expect(await refusedBy(aReply(boris, annas, now))).toBe('feedback_replies_message_is_owners')
  })

  it('продолжение и только оно отвечает на ответ', async () => {
    const anna = await insertActor(db)
    const first = await aMessage(anna, now)
    const reply = await aReply(anna, first, now)

    expect(await refusedBy(aMessage(anna, now, { id: first }))).toBe(
      'feedback_continuation_answers',
    )
    expect(
      await refusedBy(
        db.insert(feedback).values({
          actorId: anna,
          kind: 'bug',
          text: 'текст',
          locale: 'ru',
          apiBuild: 'dev',
          inReplyTo: reply,
        }),
      ),
    ).toBe('feedback_continuation_answers')
  })

  it('id сообщения в Telegram один на человека, у разных людей может совпасть', async () => {
    const anna = await insertActor(db)
    const boris = await insertActor(db)
    const annas = await aMessage(anna, now)
    const borises = await aMessage(boris, now)
    const sent = (actorId: string, feedbackId: number) =>
      db.insert(feedbackReplies).values({
        feedbackId,
        actorId,
        threadId: feedbackId,
        text: 'ответ',
        delivered: 'sent',
        telegramMessageId: 9031,
      })

    await sent(anna, annas)
    await sent(boris, borises)
    expect(await refusedBy(sent(anna, annas))).toBe('feedback_replies_telegram_message_key')
  })

  it('исход «gone» база больше не принимает', async () => {
    const anna = await insertActor(db)
    const annas = await aMessage(anna, now)

    expect(
      await refusedBy(
        db.insert(feedbackReplies).values({
          feedbackId: annas,
          actorId: anna,
          threadId: annas,
          text: 'ответ',
          delivered: 'gone' as never,
        }),
      ),
    ).toBe('feedback_replies_delivered_known')
  })
})

describe('снимки к сообщению (MOL-167)', () => {
  const picturesOf = (number: number) =>
    db
      .select()
      .from(feedbackPictures)
      .where(eq(feedbackPictures.feedbackId, number))
      .orderBy(feedbackPictures.position)
  const filesOf = (number: number) =>
    db
      .select()
      .from(feedbackPictureFiles)
      .where(eq(feedbackPictureFiles.feedbackId, number))
      .orderBy(feedbackPictureFiles.position)

  it('три снимка — одна запись: по порядку, со сторонами, без места съёмки', async () => {
    const cookie = await signIn(db, await insertActor(db))
    const pictures = [
      aScreenshot(1179, 2556, { gps: true }),
      aScreenshot(1080, 2400, { seed: 1 }),
      aScreenshot(2400, 1080, { seed: 2 }),
    ]

    const reply = await send(message({ pictures }), cookie)

    expect(reply.statusCode).toBe(201)
    const { number } = reply.json<{ number: number }>()
    const [row] = await db.select().from(feedback).where(eq(feedback.id, number))
    expect(row?.pictures).toBe(3)
    const kept = await picturesOf(number)
    expect(
      kept.map(({ position, source, width, height }) => [position, source, width, height]),
    ).toEqual([
      [1, 'phone', 1179, 2556],
      [2, 'phone', 1080, 2400],
      [3, 'phone', 2400, 1080],
    ])
    const files = await filesOf(number)
    expect(files).toHaveLength(3)
    const first = files[0]?.image ?? Buffer.alloc(0)
    expect(first.includes(Buffer.from('GPS'))).toBe(false)
    expect(first.includes(Buffer.from('Exif'))).toBe(false)
    expect(kept[0]?.bytes).toBe(first.length)
    expect(kept.every((picture) => picture.sentAt === null)).toBe(true)
  })

  it('четвёртый снимок — 400, ничего не записано', async () => {
    const cookie = await signIn(db, await insertActor(db))
    const four = [0, 1, 2, 3].map((seed) => aScreenshot(1179, 2556, { seed }))

    const reply = await send(message({ pictures: four }), cookie)

    expect(reply.statusCode).toBe(400)
    expect(reply.json()).toMatchObject({ details: 'pictures' })
    expect(await db.select().from(feedback)).toHaveLength(0)
  })

  it('снимок без текста — сообщение; ни текста, ни снимка — 400', async () => {
    const cookie = await signIn(db, await insertActor(db))
    const silent: Record<string, unknown> = { ...message() }
    delete silent.text

    const alone = await send({ ...silent, pictures: [aScreenshot()] }, cookie)
    expect(alone.statusCode).toBe(201)
    const [row] = await db.select().from(feedback)
    expect(row).toMatchObject({ text: '', pictures: 1 })

    const nothing = await send({ ...message(), text: undefined }, cookie)
    expect(nothing.statusCode).toBe(400)
    expect(nothing.json()).toEqual({ code: ISSUE.TEXT_NOT_VISIBLE, details: 'text' })
  })

  it('не JPEG и стороны вне пределов — 415, текст и другие снимки не записаны', async () => {
    const cookie = await signIn(db, await insertActor(db))
    const png = Buffer.from('\x89PNG\r\n\x1a\n0000', 'latin1').toString('base64')

    for (const odd of [png, aScreenshot(99, 500), aScreenshot(149, 3000)]) {
      const reply = await send(message({ pictures: [aScreenshot(), odd] }), cookie)
      expect(reply.statusCode).toBe(415)
      expect(reply.json()).toEqual({ code: ERROR.FEEDBACK_PICTURE_INVALID })
    }
    expect(await db.select().from(feedback)).toHaveLength(0)
  })

  it('снимок больше двух мегабайт — 413 своим кодом', async () => {
    const cookie = await signIn(db, await insertActor(db))
    const heavy = Buffer.concat([
      Buffer.from(aScreenshot(), 'base64'),
      Buffer.alloc(FEEDBACK_PICTURE_BYTES_MAX),
    ]).toString('base64')

    const reply = await send(message({ pictures: [heavy] }), cookie)

    expect(reply.statusCode).toBe(413)
    expect(reply.json()).toEqual({ code: ERROR.FEEDBACK_PICTURE_TOO_LARGE })
  })

  it('тело больше предела — 413 по длине, не читая; другие маршруты держат мегабайт', async () => {
    const cookie = await signIn(db, await insertActor(db))
    const payload = JSON.stringify(message({ text: 'а'.repeat(FEEDBACK_BODY_BYTES_MAX) }))

    const reply = await app.inject({
      method: 'POST',
      url: '/feedback',
      payload,
      headers: { cookie, 'content-type': 'application/json' },
    })

    expect(reply.statusCode).toBe(413)
    expect(reply.json()).toEqual({ code: ERROR.FEEDBACK_PICTURE_TOO_LARGE })
    // Three pictures at their limit fit; the rest of the API keeps Fastify's megabyte.
    const settings = await app.inject({
      method: 'PUT',
      url: '/actors/me/settings',
      payload: JSON.stringify({ note: 'а'.repeat(2 * 1024 * 1024) }),
      headers: { cookie, 'content-type': 'application/json' },
    })
    expect(settings.statusCode).toBe(413)
  })

  it('повтор с теми же снимками — та же запись; другой снимок или без него под тем же ключом — 409', async () => {
    const cookie = await signIn(db, await insertActor(db))
    const body = message({ pictures: [aScreenshot(1179, 2556, { gps: true })] })

    const first = await send(body, cookie)
    // The same picture with its metadata stripped again is the same picture.
    const again = await send(body, cookie)
    expect(again.statusCode).toBe(200)
    expect(again.json()).toEqual(first.json())

    const other = await send({ ...body, pictures: [aScreenshot(1179, 2556, { seed: 5 })] }, cookie)
    expect(other.statusCode).toBe(409)
    const without = await send({ ...body, pictures: undefined }, cookie)
    expect(without.statusCode).toBe(409)
    expect(await db.select().from(feedbackPictures)).toHaveLength(1)
  })

  it('стирание человека уносит снимки', async () => {
    const anna = await insertActor(db)
    const boris = await insertActor(db)
    await send(message({ pictures: [aScreenshot()] }), await signIn(db, anna))
    await send(message({ pictures: [aScreenshot()] }), await signIn(db, boris))
    const [annas] = await db
      .select({ telegram: actors.telegramUserId })
      .from(actors)
      .where(eq(actors.id, anna))

    await createErasureRepository(db).erase(annas?.telegram ?? 0, { dryRun: false })

    const left = await db
      .select()
      .from(feedbackPictures)
      .innerJoin(feedback, eq(feedback.id, feedbackPictures.feedbackId))
    expect(left.map((row) => row.feedback.actorId)).toEqual([boris])
  })

  it('байты, не забранные ботом за неделю, стираются; строка снимка остаётся', async () => {
    const cookie = await signIn(db, await insertActor(db))
    const old = (await send(message({ pictures: [aScreenshot()] }), cookie)).json<{
      number: number
    }>()
    const fresh = (await send(message({ pictures: [aScreenshot()] }), cookie)).json<{
      number: number
    }>()
    await db
      .update(feedbackPictureFiles)
      .set({ createdAt: new Date(Date.now() - 7 * 24 * 3_600_000 - 60_000) })
      .where(eq(feedbackPictureFiles.feedbackId, old.number))

    await createFeedbackRepository(db).forgetPictures()

    expect(await filesOf(old.number)).toHaveLength(0)
    expect(await filesOf(fresh.number)).toHaveLength(1)
    // The line stays, never said to have gone (adversarial А4).
    const [line] = await picturesOf(old.number)
    expect(line).toMatchObject({ fingerprint: expect.any(String) as unknown, sentAt: null })
  })

  it('база держит «слова или снимок» и место снимка сама', async () => {
    const anna = await insertActor(db)
    const silent = db.insert(feedback).values({
      actorId: anna,
      kind: 'bug',
      text: '',
      locale: 'ru',
      apiBuild: 'dev',
    })
    expect(await refusedBy(silent)).toBe('feedback_says_something')
    const id = await aMessage(anna, new Date())
    const picture = (position: number, extra: Record<string, unknown> = {}) =>
      db.insert(feedbackPictures).values({
        feedbackId: id,
        position,
        source: 'phone',
        fingerprint: 'x',
        width: 10,
        height: 10,
        ...extra,
      })
    expect(await refusedBy(picture(4))).toBe('feedback_pictures_position_range')
    await picture(1)
    const file = (values: Record<string, unknown>) =>
      db.insert(feedbackPictureFiles).values({ feedbackId: id, position: 1, ...values })
    expect(await refusedBy(file({ image: Buffer.from([1]), telegramFileId: 'Ag' }))).toBe(
      'feedback_picture_files_one_source',
    )
    expect(await refusedBy(file({}))).toBe('feedback_picture_files_one_source')
    expect(
      await refusedBy(
        db
          .insert(feedbackPictureFiles)
          .values({ feedbackId: id, position: 2, telegramFileId: 'A' }),
      ),
    ).toBe('feedback_picture_files_line')
  })
})

describe('тела со снимками считаются до чтения (адверсариальное А3)', () => {
  it(`${String(FEEDBACK_HEAVY_DAY_LIMIT)} в сутки, дальше — 429 без разбора; лёгкое сообщение и другой человек — как раньше`, async () => {
    const cookie = await signIn(db, await insertActor(db))
    // Not a picture: refused at once (415), yet more than a megabyte to read.
    const heavy = message({ pictures: [Buffer.alloc(800 * 1024).toString('base64')] })

    for (let i = 0; i < FEEDBACK_HEAVY_DAY_LIMIT; i++) {
      expect((await send(heavy, cookie)).statusCode).toBe(415)
    }
    const started = performance.now()
    const past = await send(heavy, cookie)
    expect(past.statusCode).toBe(429)
    expect(past.json()).toEqual({ code: ERROR.FEEDBACK_RATE_LIMITED })
    expect(performance.now() - started).toBeLessThan(200)

    expect((await send(message(), cookie)).statusCode).toBe(201)
    const other = await signIn(db, await insertActor(db))
    expect((await send(heavy, other)).statusCode).toBe(415)
  })
})
