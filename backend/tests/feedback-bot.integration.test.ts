import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { ownerNoticesSchema } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createErasureRepository } from '@/db/erasure-repository'
import { createFeedbackRepository } from '@/db/feedback-repository'
import { createOwnerNoticeRepository } from '@/db/owner-notices-repository'
import { actors, feedback, feedbackReplies, ownerNotices } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'

// MOL-148: the bot's half of «Написать разработчику» — the owner's notice, the reply, a thread
// continued — through a real server and a real Postgres.

const { db, close } = connectDrizzle()

const OWNER = 4242
const botSecret = randomBytes(32).toString('base64url')
const asBot = { authorization: `Bearer ${botSecret}` }

const servers: FastifyInstance[] = []

async function serverFor(owner: number | null): Promise<FastifyInstance> {
  const app = buildServer({ db, owner, login: { username: 'molvia_bot', botSecret } })
  await app.ready()
  servers.push(app)
  return app
}

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await Promise.all(servers.map(async (app) => app.close()))
  await clearAll(db)
  await close()
})

function message(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'bug',
    text: 'Список «Что брать» не грузится',
    locale: 'ru',
    pageBuild: 'v0.1.3-29-g873189fd',
    route: 'advice',
    platform: 'ios 18 app',
    fromError: true,
    errorCode: 'issue.response_invalid',
    clientKey: randomUUID(),
    ...overrides,
  }
}

async function send(app: FastifyInstance, cookie: string, body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/feedback', payload: body, headers: { cookie } })
}

async function telegramOf(actorId: string) {
  const [row] = await db
    .select({ telegram: actors.telegramUserId })
    .from(actors)
    .where(eq(actors.id, actorId))
  if (row === undefined) throw new Error('no actor')
  return row.telegram
}

