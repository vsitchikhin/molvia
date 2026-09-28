import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { moneyMonthCodec, parseRate } from '@molvia/model'
import type { MoneyMonthView } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createMoneyRepository } from '@/db/money-repository'
import { moneyMonthRates } from '@/db/schema'
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

async function signedIn(): Promise<{ id: string; cookie: string }> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

async function put(cookie: string, payload: unknown) {
  return app.inject({
    method: 'PUT',
    url: '/actors/me/salary-shift',
    headers: { cookie },
    payload: payload as Record<string, unknown>,
  })
}

async function month(cookie: string, value: string): Promise<MoneyMonthView> {
  const response = await app.inject({
    method: 'GET',
    url: `/money/months/${value}`,
    headers: { cookie },
  })
  expect(response.statusCode).toBe(200)
  return moneyMonthCodec.parse(response.json())
}

async function receive(cookie: string, amount: string, receivedOn: string, source = 'salary') {
  const response = await app.inject({
    method: 'POST',
    url: '/incomes',
    headers: { cookie },
    payload: { id: randomUUID(), amount: { amount, currency: 'RUB' }, receivedOn, source },
  })
  expect(response.statusCode).toBe(201)
}

async function read(cookie: string) {
  return app.inject({ method: 'GET', url: '/actors/me/salary-shift', headers: { cookie } })
}

describe('«Зарплата с … числа — в следующий месяц» (MOL-134, В-3)', () => {
  it('у нового аккаунта выключена', async () => {
    const { cookie } = await signedIn()
    const response = await read(cookie)
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ day: null })
  })

  it('включается числом, повтор — тот же ответ, выключается null', async () => {
    const { cookie } = await signedIn()
    for (const day of [25, 25]) {
      const response = await put(cookie, { day })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.json()).toEqual({ day: 25 })
    }
    expect((await read(cookie)).json()).toEqual({ day: 25 })
    expect((await put(cookie, { day: null })).json()).toEqual({ day: null })
    expect((await read(cookie)).json()).toEqual({ day: null })
  })

  it('границы: 1 и 31 — да; 0, 32, дробь, строка и пустое тело — 400, прежнее остаётся', async () => {
    const { cookie } = await signedIn()
    expect((await put(cookie, { day: 1 })).json()).toEqual({ day: 1 })
    expect((await put(cookie, { day: 31 })).json()).toEqual({ day: 31 })
    for (const payload of [{ day: 0 }, { day: 32 }, { day: 2.5 }, { day: '25' }, {}]) {
      expect((await put(cookie, payload)).statusCode, JSON.stringify(payload)).toBe(400)
    }
    expect((await read(cookie)).json()).toEqual({ day: 31 })
  })

  it('у каждого своя: чужая настройка не видна и не трогается', async () => {
    const me = await signedIn()
    const other = await signedIn()
    await put(me.cookie, { day: 25 })
    expect((await read(other.cookie)).json()).toEqual({ day: null })
    await put(other.cookie, { day: 10 })
    expect((await read(me.cookie)).json()).toEqual({ day: 25 })
  })

  it('без сессии — 401 на обеих ручках', async () => {
    for (const method of ['GET', 'PUT'] as const) {
      const response = await app.inject({
        method,
        url: '/actors/me/salary-shift',
        ...(method === 'PUT' ? { payload: { day: 25 } } : {}),
      })
      expect(response.statusCode, method).toBe(401)
    }
  })

  it('смена не размораживает прошлые месяцы: в них заморожен курс, а «Пришло» считается при чтении', async () => {
    const { id, cookie } = await signedIn()
    await createMoneyRepository(db).freeze(id, '2026-08', {
      base: 'RUB',
      quote: 'AMD',
      scaled: parseRate('4.5'),
      source: 'official',
      asOf: new Date('2026-08-31T00:00:00+04:00'),
    })
    expect((await put(cookie, { day: 25 })).statusCode).toBe(200)
    expect(await db.select().from(moneyMonthRates)).toHaveLength(1)
  })

  it('зарплата 31.08 при «с 25-го» — в «Пришло» сентября, со сносками в обе стороны; день дохода тот же', async () => {
    const { cookie } = await signedIn()
    await receive(cookie, '51000', '2026-08-10')
    await receive(cookie, '102345', '2026-08-31')
    await receive(cookie, '99615', '2026-09-15')
    await receive(cookie, '700', '2026-08-31', 'bonus')

    expect((await month(cookie, '2026-09')).income).toEqual({ minor: 9961500n, currency: 'RUB' })
    await put(cookie, { day: 25 })
    const september = await month(cookie, '2026-09')
    expect(september.income).toEqual({ minor: 20196000n, currency: 'RUB' })
    expect(september).toMatchObject({ shiftedIn: ['2026-08-31'], shiftedOut: [] })
    const august = await month(cookie, '2026-08')
    expect(august.income).toEqual({ minor: 5170000n, currency: 'RUB' })
    expect(august).toMatchObject({ shiftedIn: [], shiftedOut: ['2026-08-31'] })

    const journal = await app.inject({ method: 'GET', url: '/incomes', headers: { cookie } })
    expect(JSON.stringify(journal.json())).toContain('"receivedOn":"2026-08-31"')
  })
})
