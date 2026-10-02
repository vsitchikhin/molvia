/**
 * The switch of the rating reminders (MOL-103) against a real Postgres: off is off whoever turned
 * it, turned on the ladder starts over, a blocked bot does not overwrite the person's own word and
 * an unblocked one turns on only what blocking turned off, the counters of `reminder_days`, and
 * both routes — the app's and the bot's.
 *
 * Yerevan is UTC+4 all year: 19:00 there is 15:00Z.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { dueRemindersSchema } from '@molvia/model'
import type { DueReminders, ReminderSwitch } from '@molvia/model'
import { createReminderRepository } from '@/db/reminders-repository'
import type { ReminderRepository } from '@/db/reminders-repository'
import { actors, expenses, ratingReminders, reminderDays } from '@/db/schema'
import { buildServer } from '@/server'
import { remindRatings } from '@/usecases/remind-ratings'
import { connectDrizzle } from './db'
import {
  clearAll,
  insertActor,
  insertItem,
  insertPlace,
  insertTrip,
  signIn,
  telegramId,
} from './fixtures'

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

function yerevan(day: string, time: string): Date {
  return new Date(`${day}T${time}:00.000+04:00`)
}

let failures: unknown[] = []
beforeEach(() => {
  failures = []
})

async function evening(
  day: string,
  repository: ReminderRepository = reminders,
): Promise<DueReminders> {
  const due = await remindRatings(
    repository,
    yerevan(day, '19:00'),
    (error) => failures.push(error),
    new Map(),
  )
  return dueRemindersSchema.parse(due)
}

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
  readonly cookie: string
}

async function person(): Promise<Person> {
  const tg = telegramId()
  const id = await insertActor(db, { telegramUserId: tg })
  return { id, tg, cookie: await signIn(db, id) }
}

let shop: string
beforeEach(async () => {
  shop = await insertPlace(db, { name: 'Ереван Сити' })
})

async function bought(who: Person, name: string, at: Date): Promise<void> {
  const itemId = await insertItem(db, { name, kind: 'product', searchKey: name })
  const tripId = await insertTrip(db, { actorId: who.id, placeId: shop, startedAt: at })
  await db.insert(expenses).values({ id: randomUUID(), tripId, itemId, createdAt: at })
}

async function ladderOf(who: Person) {
  const [row] = await db.select().from(ratingReminders).where(eq(ratingReminders.actorId, who.id))
  return row ? { step: row.step, remindedOn: row.remindedOn } : null
}

async function offOf(who: Person) {
  const [row] = await db
    .select({ off: actors.remindersOff })
    .from(actors)
    .where(eq(actors.id, who.id))
  return row?.off
}

/** The off counters of every day, summed: the days are the server's real today. */
async function turnedOff() {
  const rows = await db.select().from(reminderDays)
  const sum = (pick: (row: (typeof rows)[number]) => number) =>
    rows.reduce((total, row) => total + pick(row), 0)
  return {
    button: sum((row) => row.offButton),
    settings: sum((row) => row.offSettings),
    blocked: sum((row) => row.offBlocked),
  }
}

async function read(who: Person) {
  return app.inject({
    method: 'GET',
    url: '/actors/me/reminders',
    headers: { cookie: who.cookie },
  })
}

async function choose(who: Person, payload: unknown) {
  return app.inject({
    method: 'PUT',
    url: '/actors/me/reminders',
    headers: { cookie: who.cookie },
    payload: payload as Record<string, unknown>,
  })
}

async function fromBot(payload: unknown, secret: string | null = botSecret) {
  return app.inject({
    method: 'POST',
    url: '/internal/reminders/switch',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
    payload: payload as Record<string, unknown>,
  })
}

async function bot(who: Person, change: ReminderSwitch) {
  const response = await fromBot({ telegramUserId: who.tg, change })
  expect(response.statusCode, change).toBe(204)
}

