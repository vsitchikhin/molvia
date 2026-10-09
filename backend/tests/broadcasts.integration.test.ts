import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { dueBroadcastSchema } from '@molvia/model'
import { createBroadcastRepository } from '@/db/broadcasts-repository'
import type { BroadcastAudience } from '@/db/broadcasts-repository'
import { createErasureRepository } from '@/db/erasure-repository'
import { BROADCAST_START, actors, broadcasts } from '@/db/schema'
import { buildServer } from '@/server'
import { connect, connectDrizzle } from './db'
import { clearAll, insertActor, telegramId } from './fixtures'

// The message to people about a leak (MOL-237): queued by `make notify`, handed to the bot in
// batches after a cursor, the cursor moved only by the bot's word — better twice than never.

const { db, close } = connectDrizzle()
const broadcastsOf = createBroadcastRepository(db)
const EVERYBODY: BroadcastAudience = { to: 'everybody' }
const TEXT = 'Molvia: тест.\n\nMolvia: a test.'

beforeEach(async () => {
  await clearAll(db)
})
afterAll(async () => {
  await clearAll(db)
  await close()
})

/** A person whose place in the order of `actors.id` is `n`. */
function idOf(n: number): string {
  return `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

async function person(
  n: number,
  patch: Partial<typeof actors.$inferInsert> = {},
): Promise<{ id: string; tg: number }> {
  const tg = telegramId()
  await insertActor(db, { id: idOf(n), telegramUserId: tg, ...patch })
  return { id: idOf(n), tg }
}

/**
 * Waits until `n` statements stand waiting for the broadcast's row, or `settled` says the one that
 * might have waited is done without it.
 */
async function waitingForRow(n: number, settled: () => boolean = () => false): Promise<void> {
  const watch = connect()
  try {
    for (let attempt = 0; attempt < 200 && !settled(); attempt += 1) {
      const [waiting] = await watch<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where wait_event_type = 'Lock' and query ilike '%broadcasts%'`
      if ((waiting?.n ?? 0) >= n) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (!settled()) throw new Error(`fewer than ${String(n)} statements waited for the row`)
  } finally {
    await watch.end()
  }
}

async function row() {
  const [stored] = await db.select().from(broadcasts)
  if (!stored) throw new Error('no broadcast')
  return stored
}

/** Everybody the bot would be handed, batch after batch, each reported as sent. */
async function drain(owner: number | null = null, limit = 2): Promise<number[]> {
  const handed: number[] = []
  for (;;) {
    const batch = await broadcastsOf.claim(owner, limit)
    if (!batch) return handed
    handed.push(...batch.recipients.map((recipient) => recipient.telegramUserId))
    const last = batch.recipients.at(-1)
    if (!last) throw new Error('an empty batch')
    await broadcastsOf.done({
      id: batch.id,
      through: last.position,
      sent: batch.recipients.length,
      blocked: 0,
      failed: 0,
    })
  }
}

describe('broadcasts — сколько получат', () => {
  it('по странам: получат и с заблокированным ботом; страна без людей — нулём', async () => {
    await person(1, { country: 'AM' })
    await person(2, { country: 'AM', botBlockedAt: new Date() })
    await person(3, { country: 'GE' })

    expect(await broadcastsOf.count(EVERYBODY)).toEqual([
      { country: 'AM', recipients: 1, blocked: 1 },
      { country: 'GE', recipients: 1, blocked: 0 },
    ])
    expect(await broadcastsOf.count({ to: 'countries', countries: ['GE', 'RS'] })).toEqual([
      { country: 'GE', recipients: 1, blocked: 0 },
      { country: 'RS', recipients: 0, blocked: 0 },
    ])
  })

  it('пробная — только владелец', async () => {
    const owner = await person(1)
    await person(2)
    expect(await broadcastsOf.count({ to: 'owner', owner: owner.tg })).toEqual([
      { country: 'AM', recipients: 1, blocked: 0 },
    ])
  })
})

