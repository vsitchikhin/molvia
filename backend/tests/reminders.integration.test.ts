/**
 * The rating reminder (MOL-101) against a real Postgres: who is due at which minute of their
 * evening, the ladder of 1 → 3 → 7 days and the six-month pause, what a reminder asks about and
 * what it must not, and the two internal routes the bot talks to.
 *
 * Yerevan is UTC+4 all year: 19:00 there is 15:00Z, midnight is 20:00Z the day before. The days
 * are behind the real clock wherever a verdict is written: the database refuses one rated in the
 * future, and a withdrawal moves `updated_at` to the moment it really happens.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR, ISSUE, REMINDERS_PER_CLAIM, dueRemindersSchema } from '@molvia/model'
import type { DueReminders } from '@molvia/model'
import { createReminderRepository } from '@/db/reminders-repository'
import type { ReminderRepository } from '@/db/reminders-repository'
import { expenses, ratingReminders, reminderDays, trips, verdicts } from '@/db/schema'
import { buildServer } from '@/server'
import { remindRatings } from '@/usecases/remind-ratings'
import type { QuietToday } from '@/usecases/remind-ratings'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip, telegramId } from './fixtures'

const { db, close } = connectDrizzle()
const reminders = createReminderRepository(db)
const botSecret = randomBytes(32).toString('base64url')
const app = buildServer({ db, login: { username: 'molvia_bot', botSecret } })

beforeAll(() => app.ready())
beforeEach(() => clearAll(db))
afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

/** A minute of a Yerevan day, as the instant it is. */
function yerevan(day: string, time: string): Date {
  return new Date(`${day}T${time}:00.000+04:00`)
}

/** Failures of a single person's claim, as the server would log them; none are expected here. */
let failures: unknown[] = []
beforeEach(() => {
  failures = []
})

/**
 * The evening's claim at 19:00 of `day`, read through the contract the bot parses. Each call with
 * a memory of its own, as a freshly started API has — `wholeEvening` below keeps one throughout.
 */
async function evening(
  day: string,
  time = '19:00',
  repository: ReminderRepository = reminders,
): Promise<DueReminders> {
  const due = await remindRatings(
    repository,
    yerevan(day, time),
    (error) => failures.push(error),
    new Map(),
  )
  return dueRemindersSchema.parse(due)
}

/** What each person was asked about: Telegram id → item names, freshest first. */
function asked(due: DueReminders): Record<number, string[]> {
  return Object.fromEntries(
    due.reminders.map((reminder) => [
      reminder.telegramUserId,
      reminder.items.map((item) => item.name),
    ]),
  )
}

interface Person {
  readonly id: string
  readonly tg: number
}

async function person(patch: Parameters<typeof insertActor>[1] = {}): Promise<Person> {
  const tg = telegramId()
  return { id: await insertActor(db, { telegramUserId: tg, ...patch }), tg }
}

let shop: string
beforeEach(async () => {
  shop = await insertPlace(db, { name: 'Ереван Сити' })
})

async function item(name: string, kind: 'product' | 'dish' = 'product'): Promise<string> {
  return insertItem(db, { name, kind, searchKey: name })
}

/** Bought at that instant, on a trip of its own. */
async function bought(who: Person, itemId: string, at: Date): Promise<string> {
  const tripId = await insertTrip(db, { actorId: who.id, placeId: shop, startedAt: at })
  await db.insert(expenses).values({ id: randomUUID(), tripId, itemId, createdAt: at })
  return tripId
}

async function verdict(who: Person, itemId: string, at: Date, deletedAt: Date | null = null) {
  await db.insert(verdicts).values({
    id: randomUUID(),
    actorId: who.id,
    itemId,
    itemKind: 'product',
    score: deletedAt ? 2 : 4,
    ratedAt: at,
    updatedAt: deletedAt ?? at,
    deletedAt,
  })
}

async function ladderOf(who: Person) {
  const [row] = await db.select().from(ratingReminders).where(eq(ratingReminders.actorId, who.id))
  return row ? { step: row.step, remindedOn: row.remindedOn, windowFrom: row.windowFrom } : null
}

