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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR, ISSUE, REMINDERS_PER_CLAIM, dueRemindersSchema } from '@molvia/model'
import type { DueReminders } from '@molvia/model'
import { createReminderRepository } from '@/db/reminders-repository'
import { expenses, ratingReminders, reminderDays, trips, verdicts } from '@/db/schema'
import { buildServer } from '@/server'
import { remindRatings } from '@/usecases/remind-ratings'
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

/** The evening's claim at 19:00 of `day`, read through the contract the bot parses. */
async function evening(day: string, time = '19:00'): Promise<DueReminders> {
  return dueRemindersSchema.parse(await remindRatings(reminders, yerevan(day, time)))
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
          items: [{ itemId: milk, name: 'Молоко Ашхар 1 л', placeName: 'Ереван Сити', daysAgo: 1 }],
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