describe('broadcasts — постановка', () => {
  it('пишет, сколько получат и скольких пропустит блокировка', async () => {
    await person(1)
    await person(2, { botBlockedAt: new Date() })
    const queued = await broadcastsOf.queue(TEXT, EVERYBODY)
    expect(queued).toMatchObject({ total: 1, blockedAtStart: 1 })
    expect(await row()).toMatchObject({ text: TEXT, countries: null, ownerOnly: false })
  })

  it('вторая, пока идёт первая, — отказ; пробная себе не мешает; после отмены — можно', async () => {
    const owner = await person(1)
    expect(await broadcastsOf.queue(TEXT, EVERYBODY)).toMatchObject({ total: 1 })
    expect(await broadcastsOf.queue(TEXT, EVERYBODY)).toBe('going')
    expect(await broadcastsOf.queue(TEXT, { to: 'countries', countries: ['AM'] })).toBe('going')
    expect(await broadcastsOf.queue(TEXT, { to: 'owner', owner: owner.tg })).toMatchObject({
      total: 1,
    })
    expect(await broadcastsOf.cancel()).toBe(2)
    expect(await broadcastsOf.queue(TEXT, EVERYBODY)).toMatchObject({ total: 1 })
  })

  it('две постановки одновременно — одна', async () => {
    await person(1)
    const both = await Promise.all([
      broadcastsOf.queue(TEXT, EVERYBODY),
      broadcastsOf.queue(TEXT, EVERYBODY),
    ])
    expect(both.filter((answer) => answer === 'going')).toHaveLength(1)
    expect(await db.select().from(broadcasts)).toHaveLength(1)
  })

  it('некому — ничего не поставлено', async () => {
    await person(1, { botBlockedAt: new Date() })
    expect(await broadcastsOf.queue(TEXT, EVERYBODY)).toBe('nobody')
    expect(await broadcastsOf.queue(TEXT, { to: 'countries', countries: ['RS'] })).toBe('nobody')
    expect(await db.select().from(broadcasts)).toEqual([])
  })

  it('после конца — можно снова', async () => {
    await person(1)
    await broadcastsOf.queue(TEXT, EVERYBODY)
    await drain()
    expect(await broadcastsOf.claim(null, 2)).toBeNull()
    expect(await broadcastsOf.queue(TEXT, EVERYBODY)).toMatchObject({ total: 1 })
  })
})