describe('«Напоминать об оценке в Telegram» в настройках', () => {
  it('у нового аккаунта включено', async () => {
    const anna = await person()
    const response = await read(anna)
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ off: null })
  })

  it('выключается и включается, повтор — тот же ответ', async () => {
    const anna = await person()
    for (const _ of [1, 2]) {
      const response = await choose(anna, { on: false })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.json()).toEqual({ off: 'chosen' })
    }
    expect((await read(anna)).json()).toEqual({ off: 'chosen' })
    expect((await choose(anna, { on: true })).json()).toEqual({ off: null })
    expect((await choose(anna, { on: true })).json()).toEqual({ off: null })
    expect((await read(anna)).json()).toEqual({ off: null })
  })

  it('кривое тело — 400, прежнее остаётся', async () => {
    const anna = await person()
    await choose(anna, { on: false })
    for (const payload of [{}, { on: 'true' }, { on: 1 }, { on: true, off: null }, { off: null }]) {
      expect((await choose(anna, payload)).statusCode, JSON.stringify(payload)).toBe(400)
    }
    expect(await offOf(anna)).toBe('chosen')
  })

  it('у каждого свой: чужой не виден и не трогается', async () => {
    const anna = await person()
    const boris = await person()
    await choose(anna, { on: false })
    expect((await read(boris)).json()).toEqual({ off: null })
    await bot(boris, 'blocked')
    expect((await read(anna)).json()).toEqual({ off: 'chosen' })
    expect((await read(boris)).json()).toEqual({ off: 'blocked' })
  })

  it('без сессии — 401 на обеих ручках', async () => {
    for (const method of ['GET', 'PUT'] as const) {
      const response = await app.inject({
        method,
        url: '/actors/me/reminders',
        ...(method === 'PUT' ? { payload: { on: false } } : {}),
      })
      expect(response.statusCode, method).toBe(401)
    }
  })

  it('/actors/me его не несёт: установленное приложение читает его строго (Р-1)', async () => {
    const anna = await person()
    await choose(anna, { on: false })
    const response = await app.inject({
      method: 'GET',
      url: '/actors/me',
      headers: { cookie: anna.cookie },
    })
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json())).not.toContain('reminders')
  })
})

describe('выключено — значит выключено', () => {
  it('выключившему вечер не приходит, лестница и счётчики не двигаются', async () => {
    const anna = await person()
    const boris = await person()
    await bought(anna, 'Молоко', yerevan('2026-07-13', '10:00'))
    await bought(boris, 'Кефир', yerevan('2026-07-13', '10:00'))
    await choose(anna, { on: false })

    expect(asked(await evening('2026-07-14'))).toEqual({ [boris.tg]: ['Кефир'] })
    expect(await ladderOf(anna)).toBeNull()
    const [day] = await db.select().from(reminderDays).where(eq(reminderDays.day, '2026-07-14'))
    expect(day?.firstSteps).toBe(1)
  })

  it('заблокировавшему — тоже, и ступень 2 не приходит', async () => {
    const anna = await person()
    await bought(anna, 'Молоко', yerevan('2026-07-12', '10:00'))
    await evening('2026-07-13')
    await bot(anna, 'blocked')

    expect(asked(await evening('2026-07-16'))).toEqual({})
    expect(await ladderOf(anna)).toEqual({ step: 1, remindedOn: '2026-07-13' })
  })

  it('выключил между чтением кандидатов и выдачей — выдача его не помечает', async () => {
    const anna = await person()
    await bought(anna, 'Молоко', yerevan('2026-07-13', '10:00'))
    const late: ReminderRepository = {
      ...reminders,
      candidates: async () => {
        const found = await reminders.candidates()
        await reminders.switchReminders({ actorId: anna.id }, 'off', 'settings')
        return found
      },
    }

    expect(asked(await evening('2026-07-14', late))).toEqual({})
    expect(await ladderOf(anna)).toBeNull()
    expect(failures).toEqual([])
  })
})

describe('включение начинает лестницу заново (Р-3)', () => {
  it('после паузы — ступень 1 только о вчерашнем, а не просроченная ступень 2 обо всём', async () => {
    const anna = await person()
    await bought(anna, 'Молоко', yerevan('2026-07-12', '10:00'))
    expect(asked(await evening('2026-07-13'))).toEqual({ [anna.tg]: ['Молоко'] })
    await choose(anna, { on: false })
    await bought(anna, 'Кефир', yerevan('2026-07-20', '10:00'))

    await choose(anna, { on: true })
    expect(await ladderOf(anna)).toBeNull()
    expect(asked(await evening('2026-07-21'))).toEqual({ [anna.tg]: ['Кефир'] })
    expect(await ladderOf(anna)).toEqual({ step: 1, remindedOn: '2026-07-21' })
  })

  it('повторное «включить» на включённом лестницу не трогает', async () => {
    const anna = await person()
    await bought(anna, 'Молоко', yerevan('2026-07-12', '10:00'))
    await evening('2026-07-13')

    await choose(anna, { on: true })
    await bot(anna, 'on')
    await bot(anna, 'unblocked')
    expect(await ladderOf(anna)).toEqual({ step: 1, remindedOn: '2026-07-13' })
  })
})