describe('сообщение из приложения — уведомлением владельцу (MOL-148, Р-6)', () => {
  it('новое сообщение ставит одно уведомление с номером нити, всем приложенным и без человека', async () => {
    const app = await serverFor(OWNER)
    const anna = await insertActor(db)
    const body = message()

    const sent = await send(app, await signIn(db, anna), body)

    expect(sent.statusCode).toBe(201)
    const { number } = sent.json<{ number: number }>()
    const queued = await db.select().from(ownerNotices)
    expect(queued).toHaveLength(1)
    expect(queued[0]?.kind).toBe('feedback')
    expect(queued[0]?.feedbackId).toBe(number)
    expect(queued[0]?.payload).toEqual({
      kind: 'feedback',
      number,
      thread: number,
      feedbackKind: 'bug',
      text: body.text,
      locale: 'ru',
      pageBuild: body.pageBuild,
      apiBuild: expect.any(String) as string,
      route: 'advice',
      platform: 'ios 18 app',
      fromError: true,
      errorCode: 'issue.response_invalid',
      at: expect.any(String) as string,
    })
    // Nothing of the person: the copy stays in the owner's chat for good (В-3 of MOL-150).
    const words = JSON.stringify(queued[0]?.payload)
    expect(words).not.toContain(anna)
    expect(words).not.toContain(String(await telegramOf(anna)))
  })

  it('повтор того же сообщения второго уведомления не ставит', async () => {
    const app = await serverFor(OWNER)
    const cookie = await signIn(db, await insertActor(db))
    const body = message()

    expect((await send(app, cookie, body)).statusCode).toBe(201)
    expect((await send(app, cookie, body)).statusCode).toBe(200)

    expect(await db.select().from(ownerNotices)).toHaveLength(1)
  })

  it('без владельца — в копиях и e2e — не ставит ничего', async () => {
    const app = await serverFor(null)
    const cookie = await signIn(db, await insertActor(db))

    expect((await send(app, cookie, message())).statusCode).toBe(201)

    expect(await db.select().from(feedback)).toHaveLength(1)
    expect(await db.select().from(ownerNotices)).toHaveLength(0)
  })

  it('бот получает его через claim — контракт читает новый вид', async () => {
    const app = await serverFor(OWNER)
    await send(app, await signIn(db, await insertActor(db)), message({ kind: 'idea' }))

    const claim = await app.inject({
      method: 'POST',
      url: '/internal/owner/claim',
      headers: asBot,
    })

    expect(claim.statusCode).toBe(200)
    const { to, notices } = ownerNoticesSchema.parse(claim.json())
    expect(to).toBe(OWNER)
    expect(notices).toMatchObject([{ kind: 'feedback', feedbackKind: 'idea' }])
  })

  it('стирание человека уносит и уведомление — выданное тоже', async () => {
    const app = await serverFor(OWNER)
    const anna = await insertActor(db)
    const boris = await insertActor(db)
    await send(app, await signIn(db, anna), message())
    await send(app, await signIn(db, boris), message())
    await app.inject({ method: 'POST', url: '/internal/owner/claim', headers: asBot })
    await send(app, await signIn(db, anna), message({ text: 'и ещё' }))

    await createErasureRepository(db).erase(await telegramOf(anna), { dryRun: false })

    const left = await db.select({ payload: ownerNotices.payload }).from(ownerNotices)
    expect(left).toHaveLength(1)
    const [borises] = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.actorId, boris))
    expect(left[0]?.payload).toMatchObject({ thread: borises?.id })
  })

  it('годовой срок нити уносит и её уведомление', async () => {
    const app = await serverFor(OWNER)
    const anna = await insertActor(db)
    await send(app, await signIn(db, anna), message())
    await db
      .update(feedback)
      .set({ createdAt: new Date(Date.now() - 400 * 86_400_000) })
      .where(eq(feedback.actorId, anna))

    await createFeedbackRepository(db).purgeStale()

    expect(await db.select().from(ownerNotices)).toHaveLength(0)
  })

  it('невыданное уведомление о сообщении сутками не выбрасывается — его ждут', async () => {
    const app = await serverFor(OWNER)
    await send(app, await signIn(db, await insertActor(db)), message())
    await db.update(ownerNotices).set({ createdAt: new Date(Date.now() - 3 * 86_400_000) })

    await createOwnerNoticeRepository(db).purgeStale(new Date())

    expect(await db.select().from(ownerNotices)).toHaveLength(1)
  })

  it('уведомление о сообщении без feedback_id база не примет, о сбое — с ним', async () => {
    const app = await serverFor(null)
    const sent = await send(app, await signIn(db, await insertActor(db)), message())
    const { number } = sent.json<{ number: number }>()
    const at = new Date()
    const write = async (kind: 'feedback' | 'failure', feedbackId: number | null) =>
      db
        .insert(ownerNotices)
        .values({ kind, payload: { kind }, feedbackId, createdAt: at })
        .then(
          () => 'written',
          (error: unknown) =>
            (error as { cause?: { constraint_name?: string } }).cause?.constraint_name,
        )

    expect(await write('feedback', null)).toBe('owner_notices_feedback_named')
    expect(await write('failure', number)).toBe('owner_notices_feedback_named')
  })
})

async function fromBot(app: FastifyInstance, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/internal/feedback/reply',
    payload: body,
    headers: asBot,
  })
}

async function delivered(app: FastifyInstance, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/internal/feedback/delivered',
    payload: body,
    headers: asBot,
  })
}

/** A person with a message written from the app: their Telegram id and the thread's number. */
async function aThread(app: FastifyInstance, text = 'Не грузится «Что брать»') {
  const actorId = await insertActor(db)
  const sent = await send(app, await signIn(db, actorId), message({ text }))
  const { number } = sent.json<{ number: number }>()
  return { actorId, telegram: await telegramOf(actorId), thread: number }
}

/** The owner's reply to `thread`, sent to the person as message `messageId` of their chat. */
async function answer(app: FastifyInstance, thread: number, messageId: number, text = 'Починили') {
  const reply = await fromBot(app, {
    telegramUserId: OWNER,
    repliedMessageId: 900,
    thread,
    text,
  })
  expect(reply.statusCode).toBe(200)
  const written = reply.json<{ outcome: string; reply: number }>()
  expect(written.outcome).toBe('answered')
  expect(
    (await delivered(app, { reply: written.reply, outcome: 'sent', messageId })).statusCode,
  ).toBe(204)
  return written.reply
}