describe('ступень 1 — вечером следующего дня', () => {
  it('в 19:00 спрашивает о вчерашнем, в 18:59 — нет, дважды за вечер — нет', async () => {
    const anna = await person()
    const milk = await item('Молоко Ашхар 1 л')
    await bought(anna, milk, yerevan('2026-07-13', '10:00'))

    expect((await evening('2026-07-14', '18:59')).reminders).toEqual([])
    expect(await evening('2026-07-14', '19:00')).toEqual({
      reminders: [
        {
          telegramUserId: anna.tg,
          items: [
            {
              itemId: milk,
              name: 'Молоко Ашхар 1 л',
              placeName: 'Ереван Сити',
              // The bot prints it only where two items of one reminder share the name (MOL-120).
              placeCity: 'Гюмри',
              daysAgo: 1,
            },
          ],
          total: 1,
        },
      ],
    })
    expect((await evening('2026-07-14', '19:01')).reminders).toEqual([])
    expect(await ladderOf(anna)).toEqual({
      step: 1,
      remindedOn: '2026-07-14',
      windowFrom: '2026-07-13',
    })
  })

  it('в 21:59 ещё присылает, с 22:00 — день пропал', async () => {
    const anna = await person()
    const boris = await person()
    const milk = await item('Молоко')
    await bought(anna, milk, yerevan('2026-07-13', '10:00'))
    await bought(boris, milk, yerevan('2026-07-13', '10:00'))

    expect(asked(await evening('2026-07-14', '22:00'))).toEqual({})
    expect(asked(await evening('2026-07-14', '21:59'))).toEqual({
      [anna.tg]: ['Молоко'],
      [boris.tg]: ['Молоко'],
    })
  })

  it('вчера — по дню Еревана: 23:59 вчера спрашивается, 00:00 сегодня — нет', async () => {
    const anna = await person()
    const late = await item('Кефир')
    const early = await item('Хлеб')
    await bought(anna, late, yerevan('2026-07-13', '23:59'))
    await bought(anna, early, yerevan('2026-07-14', '00:00'))

    expect(asked(await evening('2026-07-14'))).toEqual({ [anna.tg]: ['Кефир'] })
  })

  it('день человека не зависит от часового пояса сессии базы', async () => {
    const anna = await person()
    const milk = await item('Молоко')
    await bought(anna, milk, yerevan('2026-07-13', '23:30'))
    await db.execute(sql`set timezone = 'Pacific/Kiritimati'`)
    try {
      expect(asked(await evening('2026-07-14'))).toEqual({ [anna.tg]: ['Молоко'] })
    } finally {
      await db.execute(sql`set timezone = 'UTC'`)
    }
  })

  it('не больше трёх позиций, самые свежие; total — все вчерашние', async () => {
    const anna = await person()
    for (const [name, time] of [
      ['Молоко', '09:00'],
      ['Хлеб', '10:00'],
      ['Сыр', '11:00'],
      ['Кефир', '12:00'],
    ] as const) {
      await bought(anna, await item(name), yerevan('2026-07-13', time))
    }

    const [reminder] = (await evening('2026-07-14')).reminders
    expect(reminder?.items.map((one) => one.name)).toEqual(['Кефир', 'Сыр', 'Хлеб'])
    expect(reminder?.total).toBe(4)
  })

  it('ровно три — три и total 3; три покупки одной позиции — один вопрос', async () => {
    const anna = await person()
    const milk = await item('Молоко')
    for (const time of ['09:00', '12:00', '18:00']) {
      await bought(anna, milk, yerevan('2026-07-13', time))
    }
    await bought(anna, await item('Хлеб'), yerevan('2026-07-13', '10:00'))
    await bought(anna, await item('Сыр'), yerevan('2026-07-13', '11:00'))

    const [reminder] = (await evening('2026-07-14')).reminders
    expect(reminder?.items.map((one) => one.name)).toEqual(['Молоко', 'Сыр', 'Хлеб'])
    expect(reminder?.total).toBe(3)
  })

  it('не спрашивает: оценённое, блюдо, удалённый поход, сегодня, позавчера, чужое', async () => {
    const anna = await person()
    const boris = await person()
    const rated = await item('Оценённое')
    await verdict(anna, rated, yerevan('2026-07-01', '10:00'))
    await bought(anna, rated, yerevan('2026-07-13', '10:00'))
    await bought(anna, await item('Хаш', 'dish'), yerevan('2026-07-13', '10:00'))
    const removed = await bought(anna, await item('Удалённое'), yerevan('2026-07-13', '10:00'))
    await db.update(trips).set({ deletedAt: new Date() }).where(eq(trips.id, removed))
    await bought(anna, await item('Сегодняшнее'), yerevan('2026-07-14', '09:00'))
    await bought(anna, await item('Позавчерашнее'), yerevan('2026-07-12', '20:00'))
    await bought(boris, await item('Борисово'), yerevan('2026-07-12', '10:00'))

    expect(asked(await evening('2026-07-14'))).toEqual({})
    expect(await ladderOf(anna)).toBeNull()
  })

  it('человек из страны без часового пояса не получает ничего', async () => {
    const anna = await person({ country: 'RU', city: 'Москва' })
    await bought(anna, await item('Молоко'), yerevan('2026-07-13', '10:00'))

    expect(asked(await evening('2026-07-14'))).toEqual({})
  })

  it(`за раз отдаёт не больше ${String(REMINDERS_PER_CLAIM)} человек, остальным — в следующую минуту`, async () => {
    const milk = await item('Молоко')
    const people: Person[] = []
    for (let n = 0; n <= REMINDERS_PER_CLAIM; n += 1) {
      const one = await person()
      people.push(one)
      await bought(one, milk, yerevan('2026-07-13', '10:00'))
    }

    expect((await evening('2026-07-14', '19:00')).reminders).toHaveLength(REMINDERS_PER_CLAIM)
    expect((await evening('2026-07-14', '19:01')).reminders).toHaveLength(1)
  })
})

