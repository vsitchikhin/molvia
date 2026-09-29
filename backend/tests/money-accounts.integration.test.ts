import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ERROR,
  accountCheckCodec,
  accountJournalCodec,
  accountsHeldCodec,
  exchangesResponseCodec,
  journalCursorCodec,
  latestDay,
  moneyAccountsCodec,
  parseRate,
  spendingCategoriesResponseCodec,
  spendingViewCodec,
  tripViewCodec,
  unassignedOperationsCodec,
  yerevanDate,
  yerevanMidnight,
} from '@molvia/model'
import type { CachedRate, MoneyAccountsResponse } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createMoneyAccountRepository } from '@/db/money-accounts-repository'
import { createRateRepository } from '@/db/rates-repository'
import { expenses, moneyAccounts, moneyMonthRates, spendings } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip, signIn } from './fixtures'

const { db, close } = connectDrizzle()
const rates = createRateRepository(db)
const accountsRepository = createMoneyAccountRepository(db)
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

const today = yerevanDate(new Date())
const daysAgo = (days: number): string =>
  yerevanDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000))
const official = (currency: 'RUB' | 'USD' | 'EUR', value: string, date: string): CachedRate => ({
  provider: 'cba',
  currency,
  date,
  scaled: parseRate(value),
  jump: false,
})
const amd = (amount: string) => ({ amount, currency: 'AMD' })
const rub = (amount: string) => ({ amount, currency: 'RUB' })

interface Owner {
  readonly id: string
  readonly cookie: string
}

async function owner(): Promise<Owner> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

async function call(
  me: Owner,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { cookie: me.cookie },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
}

async function overview(me: Owner): Promise<MoneyAccountsResponse> {
  const response = await call(me, 'GET', '/money/accounts')
  expect(response.statusCode).toBe(200)
  expect(response.headers['cache-control']).toBe('no-store')
  return moneyAccountsCodec.parse(response.json())
}

async function addAccount(
  me: Owner,
  patch: Record<string, unknown> = {},
): Promise<{ id: string; body: Record<string, unknown> }> {
  const body = {
    id: randomUUID(),
    name: 'Наличные ֏',
    currency: 'AMD',
    savings: false,
    start: amd('100000'),
    startOn: daysAgo(5),
    ...patch,
  }
  const response = await call(me, 'POST', '/money/accounts', body)
  expect(response.statusCode, response.body).toBe(201)
  return { id: body.id, body }
}

async function balanceOf(me: Owner, id: string) {
  const account = (await overview(me)).accounts.find((candidate) => candidate.id === id)
  if (!account) throw new Error(`no account ${id}`)
  return account
}

async function categoryId(me: Owner): Promise<string> {
  const response = await call(me, 'GET', '/spending-categories')
  const { categories } = spendingCategoriesResponseCodec.parse(response.json())
  const other = categories.find((category) => category.preset === 'other')
  if (!other) throw new Error('no preset «other»')
  return other.id
}

/** A body without the fields named: an amendment is the body whole, less its name. */
function without(body: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !keys.includes(key)))
}

async function spend(me: Owner, patch: Record<string, unknown> = {}) {
  const body: Record<string, unknown> & { id: string } = {
    id: randomUUID(),
    spentOn: today,
    amount: amd('5000'),
    categoryId: await categoryId(me),
    ...patch,
  }
  const response = await call(me, 'POST', '/spendings', body)
  return { response, body }
}

describe('счёт: добавить, повтор, имя (MOL-115)', () => {
  it('добавляет, повтор тем же — 200, другое тело под тем же id — 409', async () => {
    const me = await owner()
    const { body } = await addAccount(me)
    expect((await call(me, 'POST', '/money/accounts', body)).statusCode).toBe(200)
    const other = await call(me, 'POST', '/money/accounts', { ...body, start: amd('1') })
    expect(other.statusCode).toBe(409)
    expect(other.json()).toMatchObject({ code: ERROR.CONFLICT })
    const [account] = (await overview(me)).accounts
    expect(account).toMatchObject({
      name: 'Наличные ֏',
      balance: { minor: 10_000_000n, currency: 'AMD' },
      hasOperations: false,
      lastCheckedOn: null,
      archivedAt: null,
    })
  })

  it('не даёт второе имя без учёта регистра — среди убранных тоже (Р-21)', async () => {
    const me = await owner()
    const { id } = await addAccount(me, { name: 'Карта' })
    await spend(me, { accountId: id })
    expect((await call(me, 'DELETE', `/money/accounts/${id}`)).statusCode).toBe(200)
    const again = await call(me, 'POST', '/money/accounts', {
      id: randomUUID(),
      name: 'КАРТА',
      currency: 'AMD',
      savings: false,
      start: amd('0'),
      startOn: today,
    })
    expect(again.statusCode).toBe(409)
    expect(again.json()).toMatchObject({ code: ERROR.MONEY_ACCOUNT_TAKEN })
  })

  it('не берёт старт из будущего и старт в чужой валюте', async () => {
    const me = await owner()
    const future = latestDay(new Date(Date.now() + 24 * 60 * 60 * 1000))
    const late = await call(me, 'POST', '/money/accounts', {
      id: randomUUID(),
      name: 'Завтра',
      currency: 'AMD',
      savings: false,
      start: amd('1'),
      startOn: future,
    })
    expect(late.json()).toMatchObject({ code: ERROR.MONEY_ACCOUNT_IN_FUTURE })
    const mixed = await call(me, 'POST', '/money/accounts', {
      id: randomUUID(),
      name: 'Смесь',
      currency: 'AMD',
      savings: false,
      start: rub('1'),
      startOn: today,
    })
    expect(mixed.statusCode).toBe(400)
  })

  it('держит отрицательный старт — кредитка это имя', async () => {
    const me = await owner()
    const { id } = await addAccount(me, { name: 'Кредитка', start: amd('-12400') })
    expect((await balanceOf(me, id)).balance).toEqual({ minor: -1_240_000n, currency: 'AMD' })
  })
})