describe('бот: кнопки, блокировка и разблокировка', () => {
  it('«Не напоминать» и «Вернуть напоминания» — голос того, кто нажал', async () => {
    const anna = await person()
    await bot(anna, 'off')
    expect(await offOf(anna)).toBe('chosen')
    await bot(anna, 'on')
    expect(await offOf(anna)).toBeNull()
  })

  it('блокировка выключает; своё «выключить» блокировка не перетирает', async () => {
    const anna = await person()
    const boris = await person()
    await bot(anna, 'blocked')
    await choose(boris, { on: false })
    await bot(boris, 'blocked')

    expect(await offOf(anna)).toBe('blocked')
    expect(await offOf(boris)).toBe('chosen')
  })

  it('разблокировка включает только выключенное блокировкой (В-1)', async () => {
    const anna = await person()
    const boris = await person()
    await bot(anna, 'blocked')
    await choose(boris, { on: false })
    await bot(boris, 'unblocked')
    await bot(anna, 'unblocked')

    expect(await offOf(anna)).toBeNull()
    expect(await offOf(boris)).toBe('chosen')
  })

  it('включение в настройках снимает и блокировку', async () => {
    const anna = await person()
    await bot(anna, 'blocked')
    expect((await choose(anna, { on: true })).json()).toEqual({ off: null })
  })

  it('незнакомый Telegram-id — 204, и ничего не записано', async () => {
    await person()
    const response = await fromBot({ telegramUserId: telegramId(), change: 'off' })
    expect(response.statusCode).toBe(204)
    expect(await db.select().from(reminderDays)).toEqual([])
    const rows = await db.select({ off: actors.remindersOff }).from(actors)
    expect(rows).toEqual([{ off: null }])
  })

  it('без секрета — 401; кривое тело — 400; ничего не записано', async () => {
    const anna = await person()
    expect((await fromBot({ telegramUserId: anna.tg, change: 'off' }, null)).statusCode).toBe(401)
    expect(
      (await fromBot({ telegramUserId: anna.tg, change: 'off' }, `${botSecret}x`)).statusCode,
    ).toBe(401)
    for (const payload of [
      { telegramUserId: anna.tg },
      { telegramUserId: anna.tg, change: 'chosen' },
      { telegramUserId: anna.tg, change: 'off', actorId: anna.id },
      { telegramUserId: 0, change: 'off' },
    ]) {
      expect((await fromBot(payload)).statusCode, JSON.stringify(payload)).toBe(400)
    }
    expect(await offOf(anna)).toBeNull()
  })
})

describe('счётчики выключений (В-4)', () => {
  it('каждый способ — в свою колонку, только переход из «включено»', async () => {
    const anna = await person()
    const boris = await person()
    const vera = await person()
    await bot(anna, 'off')
    await bot(anna, 'off')
    await choose(boris, { on: false })
    await choose(boris, { on: false })
    await bot(vera, 'blocked')
    await bot(vera, 'blocked')
    // Already off: neither the settings over a blocked bot nor a block over «chosen» is counted.
    await choose(vera, { on: false })
    await bot(boris, 'blocked')

    expect(await turnedOff()).toEqual({ button: 1, settings: 1, blocked: 1 })
  })

  it('включил и выключил снова — второй раз тоже считается', async () => {
    const anna = await person()
    await choose(anna, { on: false })
    await choose(anna, { on: true })
    await choose(anna, { on: false })
    await bot(anna, 'unblocked')

    expect(await turnedOff()).toEqual({ button: 0, settings: 2, blocked: 0 })
  })

  it('строки без id: у счётчика нет ни одного идентификатора', async () => {
    const anna = await person()
    await bot(anna, 'blocked')
    const [row] = await db.select().from(reminderDays)
    expect(JSON.stringify(row)).not.toContain(anna.id)
    expect(JSON.stringify(row)).not.toContain(String(anna.tg))
  })
})