describe('лестница владельца: 1 → 3 дня → 7 дней → полгода', () => {
  it('пример Ани: день 1, +3 дня, +7 дней, полгода тишины, потом только новое', async () => {
    const anna = await person()
    const milk = await item('Молоко')
    await bought(anna, milk, yerevan('2026-07-12', '18:00'))

    expect(asked(await evening('2026-07-13'))).toEqual({ [anna.tg]: ['Молоко'] })
    await bought(anna, await item('Хлеб'), yerevan('2026-07-14', '18:00'))
    expect(asked(await evening('2026-07-15'))).toEqual({})

    const friday = (await evening('2026-07-16')).reminders
    expect(friday.map((one) => one.items.map((i) => [i.name, i.daysAgo]))).toEqual([
      [
        ['Хлеб', 2],
        ['Молоко', 4],
      ],
    ])
    expect(await ladderOf(anna)).toMatchObject({ step: 2, windowFrom: '2026-07-12' })

    expect(asked(await evening('2026-07-22'))).toEqual({})
    expect(asked(await evening('2026-07-23'))).toEqual({ [anna.tg]: ['Хлеб', 'Молоко'] })
    expect(await ladderOf(anna)).toMatchObject({ step: 3, remindedOn: '2026-07-23' })

    await bought(anna, await item('Кефир'), yerevan('2026-08-01', '12:00'))
    expect(asked(await evening('2026-08-02'))).toEqual({})
    await bought(anna, await item('Масло'), yerevan('2027-01-22', '12:00'))
    expect(asked(await evening('2027-01-23'))).toEqual({})
    await bought(anna, await item('Сыр'), yerevan('2027-01-23', '12:00'))
    expect(asked(await evening('2027-01-24'))).toEqual({ [anna.tg]: ['Сыр'] })
    expect(await ladderOf(anna)).toEqual({
      step: 1,
      remindedOn: '2027-01-24',
      windowFrom: '2027-01-23',
    })
  })

  it('своя оценка между ступенями — лестница заново с новой покупки', async () => {
    const anna = await person()
    const milk = await item('Молоко')
    const bread = await item('Хлеб')
    await bought(anna, milk, yerevan('2026-07-12', '18:00'))
    await bought(anna, bread, yerevan('2026-07-12', '18:05'))
    await evening('2026-07-13')

    // Одну из двух — с экрана, наутро.
    await verdict(anna, milk, yerevan('2026-07-14', '09:00'))
    await bought(anna, await item('Кефир'), yerevan('2026-07-14', '12:00'))

    expect(asked(await evening('2026-07-15'))).toEqual({ [anna.tg]: ['Кефир'] })
    expect(await ladderOf(anna)).toEqual({
      step: 1,
      remindedOn: '2026-07-15',
      windowFrom: '2026-07-14',
    })
  })

  it('своя оценка во время паузы снимает паузу', async () => {
    const anna = await person()
    await db.insert(ratingReminders).values({
      actorId: anna.id,
      step: 3,
      remindedOn: '2026-07-23',
      remindedAt: yerevan('2026-07-23', '19:00'),
      windowFrom: '2026-07-12',
    })
    await verdict(anna, await item('Молоко'), yerevan('2026-08-01', '10:00'))
    await bought(anna, await item('Сыр'), yerevan('2026-08-01', '12:00'))

    expect(asked(await evening('2026-08-02'))).toEqual({ [anna.tg]: ['Сыр'] })
  })

  it('снятая оценка и оценка до напоминания лестницу не сбрасывают', async () => {
    // Days behind the real clock: withdrawing moves `updated_at` by a trigger, to the moment it
    // really happens, and that has to fall after the reminder for the test to mean anything.
    const anna = await person()
    const milk = await item('Молоко')
    const old = await item('Старое')
    await verdict(anna, old, yerevan('2026-08-01', '10:00'))
    await bought(anna, milk, yerevan('2026-08-10', '18:00'))
    await evening('2026-08-11')

    await db
      .update(verdicts)
      .set({ deletedAt: new Date(), review: null })
      .where(eq(verdicts.itemId, old))
    await bought(anna, await item('Кефир'), yerevan('2026-08-12', '12:00'))

    expect(asked(await evening('2026-08-13'))).toEqual({})
    expect(asked(await evening('2026-08-14'))).toEqual({ [anna.tg]: ['Кефир', 'Молоко'] })
  })

  it('на ступени 2 спрашивать нечего — лестница кончается молча', async () => {
    const anna = await person()
    const trip = await bought(anna, await item('Молоко'), yerevan('2026-07-12', '18:00'))
    await evening('2026-07-13')
    await db.update(trips).set({ deletedAt: new Date() }).where(eq(trips.id, trip))

    expect(asked(await evening('2026-07-16'))).toEqual({})
    expect(await ladderOf(anna)).toBeNull()
    await bought(anna, await item('Хлеб'), yerevan('2026-07-17', '12:00'))
    expect(asked(await evening('2026-07-18'))).toEqual({ [anna.tg]: ['Хлеб'] })
  })

  it('пропущенный вечер ступени не теряет: она приходит в следующий', async () => {
    const anna = await person()
    await bought(anna, await item('Молоко'), yerevan('2026-07-12', '18:00'))
    await evening('2026-07-13')

    expect(asked(await evening('2026-07-17'))).toEqual({ [anna.tg]: ['Молоко'] })
    expect(await ladderOf(anna)).toMatchObject({ step: 2, remindedOn: '2026-07-17' })
  })
})