describe('ответ владельца (MOL-148, Р-2, Р-3, Р-11)', () => {
  it('владелец отвечает на метку — ответ записан под сообщением, бот знает кому и на каком языке', async () => {
    const app = await serverFor(OWNER)
    const anna = await insertActor(db)
    const sent = await send(app, await signIn(db, anna), message({ locale: 'en' }))
    const { number } = sent.json<{ number: number }>()

    const reply = await fromBot(app, {
      telegramUserId: OWNER,
      repliedMessageId: 500,
      thread: number,
      text: '  Починили, обновите  ',
    })

    expect(reply.statusCode).toBe(200)
    expect(reply.json()).toEqual({
      outcome: 'answered',
      reply: expect.any(Number) as number,
      to: await telegramOf(anna),
      locale: 'en',
      day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
    })
    const [row] = await db.select().from(feedbackReplies)
    expect(row).toMatchObject({ feedbackId: number, actorId: anna, text: 'Починили, обновите' })
    expect(row?.delivered).toBeNull()
  })

  it('не владелец с той же меткой ничего не пишет и ничего не получает — 404', async () => {
    const app = await serverFor(OWNER)
    const { thread } = await aThread(app)
    const stranger = await telegramOf(await insertActor(db))

    const reply = await fromBot(app, {
      telegramUserId: stranger,
      repliedMessageId: 2,
      thread,
      text: 'Подделка',
    })

    expect(reply.statusCode).toBe(404)
    expect(await db.select().from(feedbackReplies)).toHaveLength(0)
  })

  it('без владельца в окружении (копии) ответа нет ни у кого', async () => {
    const app = await serverFor(null)
    const { thread } = await aThread(app)

    const reply = await fromBot(app, {
      telegramUserId: OWNER,
      repliedMessageId: 2,
      thread,
      text: 'Ответ',
    })

    expect(reply.statusCode).toBe(404)
  })

  it('стёртый автор — gone, ничего не записано', async () => {
    const app = await serverFor(OWNER)
    const { telegram, thread } = await aThread(app)
    await createErasureRepository(db).erase(telegram, { dryRun: false })

    const reply = await fromBot(app, {
      telegramUserId: OWNER,
      repliedMessageId: 2,
      thread,
      text: 'Ответ',
    })

    expect(reply.json()).toEqual({ outcome: 'gone', thread })
    expect(await db.select().from(feedbackReplies)).toHaveLength(0)
  })

  it('срок нити вышел — gone', async () => {
    const app = await serverFor(OWNER)
    const { actorId, thread } = await aThread(app)
    await db
      .update(feedback)
      .set({ createdAt: new Date(Date.now() - 400 * 86_400_000) })
      .where(eq(feedback.actorId, actorId))
    await createFeedbackRepository(db).purgeStale()

    const reply = await fromBot(app, {
      telegramUserId: OWNER,
      repliedMessageId: 2,
      thread,
      text: 'Ответ',
    })

    expect(reply.json()).toEqual({ outcome: 'gone', thread })
  })

  it('метка на продолжение, а не на первое сообщение, — gone: нить зовётся первым', async () => {
    const app = await serverFor(OWNER)
    const { telegram, thread } = await aThread(app)
    await answer(app, thread, 9031)
    await fromBot(app, {
      telegramUserId: telegram,
      repliedMessageId: 9031,
      thread: null,
      text: 'Спасибо',
    })
    const [continued] = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.threadId, thread))

    const reply = await fromBot(app, {
      telegramUserId: OWNER,
      repliedMessageId: 2,
      thread: continued?.id,
      text: 'Ответ',
    })

    expect(reply.json()).toEqual({ outcome: 'gone', thread: continued?.id })
  })

  it('длиннее 3500 — too_long, ничего не записано', async () => {
    const app = await serverFor(OWNER)
    const { thread } = await aThread(app)

    const reply = await fromBot(app, {
      telegramUserId: OWNER,
      repliedMessageId: 2,
      thread,
      text: 'а'.repeat(3501),
    })

    expect(reply.json()).toEqual({ outcome: 'too_long', max: 3500 })
    expect(await db.select().from(feedbackReplies)).toHaveLength(0)
  })

  it('исход отправки: sent с id сообщения, blocked без; отмеченный не переписывается', async () => {
    const app = await serverFor(OWNER)
    const first = await aThread(app)
    const second = await aThread(app)
    const sentReply = await answer(app, first.thread, 9031)
    const blocked = await fromBot(app, {
      telegramUserId: OWNER,
      repliedMessageId: 1,
      thread: second.thread,
      text: 'Ответ',
    })
    const blockedReply = blocked.json<{ reply: number }>().reply

    await delivered(app, { reply: blockedReply, outcome: 'blocked' })
    await delivered(app, { reply: sentReply, outcome: 'blocked' })

    const rows = await db
      .select({
        id: feedbackReplies.id,
        delivered: feedbackReplies.delivered,
        message: feedbackReplies.telegramMessageId,
      })
      .from(feedbackReplies)
    expect(rows.sort((a, b) => a.id - b.id)).toEqual([
      { id: sentReply, delivered: 'sent', message: 9031 },
      { id: blockedReply, delivered: 'blocked', message: null },
    ])
  })
})