describe('чужое — один 404, во всех ручках и во всех операциях', () => {
  it('чужого счёта нет ни в списке, ни по адресу, ни у операции', async () => {
    const anna = await owner()
    const boris = await owner()
    const { id } = await addAccount(anna)
    expect((await overview(boris)).accounts).toEqual([])
    for (const [method, url, body] of [
      ['GET', `/money/accounts/${id}/journal`, undefined],
      [
        'PUT',
        `/money/accounts/${id}`,
        {
          revision: 1,
          name: 'Моё',
          currency: 'AMD',
          savings: false,
          start: amd('0'),
          startOn: today,
        },
      ],
      ['DELETE', `/money/accounts/${id}`, undefined],
      ['POST', `/money/accounts/${id}/restore`, undefined],
      ['POST', `/money/accounts/${id}/checks`, { id: randomUUID(), fact: amd('1') }],
      ['GET', '/money/accounts/not-a-uuid/journal', undefined],
    ] as const) {
      const response = await call(boris, method, url, body)
      expect(response.statusCode, `${method} ${url}`).toBe(404)
    }
    // Someone else's account is «без счёта», exactly as one deleted for good is (Д3, Р-28): the
    // operation is written, and nothing tells the two apart.
    const { response } = await spend(boris, { accountId: id })
    expect(response.statusCode).toBe(201)
    expect(spendingViewCodec.parse(response.json()).accountId).toBeNull()
    const income = await call(boris, 'POST', '/incomes', {
      id: randomUUID(),
      amount: amd('100'),
      receivedOn: today,
      source: 'salary',
      accountId: id,
    })
    expect(income.statusCode).toBe(201)
    expect((await overview(boris)).unassigned).toBe(0)
    // And the account of Anna's stays as it was.
    expect((await balanceOf(anna, id)).balance.minor).toBe(10_000_000n)
  })

  it('чужой поход — 404, и на свой поход чужой счёт не ложится', async () => {
    const anna = await owner()
    const boris = await owner()
    const { id: annasAccount } = await addAccount(anna)
    const place = await insertPlace(db)
    const annasTrip = await insertTrip(db, { actorId: anna.id, placeId: place })
    const borisTrip = await insertTrip(db, { actorId: boris.id, placeId: place })
    const stranger = await call(boris, 'PUT', `/trips/${annasTrip}/payment`, { accountId: null })
    expect(stranger.statusCode).toBe(404)
    const foreign = await call(boris, 'PUT', `/trips/${borisTrip}/payment`, {
      accountId: annasAccount,
    })
    expect(tripViewCodec.parse(foreign.json())).toMatchObject({ accountId: null, debited: null })
  })

  it('база сама не даёт операции чужой счёт', async () => {
    const anna = await owner()
    const boris = await owner()
    const { id } = await addAccount(anna)
    const { body } = await spend(boris)
    await expect(
      db.update(spendings).set({ accountId: id }).where(eq(spendings.id, body.id)),
    ).rejects.toThrow()
  })
})