describe('MOL-29: позиция со снятой оценкой (В-3)', () => {
  it('покупка после снятия — спрашиваем', async () => {
    const anna = await person()
    const lori = await item('Сыр Лори')
    await verdict(anna, lori, yerevan('2026-07-03', '10:00'), yerevan('2026-07-10', '10:00'))
    await bought(anna, lori, yerevan('2026-07-12', '12:00'))

    expect(asked(await evening('2026-07-13'))).toEqual({ [anna.tg]: ['Сыр Лори'] })
  })

  it('покупка до снятия — не спрашиваем', async () => {
    const anna = await person()
    const lori = await item('Сыр Лори')
    await bought(anna, lori, yerevan('2026-07-12', '12:00'))
    await verdict(anna, lori, yerevan('2026-07-12', '20:00'), yerevan('2026-07-13', '09:00'))

    expect(asked(await evening('2026-07-13'))).toEqual({})
  })
})

describe('внутренние ручки бота', () => {
  function claim(authorization: string | null = `Bearer ${botSecret}`) {
    return app.inject({
      method: 'POST',
      url: '/internal/reminders/claim',
      headers: authorization ? { authorization } : {},
    })
  }

  function press(itemId: string, body: unknown, authorization = `Bearer ${botSecret}`) {
    return app.inject({
      method: 'PUT',
      url: `/internal/verdicts/${itemId}`,
      headers: { authorization },
      payload: body as Record<string, unknown>,
    })
  }

  it('claim без секрета — 401, с ним — список по контракту', async () => {
    for (const authorization of [null, 'Bearer wrong']) {
      const response = await claim(authorization)
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ code: ERROR.BOT_UNAUTHORIZED })
    }
    const response = await claim()
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(dueRemindersSchema.parse(response.json())).toMatchObject({ reminders: [] })
  })

  it('нажатие ставит оценку тому, кто нажал, отзыв цел, строка одна', async () => {
    const anna = await person()
    const milk = await item('Молоко')
    await db.insert(verdicts).values({
      id: randomUUID(),
      actorId: anna.id,
      itemId: milk,
      itemKind: 'product',
      score: 2,
      review: 'Кислое',
    })

    const response = await press(milk.toUpperCase(), { telegramUserId: anna.tg, score: 4 })

    expect(response.statusCode).toBe(204)
    expect(
      await db
        .select({ score: verdicts.score, review: verdicts.review })
        .from(verdicts)
        .where(eq(verdicts.actorId, anna.id)),
    ).toEqual([{ score: 4, review: 'Кислое' }])
  })

  it('новая оценка из бота считается в reminder_days, поправка вторым нажатием — нет', async () => {
    const anna = await person()
    const milk = await item('Молоко')

    expect((await press(milk, { telegramUserId: anna.tg, score: 3 })).statusCode).toBe(204)
    expect((await press(milk, { telegramUserId: anna.tg, score: 4 })).statusCode).toBe(204)

    const rows = await db.select().from(reminderDays)
    expect(rows.map((row) => row.rated)).toEqual([1])
  })

  it('незнакомый Telegram-id и несуществующая позиция — 404', async () => {
    const anna = await person()
    const milk = await item('Молоко')
    for (const [id, tg] of [
      [milk, telegramId()],
      [randomUUID(), anna.tg],
      ['not-a-uuid', anna.tg],
    ] as const) {
      const response = await press(id, { telegramUserId: tg, score: 4 })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ code: ERROR.NOT_FOUND })
    }
    expect(await db.select().from(verdicts)).toEqual([])
  })

  it.each([
    { score: 4 },
    { telegramUserId: 7, score: 0 },
    { telegramUserId: 7, score: 6 },
    { telegramUserId: 7, score: 4, review: 'ok' },
  ])('тело %j — 400', async (body) => {
    const response = await press(await item('Молоко'), body)
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: ISSUE.BODY_INVALID })
  })

  it('без секрета оценку не ставит', async () => {
    const anna = await person()
    const milk = await item('Молоко')
    const response = await press(milk, { telegramUserId: anna.tg, score: 4 }, 'Bearer wrong')
    expect(response.statusCode).toBe(401)
    expect(await db.select().from(verdicts)).toEqual([])
  })
})