describe('broadcasts — раздача', () => {
  it('всем по порядку пачками, каждому один раз, и рассылка кончается', async () => {
    const people = await Promise.all([1, 2, 3, 4, 5].map((n) => person(n)))
    await broadcastsOf.queue(TEXT, EVERYBODY)

    expect(await drain(null, 2)).toEqual(people.map((one) => one.tg))
    expect(await row()).toMatchObject({ sent: 5, blocked: 0, failed: 0, leaseUntil: null })
    expect((await row()).finishedAt).not.toBeNull()
  })

  it('пачка в аренде не выдаётся второй раз, пока бот её шлёт', async () => {
    await person(1)
    await person(2)
    await broadcastsOf.queue(TEXT, EVERYBODY)
    expect(await broadcastsOf.claim(null, 1)).not.toBeNull()
    expect(await broadcastsOf.claim(null, 1)).toBeNull()
  })

  it('бот не отчитался — после аренды та же пачка снова: двойное лучше потерянного', async () => {
    const first = await person(1)
    await person(2)
    await broadcastsOf.queue(TEXT, EVERYBODY)
    const lost = await broadcastsOf.claim(null, 1)
    await db.update(broadcasts).set({ leaseUntil: sql`clock_timestamp() - interval '1 second'` })
    const again = await broadcastsOf.claim(null, 1)
    expect(again?.recipients).toEqual(lost?.recipients)
    expect(again?.recipients.map((recipient) => recipient.telegramUserId)).toEqual([first.tg])
  })

  it('слово «ничего не ушло» отпускает аренду, курсор и счётчики на месте', async () => {
    const first = await person(1)
    await person(2)
    await broadcastsOf.queue(TEXT, EVERYBODY)
    const batch = await broadcastsOf.claim(null, 2)
    expect(await broadcastsOf.claim(null, 2)).toBeNull()
    await broadcastsOf.done({ id: batch?.id ?? 0, through: null, sent: 0, blocked: 0, failed: 0 })
    expect(await row()).toMatchObject({ leaseUntil: null, cursor: BROADCAST_START, sent: 0 })
    const again = await broadcastsOf.claim(null, 2)
    expect(again?.recipients[0]?.telegramUserId).toBe(first.tg)
  })

  it('отчёт о части пачки (флуд) — остаток уходит следующей', async () => {
    const people = await Promise.all([1, 2, 3].map((n) => person(n)))
    await broadcastsOf.queue(TEXT, EVERYBODY)
    const batch = await broadcastsOf.claim(null, 3)
    await broadcastsOf.done({
      id: batch?.id ?? 0,
      through: idOf(1),
      sent: 1,
      blocked: 0,
      failed: 0,
    })
    const rest = await broadcastsOf.claim(null, 3)
    expect(rest?.recipients.map((recipient) => recipient.telegramUserId)).toEqual([
      people[1]?.tg,
      people[2]?.tg,
    ])
  })

  it('повторный или запоздалый отчёт ничего не меняет', async () => {
    await Promise.all([1, 2].map((n) => person(n)))
    await broadcastsOf.queue(TEXT, EVERYBODY)
    const batch = await broadcastsOf.claim(null, 2)
    const report = { id: batch?.id ?? 0, through: idOf(2), sent: 2, blocked: 0, failed: 0 }
    await broadcastsOf.done(report)
    await broadcastsOf.done(report)
    await broadcastsOf.done({ ...report, through: idOf(1), sent: 1 })
    expect(await row()).toMatchObject({ sent: 2, cursor: idOf(2) })
  })

  it('счётчики исходов складываются', async () => {
    await Promise.all([1, 2, 3].map((n) => person(n)))
    await broadcastsOf.queue(TEXT, EVERYBODY)
    const batch = await broadcastsOf.claim(null, 3)
    await broadcastsOf.done({
      id: batch?.id ?? 0,
      through: idOf(3),
      sent: 1,
      blocked: 1,
      failed: 1,
    })
    expect(await row()).toMatchObject({ sent: 1, blocked: 1, failed: 1 })
  })

  it('пришедший после постановки не получает; заблокировавший до своей очереди — пропущен', async () => {
    const early = await person(1)
    const blocker = await person(2)
    await broadcastsOf.queue(TEXT, EVERYBODY)
    await person(3)
    await db.update(actors).set({ botBlockedAt: new Date() }).where(eq(actors.id, blocker.id))
    expect(await drain()).toEqual([early.tg])
  })

  it('напоминания выключены человеком — сообщение об утечке всё равно идёт', async () => {
    const quiet = await person(1, { remindersOff: 'chosen', receiptNoticesOff: true })
    await broadcastsOf.queue(TEXT, EVERYBODY)
    expect(await drain()).toEqual([quiet.tg])
  })

  it('только своим странам', async () => {
    await person(1, { country: 'AM' })
    const georgian = await person(2, { country: 'GE' })
    const serbian = await person(3, { country: 'RS' })
    await broadcastsOf.queue(TEXT, { to: 'countries', countries: ['GE', 'RS'] })
    expect(await drain()).toEqual([georgian.tg, serbian.tg])
  })

  it('пробная — владельцу, и раньше рассылки всем', async () => {
    const owner = await person(2)
    const other = await person(1)
    await broadcastsOf.queue(TEXT, EVERYBODY)
    await broadcastsOf.queue(TEXT, { to: 'owner', owner: owner.tg })
    const first = await broadcastsOf.claim(owner.tg, 25)
    expect(first?.recipients.map((recipient) => recipient.telegramUserId)).toEqual([owner.tg])
    await broadcastsOf.done({
      id: first?.id ?? 0,
      through: owner.id,
      sent: 1,
      blocked: 0,
      failed: 0,
    })
    expect(await drain(owner.tg, 25)).toEqual([other.tg, owner.tg])
  })

  it('пробная без владельца в окружении — никому, и кончается', async () => {
    const owner = await person(1)
    await broadcastsOf.queue(TEXT, { to: 'owner', owner: owner.tg })
    expect(await broadcastsOf.claim(null, 25)).toBeNull()
    expect((await row()).finishedAt).not.toBeNull()
  })

  it('отменённая больше ничего не выдаёт', async () => {
    await Promise.all([1, 2].map((n) => person(n)))
    await broadcastsOf.queue(TEXT, EVERYBODY)
    const batch = await broadcastsOf.claim(null, 1)
    expect(await broadcastsOf.cancel()).toBe(1)
    await broadcastsOf.done({
      id: batch?.id ?? 0,
      through: idOf(1),
      sent: 1,
      blocked: 0,
      failed: 0,
    })
    expect(await broadcastsOf.claim(null, 1)).toBeNull()
    expect((await broadcastsOf.status(null))[0]).toMatchObject({ sent: 1, left: 1 })
  })
})