describe('остаток — старт и всё после дня старта', () => {
  it('считает трату, доход, обмен и поход; операция в день старта — история', async () => {
    const me = await owner()
    const { id } = await addAccount(me, { startOn: daysAgo(5) })
    await spend(me, { accountId: id, spentOn: daysAgo(5), amount: amd('999') })
    await spend(me, { accountId: id, amount: amd('5000') })
    const income = await call(me, 'POST', '/incomes', {
      id: randomUUID(),
      amount: amd('20000'),
      receivedOn: daysAgo(1),
      source: 'gift',
      accountId: id,
    })
    expect(income.statusCode, income.body).toBe(201)
    const exchange = await call(me, 'POST', '/exchanges', {
      id: randomUUID(),
      given: rub('1000'),
      received: amd('4700'),
      exchangedOn: daysAgo(2),
      receivedAccountId: id,
    })
    expect(exchange.statusCode, exchange.body).toBe(201)
    const place = await insertPlace(db)
    const trip = await insertTrip(db, { actorId: me.id, placeId: place })
    await db.insert(expenses).values([
      {
        id: randomUUID(),
        tripId: trip,
        itemId: await insertItem(db),
        amountMinor: 300000n,
        amountCurrency: 'AMD',
      },
      { id: randomUUID(), tripId: trip, itemId: await insertItem(db) },
    ])
    const paid = await call(me, 'PUT', `/trips/${trip}/payment`, { accountId: id })
    expect(paid.statusCode, paid.body).toBe(200)
    expect(tripViewCodec.parse(paid.json())).toMatchObject({ accountId: id, debited: null })

    // 100 000 − 5 000 + 20 000 + 4 700 − 3 000; the 999 of the start day is history.
    const account = await balanceOf(me, id)
    expect(account).toMatchObject({
      balance: { minor: 11_670_000n, currency: 'AMD' },
      approximate: false,
      hasOperations: true,
    })
  })

  it('доход и сторона обмена на счёт чужой валюты — «без счёта», не отказ (Р-31, Е1)', async () => {
    const me = await owner()
    const { id } = await addAccount(me, { name: 'Карта ₽', currency: 'RUB', start: rub('0') })
    const income = await call(me, 'POST', '/incomes', {
      id: randomUUID(),
      amount: amd('100'),
      receivedOn: today,
      source: 'gift',
      accountId: id,
    })
    expect(income.statusCode).toBe(201)
    const exchange = await call(me, 'POST', '/exchanges', {
      id: randomUUID(),
      given: rub('1000'),
      received: amd('4700'),
      exchangedOn: today,
      receivedAccountId: id,
    })
    expect(exchange.statusCode).toBe(201)
    expect((await balanceOf(me, id)).hasOperations).toBe(false)
    // Only the rouble half of the exchange is asked about: there is no dram account for the rest.
    expect((await overview(me)).unassigned).toBe(1)
  })

  it('«списано» — точно, без него — ≈ по курсу дня, в той же валюте — отказ', async () => {
    const me = await owner()
    await rates.upsert([official('RUB', '4.15', today)])
    await db.execute(sql`update actors set rate_preference = 'official' where id = ${me.id}`)
    const { id } = await addAccount(me, { name: 'Безнал ₽', currency: 'RUB', start: rub('10000') })
    const exact = await spend(me, { accountId: id, amount: amd('9891'), debited: rub('2331.85') })
    expect(exact.response.statusCode, exact.response.body).toBe(201)
    expect(spendingViewCodec.parse(exact.response.json())).toMatchObject({
      accountId: id,
      debited: { minor: 233_185n, currency: 'RUB' },
    })
    expect(await balanceOf(me, id)).toMatchObject({
      balance: { minor: 766_815n, currency: 'RUB' },
      approximate: false,
    })
    // 9 891 ֏ at 4,15 is 2 383,37 ₽.
    await spend(me, { accountId: id, amount: amd('9891') })
    expect(await balanceOf(me, id)).toMatchObject({
      balance: { minor: 528_478n, currency: 'RUB' },
      approximate: true,
    })
    // «Списано» in the spending's own currency does not apply: dropped, the account stays (Р-31).
    const same = await spend(me, { accountId: id, amount: rub('10'), debited: rub('10') })
    expect(spendingViewCodec.parse(same.response.json())).toMatchObject({
      accountId: id,
      debited: null,
    })
    const noAccount = await spend(me, { accountId: null, debited: rub('10') })
    expect(noAccount.response.statusCode).toBe(400)
    // Left out, the account is none, and «списано» goes with it — not a 500 (review Р2-1).
    const leftOut = await spend(me, { debited: rub('10'), amount: amd('100') })
    expect(leftOut.response.statusCode, leftOut.response.body).toBe(201)
    expect(spendingViewCodec.parse(leftOut.response.json())).toMatchObject({
      accountId: null,
      debited: null,
    })
  })
})

describe('поход на счёте (п. 6, Р-18)', () => {
  it('завершённый — днём начала (Р-29); «списано» — вся сумма; без цены — причина', async () => {
    const me = await owner()
    const cash = await addAccount(me, { startOn: daysAgo(5) })
    const card = await addAccount(me, {
      name: 'Карта ₽',
      currency: 'RUB',
      start: rub('1000'),
      startOn: daysAgo(5),
    })
    const place = await insertPlace(db, { name: 'Ереван Сити' })
    const finished = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const started = new Date(finished.getTime() - 60 * 60 * 1000)
    const trip = await insertTrip(db, {
      actorId: me.id,
      placeId: place,
      startedAt: started,
      finishedAt: new Date(),
      finishedOnDeviceAt: finished,
    })
    await db.insert(expenses).values([
      {
        id: randomUUID(),
        tripId: trip,
        itemId: await insertItem(db),
        amountMinor: 348000n,
        amountCurrency: 'AMD',
      },
      { id: randomUUID(), tripId: trip, itemId: await insertItem(db) },
    ])
    await call(me, 'PUT', `/trips/${trip}/payment`, { accountId: cash.id })
    const journal = accountJournalCodec.parse(
      (await call(me, 'GET', `/money/accounts/${cash.id}/journal`)).json(),
    )
    expect(journal.rows).toEqual([
      expect.objectContaining({
        kind: 'trip',
        // A trip is dated by the day it started — the earlier of the server's start and the
        // device's finish (Р-29). Dated by the finish, this failed for the hour after Yerevan's
        // midnight, when the start an hour earlier fell on the day before.
        day: yerevanDate(started),
        moved: { minor: -348000n, currency: 'AMD' },
        place: 'Ереван Сити',
        items: 2,
        unpriced: 1,
        revision: null,
      }),
    ])
    const check = accountCheckCodec.parse(
      (
        await call(me, 'POST', `/money/accounts/${cash.id}/checks`, {
          id: randomUUID(),
          fact: amd('96520'),
        })
      ).json(),
    )
    expect(check.difference.minor).toBe(0n)
    expect(check.reasons.map(({ kind }) => kind)).toEqual(['unpriced'])

    // Everything in drams: «списано» does not apply and is dropped, a repeat is the same (Е3).
    const same = await call(me, 'PUT', `/trips/${trip}/payment`, {
      accountId: cash.id,
      debited: amd('3480'),
    })
    expect(tripViewCodec.parse(same.json())).toMatchObject({ accountId: cash.id, debited: null })
    const byCard = await call(me, 'PUT', `/trips/${trip}/payment`, {
      accountId: card.id,
      debited: rub('820'),
    })
    expect(tripViewCodec.parse(byCard.json())).toMatchObject({
      accountId: card.id,
      debited: { minor: 82000n, currency: 'RUB' },
    })
    expect((await balanceOf(me, card.id)).balance.minor).toBe(18000n)
    expect((await balanceOf(me, cash.id)).balance.minor).toBe(10_000_000n)
  })
})