describe('счётчики напоминаний (В-4)', () => {
  it('ступени и позиции — по дню Еревана', async () => {
    const anna = await person()
    const boris = await person()
    await bought(anna, await item('Молоко'), yerevan('2026-07-12', '12:00'))
    await bought(anna, await item('Хлеб'), yerevan('2026-07-12', '13:00'))
    await bought(boris, await item('Сыр'), yerevan('2026-07-12', '12:00'))
    await evening('2026-07-13')
    await evening('2026-07-16')

    const rows = await db.select().from(reminderDays).orderBy(reminderDays.day)
    expect(
      rows.map(({ day, firstSteps, secondSteps, thirdSteps, items, rated }) => ({
        day,
        firstSteps,
        secondSteps,
        thirdSteps,
        items,
        rated,
      })),
    ).toEqual([
      { day: '2026-07-13', firstSteps: 2, secondSteps: 0, thirdSteps: 0, items: 3, rated: 0 },
      { day: '2026-07-16', firstSteps: 0, secondSteps: 2, thirdSteps: 0, items: 3, rated: 0 },
    ])
  })
})

// A name today's `visibleLine` refuses and the database keeps (`items.name` is a bare varchar):
// U+202E, the override a pasted name brings — built from its code, never invisible in this file.
const LEGACY_NAME = `Сыр ${String.fromCodePoint(0x202e)}Лори`