describe('продолжение нити (MOL-148, В-1 MOL-150, В-2)', () => {
  it('ответ человека на присланный ответ — продолжение с thread_id первого и in_reply_to ответа', async () => {
    const app = await serverFor(OWNER)
    const { actorId, telegram, thread } = await aThread(app)
    const reply = await answer(app, thread, 9031, 'Починили, обновите приложение')
    await app.inject({ method: 'POST', url: '/internal/owner/claim', headers: asBot })

    const word = await fromBot(app, {
      telegramUserId: telegram,
      repliedMessageId: 9031,
      thread: null,
      text: 'Обновил, работает',
    })

    expect(word.json()).toEqual({ outcome: 'continued' })
    const [continued] = await db.select().from(feedback).where(eq(feedback.threadId, thread))
    expect(continued).toMatchObject({
      actorId,
      kind: 'bug',
      locale: 'ru',
      text: 'Обновил, работает',
      inReplyTo: reply,
      route: null,
      platform: null,
      pageBuild: null,
      fromError: false,
      errorCode: null,
    })
    const claim = await app.inject({
      method: 'POST',
      url: '/internal/owner/claim',
      headers: asBot,
    })
    expect(ownerNoticesSchema.parse(claim.json()).notices).toEqual([
      {
        kind: 'feedback_continued',
        number: continued?.id,
        thread,
        quote: 'Починили, обновите приложение',
        text: 'Обновил, работает',
        at: expect.any(String) as string,
      },
    ])
  })

  it('ответ владельца на продолжение ложится под продолжение, «от» — его день', async () => {
    const app = await serverFor(OWNER)
    const { telegram, thread } = await aThread(app)
    await answer(app, thread, 9031)
    await fromBot(app, {
      telegramUserId: telegram,
      repliedMessageId: 9031,
      thread: null,
      text: 'Всё равно не грузится',
    })
    const [continued] = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.threadId, thread))

    const second = await answer(app, thread, 9040, 'Теперь точно')

    const [row] = await db
      .select({ feedbackId: feedbackReplies.feedbackId })
      .from(feedbackReplies)
      .where(eq(feedbackReplies.id, second))
    expect(row?.feedbackId).toBe(continued?.id)
  })

  it('тот же апдейт Telegram дважды — одна строка и одно уведомление', async () => {
    const app = await serverFor(OWNER)
    const { telegram, thread } = await aThread(app)
    await answer(app, thread, 9031)
    const word = {
      telegramUserId: telegram,
      repliedMessageId: 9031,
      thread: null,
      text: 'Спасибо',
    }

    expect((await fromBot(app, word)).json()).toEqual({ outcome: 'continued' })
    expect((await fromBot(app, word)).json()).toEqual({ outcome: 'continued' })

    expect(await db.select().from(feedback).where(eq(feedback.threadId, thread))).toHaveLength(1)
    const continuedNotices = await db
      .select()
      .from(ownerNotices)
      .where(eq(ownerNotices.kind, 'feedback_continued'))
    expect(continuedNotices).toHaveLength(1)
  })

  it('чужая нить — 404: id сообщения в другом чате не открывает ответ', async () => {
    const app = await serverFor(OWNER)
    const { thread } = await aThread(app)
    await answer(app, thread, 9031)
    const boris = await telegramOf(await insertActor(db))

    const word = await fromBot(app, {
      telegramUserId: boris,
      repliedMessageId: 9031,
      thread: null,
      text: 'Чужое',
    })

    expect(word.statusCode).toBe(404)
    expect(await db.select().from(feedback).where(eq(feedback.threadId, thread))).toHaveLength(0)
  })

  it('ответ на сообщение бота, которое не ответ (напоминание), — 404, к приветствию', async () => {
    const app = await serverFor(OWNER)
    const { telegram } = await aThread(app)

    const word = await fromBot(app, {
      telegramUserId: telegram,
      repliedMessageId: 76,
      thread: null,
      text: 'Привет',
    })

    expect(word.statusCode).toBe(404)
  })

  it('предел общий с формой: девять из приложения, десятое — продолжение, одиннадцатое — limited', async () => {
    const app = await serverFor(OWNER)
    const { actorId, telegram, thread } = await aThread(app)
    const cookie = await signIn(db, actorId)
    for (let index = 0; index < 8; index += 1) {
      expect((await send(app, cookie, message({ text: `раз ${String(index)}` }))).statusCode).toBe(
        201,
      )
    }
    await answer(app, thread, 9031)
    const word = (count: number) =>
      fromBot(app, {
        telegramUserId: telegram,
        repliedMessageId: 9031,
        thread: null,
        text: `слово ${String(count)}`,
      })

    expect((await word(9032)).json()).toEqual({ outcome: 'continued' })
    expect((await word(9033)).json()).toEqual({ outcome: 'limited' })
    expect((await send(app, cookie, message({ text: 'ещё' }))).statusCode).toBe(429)
  })

  it('длиннее 2000 — too_long; пустые строки подряд — invisible; ничего не записано', async () => {
    const app = await serverFor(OWNER)
    const { telegram, thread } = await aThread(app)
    await answer(app, thread, 9031)
    const word = (text: string) =>
      fromBot(app, {
        telegramUserId: telegram,
        repliedMessageId: 9031,
        thread: null,
        text,
      })

    expect((await word('а'.repeat(2001))).json()).toEqual({ outcome: 'too_long', max: 2000 })
    expect((await word('да\n\n\nнет')).json()).toEqual({ outcome: 'invisible' })
    expect(await db.select().from(feedback).where(eq(feedback.threadId, thread))).toHaveLength(0)
  })

  it('без отметки об отправке ответить на сообщение нельзя — 404 (названная цена)', async () => {
    const app = await serverFor(OWNER)
    const { telegram, thread } = await aThread(app)
    await fromBot(app, {
      telegramUserId: OWNER,
      repliedMessageId: 2,
      thread,
      text: 'Ответ',
    })

    const word = await fromBot(app, {
      telegramUserId: telegram,
      repliedMessageId: 9031,
      thread: null,
      text: 'Спасибо',
    })

    expect(word.statusCode).toBe(404)
  })

  it('стирание человека уносит и ответы, и продолжения, и их уведомления', async () => {
    const app = await serverFor(OWNER)
    const { telegram, thread } = await aThread(app)
    await answer(app, thread, 9031)
    await fromBot(app, {
      telegramUserId: telegram,
      repliedMessageId: 9031,
      thread: null,
      text: 'Ещё',
    })

    await createErasureRepository(db).erase(telegram, { dryRun: false })

    expect(await db.select().from(feedback)).toHaveLength(0)
    expect(await db.select().from(feedbackReplies)).toHaveLength(0)
    expect(await db.select().from(ownerNotices)).toHaveLength(0)
  })

  it('без секрета бота — 401, ничего не записано', async () => {
    const app = await serverFor(OWNER)
    const { thread } = await aThread(app)

    const reply = await app.inject({
      method: 'POST',
      url: '/internal/feedback/reply',
      payload: { telegramUserId: OWNER, repliedMessageId: 2, thread, text: 'Ответ' },
    })

    expect(reply.statusCode).toBe(401)
    expect(await db.select().from(feedbackReplies)).toHaveLength(0)
  })
})