describe('правка операции и счёт (Р-15, Р-26)', () => {
  it('правка без поля счёта оставляет счёт, null — снимает', async () => {
    const me = await owner()
    const { id } = await addAccount(me)
    const { body } = await spend(me, { accountId: id })
    const spendingId = body.id
    const fields = without(body, 'id', 'accountId')
    const kept = await call(me, 'PUT', `/spendings/${spendingId}`, {
      ...fields,
      revision: 1,
      note: 'поправил заметку',
    })
    expect(spendingViewCodec.parse(kept.json()).accountId).toBe(id)
    const cleared = await call(me, 'PUT', `/spendings/${spendingId}`, {
      ...fields,
      revision: 2,
      note: 'поправил заметку',
      accountId: null,
    })
    expect(spendingViewCodec.parse(cleared.json()).accountId).toBeNull()
  })

  it('повтор POST без счёта после назначения счёта — всё ещё повтор', async () => {
    const me = await owner()
    const { id } = await addAccount(me)
    const { body } = await spend(me)
    const spendingId = body.id
    const fields = without(body, 'id')
    await call(me, 'PUT', `/spendings/${spendingId}`, { ...fields, revision: 1, accountId: id })
    const again = await call(me, 'POST', '/spendings', body)
    expect(again.statusCode).toBe(200)
    expect(spendingViewCodec.parse(again.json()).accountId).toBe(id)
  })

  it('счёт у обмена — не правка: без версии, без «исправлен», месяц не размораживается', async () => {
    const me = await owner()
    const { id } = await addAccount(me)
    const exchange = {
      id: randomUUID(),
      given: rub('1000'),
      received: amd('4700'),
      exchangedOn: daysAgo(40),
    }
    await call(me, 'POST', '/exchanges', exchange)
    await db.insert(moneyMonthRates).values({
      actorId: me.id,
      month: daysAgo(40).slice(0, 7),
      base: 'RUB',
      quote: 'AMD',
      scaled: parseRate('4.7'),
      source: 'personal',
      asOf: new Date(),
    })
    const { id: exchangeId, ...fields } = exchange
    const response = await call(me, 'PUT', `/exchanges/${exchangeId}`, {
      ...fields,
      revision: 1,
      receivedAccountId: id,
    })
    expect(response.statusCode, response.body).toBe(200)
    const [row] = exchangesResponseCodec.parse(response.json()).exchanges
    expect(row).toMatchObject({ receivedAccountId: id, revision: 2, amendedAt: null, history: [] })
    expect(
      await db.select().from(moneyMonthRates).where(eq(moneyMonthRates.actorId, me.id)),
    ).toHaveLength(1)

    // An amendment of the amount over the old version is a conflict, not lost.
    const stale = await call(me, 'PUT', `/exchanges/${exchangeId}`, {
      ...fields,
      received: amd('4800'),
      revision: 1,
    })
    expect(stale.statusCode).toBe(409)
    // And one of the amount itself keeps the account it was not told about, thaws, and leaves a version.
    const fact = await call(me, 'PUT', `/exchanges/${exchangeId}`, {
      ...fields,
      received: amd('4800'),
      revision: 2,
    })
    const [amended] = exchangesResponseCodec.parse(fact.json()).exchanges
    expect(amended).toMatchObject({ receivedAccountId: id, revision: 3 })
    expect(amended?.history).toHaveLength(1)
    expect(
      await db.select().from(moneyMonthRates).where(eq(moneyMonthRates.actorId, me.id)),
    ).toHaveLength(0)
  })
})