describe('одна выдача не роняет другие (адверсариальный А)', () => {
  function claim() {
    return app.inject({
      method: 'POST',
      url: '/internal/reminders/claim',
      headers: { authorization: `Bearer ${botSecret}` },
    })
  }

  it('позицию с именем старше правила пропускает, остальных — и её владельца — не теряет', async () => {
    const anna = await person()
    const boris = await person()
    await bought(anna, await item('Молоко'), yerevan('2026-07-13', '10:00'))
    await bought(
      boris,
      await insertItem(db, { name: LEGACY_NAME, searchKey: 'sir lori' }),
      yerevan('2026-07-13', '11:00'),
    )
    await bought(boris, await item('Хлеб'), yerevan('2026-07-13', '12:00'))

    expect(asked(await evening('2026-07-14'))).toEqual({
      [anna.tg]: ['Молоко'],
      [boris.tg]: ['Хлеб'],
    })
    const [day] = await db.select().from(reminderDays)
    expect(day).toMatchObject({ firstSteps: 2, items: 2 })
  })

  it('у кого все позиции с такими именами — не помечен и не посчитан, ответ ручки — 200', async () => {
    const anna = await person()
    const boris = await person()
    await bought(anna, await item('Молоко'), yerevan('2026-07-13', '10:00'))
    await bought(
      boris,
      await insertItem(db, { name: LEGACY_NAME, searchKey: 'sir lori' }),
      yerevan('2026-07-13', '11:00'),
    )

    vi.useFakeTimers({ toFake: ['Date'], now: yerevan('2026-07-14', '19:00') })
    let response
    try {
      response = await claim()
    } finally {
      vi.useRealTimers()
    }
    expect(response.statusCode).toBe(200)
    expect(asked(dueRemindersSchema.parse(response.json()))).toEqual({ [anna.tg]: ['Молоко'] })
    expect(await ladderOf(boris)).toBeNull()
  })

  it('сбой выдачи одного человека уходит в журнал, остальные этой минуты получают своё', async () => {
    const anna = await person()
    const boris = await person()
    await bought(anna, await item('Молоко'), yerevan('2026-07-13', '10:00'))
    await bought(boris, await item('Хлеб'), yerevan('2026-07-13', '11:00'))
    let calls = 0
    const flaky: ReminderRepository = {
      ...reminders,
      claim: async (request, limit, sendable) => {
        calls += 1
        if (calls === 1) throw Object.assign(new Error('connection reset'), { code: '08006' })
        return reminders.claim(request, limit, sendable)
      },
    }

    const first = await evening('2026-07-14', '19:00', flaky)
    expect(first.reminders).toHaveLength(1)
    expect(failures).toHaveLength(1)
    failures = []
    // The one who failed was not marked: the next minute is theirs.
    const second = await evening('2026-07-14', '19:01')
    expect(second.reminders).toHaveLength(1)
    expect(second.reminders[0]?.telegramUserId).not.toBe(first.reminders[0]?.telegramUserId)
  })
})