describe('уведомление о сообщении выдаётся, пока бот не скажет, что оно ушло (MOL-148, адверсариальное В1)', () => {
  const MINUTE = 60_000

  it('не отправленное — снова через десять минут; отправленное — больше нет', async () => {
    const app = await serverFor(OWNER)
    const { thread } = await aThread(app)
    const notices = createOwnerNoticeRepository(db)
    const now = Date.now()

    expect(await notices.claim(20, new Date(now))).toMatchObject([{ number: thread }])
    expect(await notices.claim(20, new Date(now + 9 * MINUTE))).toEqual([])
    expect(await notices.claim(20, new Date(now + 11 * MINUTE))).toMatchObject([{ number: thread }])

    const sent = await app.inject({
      method: 'POST',
      url: '/internal/owner/sent',
      payload: { messages: [thread] },
      headers: asBot,
    })
    expect(sent.statusCode).toBe(204)
    expect(await notices.claim(20, new Date(now + 60 * MINUTE))).toEqual([])
  })

  it('пауза удваивается: 10, 20, 40… минут, восемь выдач за сутки, потом — нет (раунд 2, Г2)', async () => {
    const app = await serverFor(OWNER)
    await aThread(app)
    const notices = createOwnerNoticeRepository(db)
    const start = Date.now()
    const at = (minutes: number) => new Date(start + minutes * MINUTE)

    expect(await notices.claim(20, at(0))).toHaveLength(1)
    let last = 0
    for (const pause of [10, 20, 40, 80, 160, 320, 640]) {
      expect(await notices.claim(20, at(last + pause - 1))).toEqual([])
      expect(await notices.claim(20, at(last + pause + 1))).toHaveLength(1)
      last += pause + 1
    }
    expect(await notices.claim(20, at(last + 100_000))).toEqual([])
    const [row] = await db.select({ tries: ownerNotices.tries }).from(ownerNotices)
    expect(row?.tries).toBe(8)
  })

  it('уведомление о сбое по-прежнему выдаётся один раз', async () => {
    await serverFor(OWNER)
    const notices = createOwnerNoticeRepository(db)
    const now = Date.now()
    await db.insert(ownerNotices).values({
      kind: 'failure',
      payload: {
        kind: 'failure',
        source: 'api',
        errorName: 'TypeError',
        build: 'dev',
        fingerprint: 'abcdef',
      },
      createdAt: new Date(now),
    })

    expect(await notices.claim(20, new Date(now))).toHaveLength(1)
    expect(await notices.claim(20, new Date(now + 60 * MINUTE))).toEqual([])
  })

  it('продолжение тоже: его номер — его собственный, не нити', async () => {
    const app = await serverFor(OWNER)
    const { telegram, thread } = await aThread(app)
    await answer(app, thread, 9031)
    const notices = createOwnerNoticeRepository(db)
    await notices.claim(20, new Date())
    await notices.markSent([thread], new Date())
    await fromBot(app, {
      telegramUserId: telegram,
      repliedMessageId: 9031,
      thread: null,
      text: 'Спасибо',
    })
    const [continued] = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.threadId, thread))
    const now = Date.now()

    expect(await notices.claim(20, new Date(now))).toMatchObject([
      { kind: 'feedback_continued', number: continued?.id, thread },
    ])
    await notices.markSent([continued?.id ?? 0], new Date(now))
    expect(await notices.claim(20, new Date(now + 60 * MINUTE))).toEqual([])
  })
})