describe('удалить или убрать (п. 2)', () => {
  it('без операций — удаляется, «Вернуть» возвращает тот же счёт на то же место', async () => {
    const me = await owner()
    const first = await addAccount(me, { name: 'Первый' })
    await addAccount(me, { name: 'Второй' })
    const removed = moneyAccountsCodec.parse(
      (await call(me, 'DELETE', `/money/accounts/${first.id}`)).json(),
    )
    expect(removed.accounts.map(({ name }) => name)).toEqual(['Второй'])
    const back = await call(me, 'POST', `/money/accounts/${first.id}/restore`)
    expect(back.statusCode).toBe(200)
    expect(moneyAccountsCodec.parse(back.json()).accounts.map(({ name }) => name)).toEqual([
      'Первый',
      'Второй',
    ])
  })

  it('с операциями — убирается из выбора, история и остаток остаются, в итоги не входит', async () => {
    const me = await owner()
    const { id } = await addAccount(me)
    await spend(me, { accountId: id })
    const removed = moneyAccountsCodec.parse(
      (await call(me, 'DELETE', `/money/accounts/${id}`)).json(),
    )
    expect(removed.accounts[0]).toMatchObject({
      balance: { minor: 9_500_000n, currency: 'AMD' },
      hasOperations: true,
    })
    expect(removed.accounts[0]?.archivedAt).not.toBeNull()
    expect(removed.totals.total.minor).toBe(0n)
    // Still takes an operation: what was queued offline is not lost to it (Р-12).
    expect((await spend(me, { accountId: id })).response.statusCode).toBe(201)
    const back = await call(me, 'POST', `/money/accounts/${id}/restore`)
    expect(moneyAccountsCodec.parse(back.json()).accounts[0]?.archivedAt).toBeNull()
  })

  it('операция на помеченный счёт принимается, а после удаления остаётся без счёта (Р-17)', async () => {
    const me = await owner()
    const { id } = await addAccount(me)
    await call(me, 'DELETE', `/money/accounts/${id}`)
    const { response, body } = await spend(me, { accountId: id })
    expect(response.statusCode).toBe(201)
    await db
      .update(moneyAccounts)
      .set({ deletedAt: sql`clock_timestamp() - interval '11 minutes'` })
      .where(eq(moneyAccounts.id, id))
    await accountsRepository.purgeStale()
    const [row] = await db.select().from(spendings).where(eq(spendings.id, body.id))
    expect(row?.accountId).toBeNull()
    expect(await db.select().from(moneyAccounts).where(eq(moneyAccounts.id, id))).toEqual([])
  })

  it('валюта счёта с операциями не меняется, без них — меняется', async () => {
    const me = await owner()
    const { id, body } = await addAccount(me)
    const fields = without(body, 'id')
    const moved = await call(me, 'PUT', `/money/accounts/${id}`, {
      ...fields,
      revision: 1,
      currency: 'RUB',
      start: rub('10'),
    })
    expect(moved.statusCode, moved.body).toBe(200)
    await spend(me, { accountId: id, amount: rub('1') })
    const locked = await call(me, 'PUT', `/money/accounts/${id}`, {
      ...fields,
      revision: 2,
    })
    expect(locked.statusCode).toBe(409)
    expect(locked.json()).toMatchObject({ code: ERROR.MONEY_ACCOUNT_CURRENCY_LOCKED })
  })
})

describe('сверка и «не попали» (п. 7, Р-16, Р-19)', () => {
  it('называет разницу и причину, пересчитывает тот же id после правки, другой факт — 409', async () => {
    const me = await owner()
    const { id } = await addAccount(me, { start: amd('195264') })
    const coffee = await spend(me, { amount: amd('3932') })
    await spend(me, { amount: amd('1200') })
    expect((await overview(me)).unassigned).toBe(2)

    const checkId = randomUUID()
    const first = await call(me, 'POST', `/money/accounts/${id}/checks`, {
      id: checkId,
      fact: amd('190132'),
    })
    expect(first.statusCode, first.body).toBe(200)
    const found = accountCheckCodec.parse(first.json())
    expect(found).toMatchObject({
      counted: { minor: 19_526_400n, currency: 'AMD' },
      difference: { minor: -513_200n, currency: 'AMD' },
      since: daysAgo(5),
    })
    expect(found.reasons.map(({ kind }) => kind)).toEqual(['unassigned', 'unassigned'])

    const coffeeId = coffee.body.id
    const fields = without(coffee.body, 'id')
    await call(me, 'PUT', `/spendings/${coffeeId}`, { ...fields, revision: 1, accountId: id })
    const again = accountCheckCodec.parse(
      (
        await call(me, 'POST', `/money/accounts/${id}/checks`, {
          id: checkId,
          fact: amd('190132'),
        })
      ).json(),
    )
    expect(again.difference.minor).toBe(-120_000n)
    expect(again.reasons).toHaveLength(1)

    const other = await call(me, 'POST', `/money/accounts/${id}/checks`, {
      id: checkId,
      fact: amd('1'),
    })
    expect(other.statusCode).toBe(409)
    expect((await balanceOf(me, id)).lastCheckedOn).toBe(today)
    // A check that did not come out even moves nothing (В-4 of the review, Д7): the taxi it named
    // is still in «не попали», and a new check still names it.
    const unassigned = unassignedOperationsCodec.parse(
      (await call(me, 'GET', '/money/accounts/unassigned')).json(),
    ).rows
    expect(unassigned).toHaveLength(1)
    const next = accountCheckCodec.parse(
      (
        await call(me, 'POST', `/money/accounts/${id}/checks`, {
          id: randomUUID(),
          fact: amd('190132'),
        })
      ).json(),
    )
    expect(next.reasons.map(({ kind }) => kind)).toEqual(['unassigned'])
    // One that does come out even is where the next one starts.
    const even = await call(me, 'POST', `/money/accounts/${id}/checks`, {
      id: randomUUID(),
      fact: amd('191332'),
    })
    expect(accountCheckCodec.parse(even.json()).difference.minor).toBe(0n)
    expect(
      unassignedOperationsCodec.parse((await call(me, 'GET', '/money/accounts/unassigned')).json())
        .rows,
    ).toEqual([])
  })

  it('факт в чужой валюте — отказ', async () => {
    const me = await owner()
    const { id } = await addAccount(me)
    const response = await call(me, 'POST', `/money/accounts/${id}/checks`, {
      id: randomUUID(),
      fact: rub('1'),
    })
    expect(response.json()).toMatchObject({ code: ERROR.MONEY_ACCOUNT_CURRENCY })
  })
})