describe('лишних выдач нет (адверсариальный В, ревью Т-5)', () => {
  function counting(): {
    repository: ReminderRepository
    claims: () => number
    reads: () => number
  } {
    let claims = 0
    let reads = 0
    return {
      repository: {
        ...reminders,
        candidates: async () => {
          reads += 1
          return reminders.candidates()
        },
        claim: async (request, limit, sendable) => {
          claims += 1
          return reminders.claim(request, limit, sendable)
        },
      },
      claims: () => claims,
      reads: () => reads,
    }
  }

  it('оценила вчерашнее сама — ни одной выдачи за вечер', async () => {
    const anna = await person()
    const milk = await item('Молоко')
    await bought(anna, milk, yerevan('2026-07-13', '10:00'))
    await verdict(anna, milk, yerevan('2026-07-13', '20:00'))
    const { repository, claims } = counting()

    for (const time of ['19:00', '19:01', '20:30', '21:59']) {
      expect(asked(await evening('2026-07-14', time, repository))).toEqual({})
    }
    expect(claims()).toBe(0)
  })

  it('вчера — только блюдо: ни одной выдачи', async () => {
    const anna = await person()
    await bought(anna, await item('Хаш', 'dish'), yerevan('2026-07-13', '10:00'))
    const { repository, claims } = counting()

    await evening('2026-07-14', '19:00', repository)
    expect(claims()).toBe(0)
  })

  /** The minutes of one evening as the API sees them: one memory of settled evenings throughout. */
  async function wholeEvening(day: string, repository: ReminderRepository): Promise<number> {
    const quiet: QuietToday = new Map()
    let sent = 0
    for (const time of ['19:00', '19:01', '19:02', '20:30', '21:59']) {
      const due = await remindRatings(
        repository,
        yerevan(day, time),
        (e) => failures.push(e),
        quiet,
      )
      sent += due.reminders.length
    }
    return sent
  }

  it('покупка, внесённая в поход, закрытый днём раньше, — ни одной выдачи (адверсариальный Е1)', async () => {
    const anna = await person()
    const tripId = await insertTrip(db, {
      actorId: anna.id,
      placeId: shop,
      startedAt: yerevan('2026-07-12', '10:00'),
      finishedAt: yerevan('2026-07-12', '11:00'),
    })
    await db.insert(expenses).values({
      id: randomUUID(),
      tripId,
      itemId: await item('Молоко'),
      createdAt: yerevan('2026-07-13', '09:00'),
    })
    const { repository, claims } = counting()

    expect(await wholeEvening('2026-07-14', repository)).toBe(0)
    expect(claims()).toBe(0)
  })

  it('вчера — только позиция со старым именем: одна пустая выдача, не каждую минуту (Е2)', async () => {
    const anna = await person()
    const legacy = await insertItem(db, { name: LEGACY_NAME, searchKey: 'sir lori' })
    await bought(anna, legacy, yerevan('2026-07-13', '10:00'))
    const { repository, claims } = counting()

    expect(await wholeEvening('2026-07-14', repository)).toBe(0)
    expect(claims()).toBe(1)
  })

  /** A trip of yesterday, closed at 11:00: what is written into it later is yesterday's. */
  async function closedYesterday(who: Person): Promise<string> {
    return insertTrip(db, {
      actorId: who.id,
      placeId: shop,
      startedAt: yerevan('2026-07-13', '10:00'),
      finishedAt: yerevan('2026-07-13', '11:00'),
    })
  }

  async function enter(tripId: string, itemId: string, at: Date): Promise<void> {
    await db.insert(expenses).values({ id: randomUUID(), tripId, itemId, createdAt: at })
  }

  it('пустая выдача не глушит покупку, дописанную в тот же вечер (адверсариальный И1)', async () => {
    const anna = await person()
    const trip = await closedYesterday(anna)
    await enter(
      trip,
      await insertItem(db, { name: LEGACY_NAME, searchKey: 'sir lori' }),
      yerevan('2026-07-13', '10:30'),
    )
    const quiet: QuietToday = new Map()
    const at = async (time: string) =>
      asked(
        dueRemindersSchema.parse(
          await remindRatings(
            reminders,
            yerevan('2026-07-14', time),
            (e) => failures.push(e),
            quiet,
          ),
        ),
      )

    expect(await at('19:00')).toEqual({})
    expect(await at('19:30')).toEqual({})
    await enter(trip, await item('Молоко'), yerevan('2026-07-14', '20:00'))
    expect(await at('20:01')).toEqual({ [anna.tg]: ['Молоко'] })
  })

  it('и после оценки, снятой вчера (MOL-29): дописанное вечером спрашивается (И2)', async () => {
    const anna = await person()
    const trip = await closedYesterday(anna)
    const kefir = await item('Кефир')
    await enter(trip, kefir, yerevan('2026-07-13', '10:30'))
    await verdict(anna, kefir, yerevan('2026-07-13', '21:00'), yerevan('2026-07-13', '21:05'))
    const quiet: QuietToday = new Map()
    const at = async (time: string) =>
      asked(
        dueRemindersSchema.parse(
          await remindRatings(
            reminders,
            yerevan('2026-07-14', time),
            (e) => failures.push(e),
            quiet,
          ),
        ),
      )

    expect(await at('19:00')).toEqual({})
    await enter(trip, await item('Молоко'), yerevan('2026-07-14', '20:00'))
    expect(await at('20:01')).toEqual({ [anna.tg]: ['Молоко'] })
  })

  it('кому напоминание ушло, того вечер больше не открывает', async () => {
    const anna = await person()
    await bought(anna, await item('Молоко'), yerevan('2026-07-13', '10:00'))
    const { repository, claims } = counting()

    expect(await wholeEvening('2026-07-14', repository)).toBe(1)
    expect(claims()).toBe(1)
  })

  it('вне вечера база не спрашивается вовсе', async () => {
    const anna = await person()
    await bought(anna, await item('Молоко'), yerevan('2026-07-13', '10:00'))
    const { repository, reads } = counting()

    // Outside every evening of every country: in July 22:00 in Yerevan is 20:00 in Belgrade, an
    // evening, so the last minute outside them all is Belgrade's 22:00 — midnight here (MOL-109).
    for (const time of ['00:00', '12:00', '18:59']) {
      expect(asked(await evening('2026-07-14', time, repository))).toEqual({})
    }
    expect(reads()).toBe(0)
  })

  it('человек из Белграда — в 19:00 по Белграду, не по Еревану (MOL-109)', async () => {
    const milan = await person({ country: 'RS', city: 'Белград' })
    // 10:00 in Belgrade on the 13th — yesterday for the evening of the 14th
    await bought(milan, await item('Ајвар'), yerevan('2026-07-13', '12:00'))

    // 19:00 in Yerevan is 17:00 in Belgrade (summer): not yet
    expect(asked(await evening('2026-07-14', '19:00'))).toEqual({})
    // 21:00 in Yerevan is 19:00 in Belgrade
    expect(asked(await evening('2026-07-14', '21:00'))).toEqual({ [milan.tg]: ['Ајвар'] })
  })

  it('и зимой — в 19:00 по Белграду, на час позже летнего: пояс по имени, а не смещением (MOL-109)', async () => {
    const milan = await person({ country: 'RS', city: 'Белград' })
    await bought(milan, await item('Ајвар'), yerevan('2027-01-13', '12:00'))

    // 21:00 in Yerevan is 18:00 in Belgrade (winter, UTC+1): not yet — summer's offset would say yes
    expect(asked(await evening('2027-01-14', '21:00'))).toEqual({})
    // 22:00 in Yerevan is 19:00 in Belgrade
    expect(asked(await evening('2027-01-14', '22:00'))).toEqual({ [milan.tg]: ['Ајвар'] })
  })

  it('человек из Тбилиси — в 19:00, как Ереван: пояс тот же круглый год (MOL-109)', async () => {
    const nino = await person({ country: 'GE', city: 'Тбилиси' })
    await bought(nino, await item('Боржоми'), yerevan('2027-01-13', '12:00'))

    expect(asked(await evening('2027-01-14', '18:59'))).toEqual({})
    expect(asked(await evening('2027-01-14', '19:00'))).toEqual({ [nino.tg]: ['Боржоми'] })
  })
})