describe('то же слово после «ответьте ещё раз» — та же запись (адверсариальное В3)', () => {
  it('два сообщения Telegram с одним текстом на один ответ — одна строка и одно уведомление', async () => {
    const app = await serverFor(OWNER)
    const { telegram, thread } = await aThread(app)
    await answer(app, thread, 9031)
    const word = (text: string) =>
      fromBot(app, { telegramUserId: telegram, repliedMessageId: 9031, thread: null, text })

    expect((await word('Всё ещё не грузится')).json()).toEqual({ outcome: 'continued' })
    expect((await word('  Всё ещё не грузится ')).json()).toEqual({ outcome: 'continued' })
    expect((await word('А теперь грузится')).json()).toEqual({ outcome: 'continued' })

    const words = await db
      .select({ text: feedback.text })
      .from(feedback)
      .where(eq(feedback.threadId, thread))
    expect(words.map((row) => row.text)).toEqual(['Всё ещё не грузится', 'А теперь грузится'])
    expect(
      await db.select().from(ownerNotices).where(eq(ownerNotices.kind, 'feedback_continued')),
    ).toHaveLength(2)
  })
})

describe('Telegram не принял ответ — failed (адверсариальное В4)', () => {
  it('исход failed записан, id сообщения нет; ответ, который никуда не ушёл, не продлевает нить', async () => {
    const app = await serverFor(OWNER)
    const { actorId, thread } = await aThread(app)
    const reply = await fromBot(app, {
      telegramUserId: OWNER,
      repliedMessageId: 2,
      thread,
      text: 'Ответ',
    })
    const { reply: replyId } = reply.json<{ reply: number }>()

    expect((await delivered(app, { reply: replyId, outcome: 'failed' })).statusCode).toBe(204)
    const [row] = await db.select().from(feedbackReplies)
    expect(row).toMatchObject({ delivered: 'failed', telegramMessageId: null })

    await db
      .update(feedback)
      .set({ createdAt: new Date(Date.now() - 400 * 86_400_000) })
      .where(eq(feedback.actorId, actorId))
    await createFeedbackRepository(db).purgeStale()
    expect(await db.select().from(feedback)).toHaveLength(0)
  })
})