describe('журнал счёта (п. 10)', () => {
  it('отдаёт по сорок, новые сверху, курсор ключом строки', async () => {
    const me = await owner()
    const { id } = await addAccount(me)
    // Written straight into the table, a second apart: forty-five requests outlived the timeout on a
    // loaded machine, and the order is what is under test.
    const categoryOf = await categoryId(me)
    await db.insert(spendings).values(
      Array.from({ length: 45 }, (_, index) => ({
        id: randomUUID(),
        actorId: me.id,
        spentOn: today,
        amountMinor: BigInt((index + 1) * 100),
        currency: 'AMD' as const,
        categoryId: categoryOf,
        accountId: id,
        createdAt: new Date(Date.now() - (45 - index) * 1000),
      })),
    )
    const first = accountJournalCodec.parse(
      (await call(me, 'GET', `/money/accounts/${id}/journal`)).json(),
    )
    expect(first.rows).toHaveLength(40)
    expect(first.rows[0]?.moved).toEqual({ minor: -4500n, currency: 'AMD' })
    expect(first.cursor).not.toBeNull()
    const cursor = encodeURIComponent(z.encode(journalCursorCodec, first.cursor!))
    const second = accountJournalCodec.parse(
      (await call(me, 'GET', `/money/accounts/${id}/journal?cursor=${cursor}`)).json(),
    )
    expect(second.rows.map(({ moved }) => moved?.minor)).toEqual([
      -500n,
      -400n,
      -300n,
      -200n,
      -100n,
    ])
    expect(second.cursor).toBeNull()
  })

  it('строка несёт версию операции — шторка правит поверх неё (MOL-123, Р-2)', async () => {
    const me = await owner()
    const { id } = await addAccount(me)
    const { body } = await spend(me, { accountId: id })
    await call(me, 'PUT', `/spendings/${body.id}`, {
      ...without(body, 'id'),
      revision: 1,
      note: 'поправил',
    })
    const journal = accountJournalCodec.parse(
      (await call(me, 'GET', `/money/accounts/${id}/journal`)).json(),
    )
    expect(journal.rows).toEqual([
      expect.objectContaining({ id: body.id, revision: 2, note: 'поправил' }),
    ])
  })
})

describe('подсказка «сколько было до обмена» (Р-20)', () => {
  it('складывает счета валюты на конец дня, без самого обмена; начатый в тот день — молчит', async () => {
    const me = await owner()
    await addAccount(me, { name: 'Наличные', start: amd('1000'), startOn: daysAgo(5) })
    await addAccount(me, { name: 'Карта', start: amd('500'), startOn: daysAgo(5) })
    const held = await call(me, 'GET', `/money/accounts/held?currency=AMD&day=${daysAgo(1)}`)
    expect(accountsHeldCodec.parse(held.json())).toEqual({
      held: { minor: 150_000n, currency: 'AMD' },
      approximate: false,
    })
    await addAccount(me, { name: 'Поздний', start: amd('1'), startOn: daysAgo(1) })
    const silent = await call(me, 'GET', `/money/accounts/held?currency=AMD&day=${daysAgo(1)}`)
    expect(accountsHeldCodec.parse(silent.json()).held).toBeNull()
  })
})

describe('итоги (п. 8, Р-22)', () => {
  it('«можно тратить» без сбережений, чужая валюта — ≈ по курсу «Денег»', async () => {
    const me = await owner()
    await db.execute(sql`update actors set rate_preference = 'official' where id = ${me.id}`)
    await rates.upsert([official('USD', '390', today)])
    await addAccount(me, { name: 'Наличные', start: amd('190132') })
    const dollars = await addAccount(me, {
      name: 'Доллары дома',
      currency: 'USD',
      start: { amount: '100', currency: 'USD' },
      savings: true,
    })
    const view = await overview(me)
    expect(view.totals).toEqual({
      total: { minor: 22_913_200n, currency: 'AMD' },
      spendable: { minor: 19_013_200n, currency: 'AMD' },
      savings: { minor: 3_900_000n, currency: 'AMD' },
      uncounted: 0,
    })
    expect(view.accounts.find(({ id }) => id === dollars.id)).toMatchObject({
      inSpend: { minor: 3_900_000n, currency: 'AMD' },
      rate: { source: 'official' },
    })
  })
})