describe('broadcasts — удаление человека не оставляет его id', () => {
  const erasure = createErasureRepository(db)

  it('стёрт тот, на ком курсор, — курсор на ближайшем живом ниже, следующие не потеряны', async () => {
    await person(1)
    const second = await person(2)
    const third = await person(3)
    await broadcastsOf.queue(TEXT, EVERYBODY)
    const batch = await broadcastsOf.claim(null, 2)
    await broadcastsOf.done({
      id: batch?.id ?? 0,
      through: idOf(2),
      sent: 2,
      blocked: 0,
      failed: 0,
    })

    await erasure.erase(second.tg, { dryRun: false })

    expect((await row()).cursor).toBe(idOf(1))
    expect(await drain()).toEqual([third.tg])
  })

  it('стёрт первый — курсор в начале', async () => {
    const first = await person(1)
    const second = await person(2)
    await broadcastsOf.queue(TEXT, EVERYBODY)
    const batch = await broadcastsOf.claim(null, 1)
    await broadcastsOf.done({
      id: batch?.id ?? 0,
      through: idOf(1),
      sent: 1,
      blocked: 0,
      failed: 0,
    })

    await erasure.erase(first.tg, { dryRun: false })

    expect((await row()).cursor).toBe(BROADCAST_START)
    expect(await drain()).toEqual([second.tg])
  })

  it('стёрт между выдачей и отчётом — отчёт ставит курсор на живого', async () => {
    await person(1)
    const second = await person(2)
    const third = await person(3)
    await broadcastsOf.queue(TEXT, EVERYBODY)
    const batch = await broadcastsOf.claim(null, 2)
    await erasure.erase(second.tg, { dryRun: false })
    await broadcastsOf.done({
      id: batch?.id ?? 0,
      through: idOf(2),
      sent: 2,
      blocked: 0,
      failed: 0,
    })

    expect((await row()).cursor).toBe(idOf(1))
    expect(await drain()).toEqual([third.tg])
  })

  // Adversarial А2: the bot's word in flight while the person it ends on is erased. Whichever of the
  // two gets the broadcast's row first, the cursor ends on a live id.
  it('слово бота в полёте во время стирания — курсор всё равно на живом', async () => {
    await person(1)
    const second = await person(2)
    await person(3)
    await broadcastsOf.queue(TEXT, EVERYBODY)
    const batch = await broadcastsOf.claim(null, 2)
    const holder = connect()
    const reporter = connectDrizzle()
    const eraser = connectDrizzle()
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    let locked!: () => void
    const isLocked = new Promise<void>((resolve) => (locked = resolve))
    try {
      // a writer of the row in flight holds it, so both the word and the erasure queue behind it
      const holding = holder.begin(async (tx) => {
        await tx`select 1 from broadcasts where id = ${batch?.id ?? 0} for update`
        locked()
        await released
      })
      await isLocked
      const reported = createBroadcastRepository(reporter.db).done({
        id: batch?.id ?? 0,
        through: idOf(2),
        sent: 2,
        blocked: 0,
        failed: 0,
      })
      await waitingForRow(1)
      let erasedAlready = false
      const erased = createErasureRepository(eraser.db)
        .erase(second.tg, { dryRun: false })
        .finally(() => {
          erasedAlready = true
        })
      // the erasure waits behind the row too, or — without its lock — runs whole first
      await waitingForRow(2, () => erasedAlready)
      release()
      await holding
      await Promise.all([reported, erased])
    } finally {
      await Promise.all([holder.end(), reporter.close(), eraser.close()])
    }
    expect(
      await db
        .select()
        .from(actors)
        .where(eq(actors.id, idOf(2))),
    ).toEqual([])
    expect(await row()).toMatchObject({ cursor: idOf(1), sent: 2 })
  }, 20_000)

  it('сухой прогон стирания курсор не трогает', async () => {
    const first = await person(1)
    await person(2)
    await broadcastsOf.queue(TEXT, EVERYBODY)
    const batch = await broadcastsOf.claim(null, 1)
    await broadcastsOf.done({
      id: batch?.id ?? 0,
      through: idOf(1),
      sent: 1,
      blocked: 0,
      failed: 0,
    })
    await erasure.erase(first.tg, { dryRun: true })
    expect((await row()).cursor).toBe(idOf(1))
  })
})