describe('ответ знает свою нить (адверсариальное В5)', () => {
  it('ответ на продолжение записан с нитью первого сообщения', async () => {
    const app = await serverFor(OWNER)
    const { telegram, thread } = await aThread(app)
    await answer(app, thread, 9031)
    await fromBot(app, {
      telegramUserId: telegram,
      repliedMessageId: 9031,
      thread: null,
      text: 'Ещё',
    })

    await answer(app, thread, 9040, 'Второй ответ')

    const rows = await db.select({ thread: feedbackReplies.threadId }).from(feedbackReplies)
    expect(rows.map((row) => row.thread)).toEqual([thread, thread])
  })
})

describe('то же слово на тот же ответ позже суток — новое слово (раунд 2, Г1)', () => {
  it('«Не работает» через три дня снова записано и снова у владельца; в те же сутки — повтор', async () => {
    const app = await serverFor(OWNER)
    const { telegram, thread } = await aThread(app)
    await answer(app, thread, 9031)
    const word = () =>
      fromBot(app, {
        telegramUserId: telegram,
        repliedMessageId: 9031,
        thread: null,
        text: 'Не работает',
      })

    expect((await word()).json()).toEqual({ outcome: 'continued' })
    expect((await word()).json()).toEqual({ outcome: 'continued' })
    expect(await db.select().from(feedback).where(eq(feedback.threadId, thread))).toHaveLength(1)

    await db
      .update(feedback)
      .set({ createdAt: new Date(Date.now() - 3 * 86_400_000) })
      .where(eq(feedback.threadId, thread))
    expect((await word()).json()).toEqual({ outcome: 'continued' })

    expect(await db.select().from(feedback).where(eq(feedback.threadId, thread))).toHaveLength(2)
    expect(
      await db.select().from(ownerNotices).where(eq(ownerNotices.kind, 'feedback_continued')),
    ).toHaveLength(2)
  })

  it('то же слово на другой ответ той же нити — новое слово', async () => {
    const app = await serverFor(OWNER)
    const { telegram, thread } = await aThread(app)
    await answer(app, thread, 9031)
    await answer(app, thread, 9040, 'Ещё раз')
    for (const replied of [9031, 9040]) {
      await fromBot(app, {
        telegramUserId: telegram,
        repliedMessageId: replied,
        thread: null,
        text: 'Ок',
      })
    }

    expect(await db.select().from(feedback).where(eq(feedback.threadId, thread))).toHaveLength(2)
  })
})