describe('после ревью (MOL-115, Р-3, Д1–Д6)', () => {
  it('удаление таймером отвязывает все пять видов операций и не падает на ключе (Р-3)', async () => {
    const me = await owner()
    const cash = await addAccount(me, { name: 'Наличные' })
    const card = await addAccount(me, { name: 'Карта ₽', currency: 'RUB', start: rub('0') })
    await call(me, 'DELETE', `/money/accounts/${cash.id}`)
    await call(me, 'DELETE', `/money/accounts/${card.id}`)
    const spent = await spend(me, { accountId: cash.id })
    const income = { id: randomUUID(), amount: amd('100'), receivedOn: today, source: 'gift' }
    await call(me, 'POST', '/incomes', { ...income, accountId: cash.id })
    const exchange = {
      id: randomUUID(),
      given: rub('1000'),
      received: amd('4700'),
      exchangedOn: today,
      givenAccountId: card.id,
      receivedAccountId: cash.id,
    }
    expect((await call(me, 'POST', '/exchanges', exchange)).statusCode).toBe(201)
    const trip = await insertTrip(db, { actorId: me.id, placeId: await insertPlace(db) })
    await call(me, 'PUT', `/trips/${trip}/payment`, { accountId: cash.id })
    await db
      .update(moneyAccounts)
      .set({ deletedAt: sql`clock_timestamp() - interval '11 minutes'` })
      .where(eq(moneyAccounts.actorId, me.id))
    await accountsRepository.purgeStale()
    expect(await db.select().from(moneyAccounts).where(eq(moneyAccounts.actorId, me.id))).toEqual(
      [],
    )
    const rows = await db.execute<{ named: number } & Record<string, unknown>>(sql`
      select (select count(*) from spendings where actor_id = ${me.id} and account_id is not null)
           + (select count(*) from incomes where actor_id = ${me.id} and account_id is not null)
           + (select count(*) from exchanges where actor_id = ${me.id}
                and (given_account_id is not null or received_account_id is not null))
           + (select count(*) from trips where actor_id = ${me.id} and account_id is not null)
           as named`)
    expect(Number(rows[0]?.named)).toBe(0)
    expect(spent.response.statusCode).toBe(201)
  })

  it('повтор «Добавить счёт» после окончательного удаления с операцией — новый счёт, не 404 (Д5)', async () => {
    const me = await owner()
    const { id, body } = await addAccount(me)
    await call(me, 'DELETE', `/money/accounts/${id}`)
    const { body: spending } = await spend(me, { accountId: id })
    await db
      .update(moneyAccounts)
      .set({ deletedAt: sql`clock_timestamp() - interval '11 minutes'` })
      .where(eq(moneyAccounts.id, id))
    const again = await call(me, 'POST', '/money/accounts', body)
    expect(again.statusCode).toBe(201)
    const [row] = await db.select().from(spendings).where(eq(spendings.id, spending.id))
    expect(row?.accountId).toBeNull()
  })

  it('поход, завершённый офлайн до сверки и дошедший после неё, — причина следующей (Д1)', async () => {
    const me = await owner()
    const { id } = await addAccount(me, { startOn: daysAgo(5) })
    await call(me, 'POST', `/money/accounts/${id}/checks`, {
      id: randomUUID(),
      fact: amd('100000'),
    })
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const trip = await insertTrip(db, {
      actorId: me.id,
      placeId: await insertPlace(db),
      startedAt: yesterday,
      finishedOnDeviceAt: yesterday,
      finishedAt: new Date(),
    })
    await db.insert(expenses).values({
      id: randomUUID(),
      tripId: trip,
      itemId: await insertItem(db),
      amountMinor: 500000n,
      amountCurrency: 'AMD',
      createdAt: yesterday,
    })
    const check = accountCheckCodec.parse(
      (
        await call(me, 'POST', `/money/accounts/${id}/checks`, {
          id: randomUUID(),
          fact: amd('95000'),
        })
      ).json(),
    )
    expect(check.reasons.map(({ kind, operation }) => [kind, operation.id])).toEqual([
      ['unassigned', trip],
    ])
  })

  it('«списано» у похода в валюте счёта с покупкой в долларах принимается (Д2)', async () => {
    const me = await owner()
    const { id } = await addAccount(me)
    const trip = await insertTrip(db, { actorId: me.id, placeId: await insertPlace(db) })
    await db.insert(expenses).values({
      id: randomUUID(),
      tripId: trip,
      itemId: await insertItem(db),
      amountMinor: 1000n,
      amountCurrency: 'USD',
    })
    const paid = await call(me, 'PUT', `/trips/${trip}/payment`, {
      accountId: id,
      debited: amd('4000'),
    })
    expect(paid.statusCode, paid.body).toBe(200)
    expect((await balanceOf(me, id)).balance.minor).toBe(9_600_000n)
  })

  it('поход, начатый до вечера старта и не завершённый, — история, а не второй вычет (Д4)', async () => {
    const me = await owner()
    const { id } = await addAccount(me, { startOn: daysAgo(1) })
    const trip = await insertTrip(db, {
      actorId: me.id,
      placeId: await insertPlace(db),
      startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    })
    await db.insert(expenses).values({
      id: randomUUID(),
      tripId: trip,
      itemId: await insertItem(db),
      amountMinor: 500000n,
      amountCurrency: 'AMD',
    })
    await call(me, 'PUT', `/trips/${trip}/payment`, { accountId: id })
    expect((await balanceOf(me, id)).balance.minor).toBe(10_000_000n)
  })

  it('поход, начатый офлайн вечером и дошедший после полуночи, — день телефона (Р2-3, В-6)', async () => {
    const me = await owner()
    const { id } = await addAccount(me, { startOn: daysAgo(1) })
    // At the shelf yesterday at ten in the evening — before the account's start — and delivered
    // just after midnight in Yerevan.
    const midnight = yerevanMidnight(today).getTime()
    const trip = await insertTrip(db, {
      actorId: me.id,
      placeId: await insertPlace(db),
      startedAt: new Date(midnight + 60 * 1000),
      finishedAt: new Date(midnight + 2 * 60 * 1000),
      finishedOnDeviceAt: new Date(midnight - 2 * 60 * 60 * 1000),
    })
    await db.insert(expenses).values({
      id: randomUUID(),
      tripId: trip,
      itemId: await insertItem(db),
      amountMinor: 500000n,
      amountCurrency: 'AMD',
    })
    await call(me, 'PUT', `/trips/${trip}/payment`, { accountId: id })
    const journal = accountJournalCodec.parse(
      (await call(me, 'GET', `/money/accounts/${id}/journal`)).json(),
    )
    expect(journal.rows[0]).toMatchObject({ day: daysAgo(1), inBalance: false })
    expect((await balanceOf(me, id)).balance.minor).toBe(10_000_000n)
  })

  it('поход без счёта и без единой цены — в «не попали» (Д6)', async () => {
    const me = await owner()
    await addAccount(me)
    const trip = await insertTrip(db, { actorId: me.id, placeId: await insertPlace(db) })
    await db
      .insert(expenses)
      .values({ id: randomUUID(), tripId: trip, itemId: await insertItem(db) })
    const rows = unassignedOperationsCodec.parse(
      (await call(me, 'GET', '/money/accounts/unassigned')).json(),
    ).rows
    expect(rows.map(({ id }) => id)).toEqual([trip])
  })
})

