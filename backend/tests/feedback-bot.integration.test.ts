import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { ownerNoticesSchema } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createErasureRepository } from '@/db/erasure-repository'
import { createFeedbackRepository } from '@/db/feedback-repository'
import { createOwnerNoticeRepository } from '@/db/owner-notices-repository'
import { actors, feedback, ownerNotices } from '@/db/schema'
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