describe('две выдачи одной минуты разом (ревью Т-6: «даже при двух процессах бота»)', () => {
  // A second connection, as a second bot's claim would come to the API: on the file's one
  // connection the two claims would simply take turns.
  const second = connectDrizzle()
  afterAll(() => second.close())

  /**
   * Two claims of one minute, each on its own connection, both past `candidates()` before either
   * claims — the race the conditional write exists for, forced rather than hoped for.
   */
  async function race(day: string): Promise<number> {
    let arrived = 0
    let release: () => void = () => undefined
    const bothRead = new Promise<void>((resolve) => {
      release = resolve
    })
    const racing = (repository: ReminderRepository): ReminderRepository => ({
      ...repository,
      candidates: async () => {
        const found = await repository.candidates()
        arrived += 1
        if (arrived === 2) release()
        await bothRead
        return found
      },
    })
    const results = await Promise.all([
      evening(day, '19:00', racing(reminders)),
      evening(day, '19:00', racing(createReminderRepository(second.db))),
    ])
    return results.reduce((sum, one) => sum + one.reminders.length, 0)
  }

  it('на пустой лестнице — одно напоминание и один счёт', async () => {
    const anna = await person()
    await bought(anna, await item('Молоко'), yerevan('2026-07-13', '10:00'))

    expect(await race('2026-07-14')).toBe(1)
    const rows = await db.select().from(reminderDays)
    expect(rows.map((row) => row.firstSteps)).toEqual([1])
    expect(failures).toEqual([])
  })

  it('на ступени 2 — одно напоминание, ступень сдвинута один раз', async () => {
    const anna = await person()
    await bought(anna, await item('Молоко'), yerevan('2026-07-12', '10:00'))
    await evening('2026-07-13')

    expect(await race('2026-07-16')).toBe(1)
    expect(await ladderOf(anna)).toMatchObject({ step: 2, remindedOn: '2026-07-16' })
    const [day] = await db.select().from(reminderDays).where(eq(reminderDays.day, '2026-07-16'))
    expect(day?.secondSteps).toBe(1)
    expect(failures).toEqual([])
  })
})

describe('счётчик оценок из бота (адверсариальный Б)', () => {
  it('оценка после снятия не считается второй раз', async () => {
    const anna = await person()
    const milk = await item('Молоко')
    const press = (score: number) =>
      app.inject({
        method: 'PUT',
        url: `/internal/verdicts/${milk}`,
        headers: { authorization: `Bearer ${botSecret}` },
        payload: { telegramUserId: anna.tg, score },
      })

    expect((await press(4)).statusCode).toBe(204)
    await db
      .update(verdicts)
      .set({ deletedAt: new Date(), review: null })
      .where(eq(verdicts.actorId, anna.id))
    expect((await press(4)).statusCode).toBe(204)

    const rows = await db.select().from(reminderDays)
    expect(rows.map((row) => row.rated)).toEqual([1])
  })
})