describe('третий проход (Ж1, Ж2)', () => {
  it('часы телефона, отставшие на дни, не уводят сегодняшний поход за черту старта (Ж1)', async () => {
    const me = await owner()
    const { id } = await addAccount(me, { startOn: daysAgo(1) })
    const trip = await insertTrip(db, { actorId: me.id, placeId: await insertPlace(db) })
    await db.insert(expenses).values({
      id: randomUUID(),
      tripId: trip,
      itemId: await insertItem(db),
      amountMinor: 500000n,
      amountCurrency: 'AMD',
    })
    await call(me, 'PUT', `/trips/${trip}/payment`, { accountId: id })
    const finished = await call(me, 'POST', `/trips/${trip}/finish`, {
      finishedOnDeviceAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    })
    expect(finished.statusCode).toBe(204)
    expect((await balanceOf(me, id)).balance.minor).toBe(9_500_000n)
  })

  it('смена денег похода снимает «списано», и новая покупка его не будит (Ж2, Р-32)', async () => {
    const me = await owner()
    const { id } = await addAccount(me)
    const trip = await insertTrip(db, { actorId: me.id, placeId: await insertPlace(db) })
    const bread = randomUUID()
    const added = await call(me, 'POST', `/trips/${trip}/expenses`, {
      id: bread,
      itemId: await insertItem(db),
      amount: { amount: '10', currency: 'USD' },
    })
    expect(added.statusCode, added.body).toBe(201)
    const paid = await call(me, 'PUT', `/trips/${trip}/payment`, {
      accountId: id,
      debited: amd('3950'),
    })
    expect(tripViewCodec.parse(paid.json()).debited).toEqual({ minor: 395_000n, currency: 'AMD' })

    // The price corrected to drams: the figure was for the trip as it was, and it goes.
    const fixed = await call(me, 'PATCH', `/trips/${trip}/expenses/${bread}`, {
      amount: amd('4000'),
    })
    expect(fixed.statusCode, fixed.body).toBe(200)
    expect(tripViewCodec.parse(fixed.json())).toMatchObject({ accountId: id, debited: null })

    // A dollar purchase later wakes nothing: the trip is «без списано» until it is entered anew.
    await rates.upsert([official('USD', '390', today)])
    await db.execute(sql`update actors set rate_preference = 'official' where id = ${me.id}`)
    await call(me, 'POST', `/trips/${trip}/expenses`, {
      id: randomUUID(),
      itemId: await insertItem(db),
      amount: { amount: '5', currency: 'USD' },
    })
    expect(await balanceOf(me, id)).toMatchObject({
      balance: { minor: 9_405_000n, currency: 'AMD' },
      approximate: true,
    })
  })
})