describe('broadcasts — ход', () => {
  it('пробная после рассылки людям не закрывает её ход; пробная до неё — не видна', async () => {
    const owner = await person(1)
    await person(2)
    await broadcastsOf.queue(TEXT, { to: 'owner', owner: owner.tg })
    await broadcastsOf.queue(TEXT, EVERYBODY)
    expect((await broadcastsOf.status(owner.tg)).map((one) => one.ownerOnly)).toEqual([false])
    await broadcastsOf.queue(TEXT, { to: 'owner', owner: owner.tg })
    expect((await broadcastsOf.status(owner.tg)).map((one) => one.ownerOnly)).toEqual([false, true])
  })

  it('последняя рассылка: счётчики и сколько осталось', async () => {
    await Promise.all([1, 2, 3].map((n) => person(n)))
    await person(4, { botBlockedAt: new Date() })
    expect(await broadcastsOf.status(null)).toEqual([])
    await broadcastsOf.queue(TEXT, EVERYBODY)
    const batch = await broadcastsOf.claim(null, 1)
    await broadcastsOf.done({
      id: batch?.id ?? 0,
      through: idOf(1),
      sent: 1,
      blocked: 0,
      failed: 0,
    })
    expect((await broadcastsOf.status(null))[0]).toMatchObject({
      ownerOnly: false,
      countries: null,
      total: 3,
      blockedAtStart: 1,
      sent: 1,
      left: 2,
      finishedAt: null,
      cancelledAt: null,
    })
    await drain()
    expect((await broadcastsOf.status(null))[0]).toMatchObject({ sent: 3, left: 0 })
  })
})

describe('broadcasts — внутренние адреса бота', () => {
  const botSecret = randomBytes(32).toString('base64url')
  const OWNER = 7_000_000_001
  let app: FastifyInstance

  beforeAll(async () => {
    app = buildServer({
      db,
      receiptReader: null,
      login: { username: 'molvia_bot', botSecret },
      owner: OWNER,
    })
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  function post(url: string, payload?: unknown, authorization = `Bearer ${botSecret}`) {
    return app.inject({
      method: 'POST',
      url,
      headers: { authorization },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    })
  }

  it('без секрета — 401; с ним — пачка по контракту, отчёт — 204', async () => {
    const one = await person(1)
    await broadcastsOf.queue(TEXT, EVERYBODY)

    expect((await post('/internal/broadcasts/claim', undefined, 'Bearer wrong')).statusCode).toBe(
      401,
    )
    const claimed = await post('/internal/broadcasts/claim')
    expect(claimed.statusCode).toBe(200)
    expect(claimed.headers['cache-control']).toBe('no-store')
    const batch = dueBroadcastSchema.parse(claimed.json())
    expect(batch.broadcast).toEqual({
      id: (await row()).id,
      text: TEXT,
      recipients: [{ telegramUserId: one.tg, position: one.id }],
    })

    const done = await post('/internal/broadcasts/done', {
      id: batch.broadcast?.id,
      through: one.id,
      sent: 1,
      blocked: 0,
      failed: 0,
    })
    expect(done.statusCode).toBe(204)
    expect(await row()).toMatchObject({ sent: 1, cursor: one.id })
    expect((await post('/internal/broadcasts/claim')).json()).toEqual({ broadcast: null })
  })

  it('claim с телом и отчёт без исхода — отказ, ничего не тронуто', async () => {
    await person(1)
    await broadcastsOf.queue(TEXT, EVERYBODY)
    expect((await post('/internal/broadcasts/claim', { limit: 1000 })).statusCode).toBe(400)
    expect((await row()).leaseUntil).toBeNull()
    const refused = await post('/internal/broadcasts/done', {
      id: (await row()).id,
      through: idOf(1),
      sent: 0,
      blocked: 0,
      failed: 0,
    })
    expect(refused.statusCode).toBe(400)
    expect((await row()).cursor).toBe(BROADCAST_START)
  })

  it('пробная — на владельца из окружения API', async () => {
    await person(1)
    const owner = await person(2, { telegramUserId: OWNER })
    await broadcastsOf.queue(TEXT, { to: 'owner', owner: OWNER })
    const batch = dueBroadcastSchema.parse((await post('/internal/broadcasts/claim')).json())
    expect(batch.broadcast?.recipients).toEqual([{ telegramUserId: OWNER, position: owner.id }])
  })
})
