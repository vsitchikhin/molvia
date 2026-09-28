import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { moneyMonthCodec, parseRate, spendingCategoriesResponseCodec } from '@molvia/model'
import type { CachedRate, MoneyMonthView } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'

const { db, close } = connectDrizzle()
const rates = createRateRepository(db)
let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db })
  await app.ready()
})
beforeEach(async () => {
  await clearAll(db)
  // A closed month far behind: its rest is counted on its last day, whatever today is.
  await rates.upsert([official('RUB', '4.1', '2025-03-31'), official('USD', '410', '2025-03-31')])
})
afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

function official(currency: 'RUB' | 'USD' | 'EUR', value: string, date: string): CachedRate {
  return { provider: 'cba', currency, date, scaled: parseRate(value), jump: false }
}

interface Owner {
  readonly cookie: string
}

async function owner(): Promise<Owner> {
  const id = await insertActor(db)
  return { cookie: await signIn(db, id) }
}

async function call(
  me: Owner,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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

async function month(me: Owner, value: string): Promise<MoneyMonthView> {
  const response = await call(me, 'GET', `/money/months/${value}`)
  expect(response.statusCode, response.body).toBe(200)
  return moneyMonthCodec.parse(response.json())
}

async function account(
  me: Owner,
  currency: string,
  start: string,
  patch: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID()
  const response = await call(me, 'POST', '/money/accounts', {
    id,
    name: `Счёт ${currency} ${id.slice(0, 4)}`,
    currency,
    savings: false,
    start: { amount: start, currency },
    startOn: '2025-03-10',
    ...patch,
  })
  expect(response.statusCode, response.body).toBe(201)
  return id
}

async function spend(
  me: Owner,
  amount: string,
  spentOn: string,
  accountId: string | null,
  currency = 'AMD',
): Promise<{ id: string; revision: number; body: Record<string, unknown> }> {
  const categories = spendingCategoriesResponseCodec.parse(
    (await call(me, 'GET', '/spending-categories')).json(),
  )
  const body = {
    id: randomUUID(),
    spentOn,
    amount: { amount, currency },
    categoryId: categories.categories[0]?.id,
    note: 'аренда',
    accountId,
  }
  const response = await call(me, 'POST', '/spendings', body)
  expect(response.statusCode, response.body).toBe(201)
  return { id: body.id, revision: 1, body }
}

const rub = (major: number) => ({ minor: BigInt(major) * 100n, currency: 'RUB' })

describe('«Остаток» — деньги на счетах на конец месяца (MOL-134)', () => {
  it('счета на вечер последнего дня в валюте дохода: всего и без сбережений (В-1)', async () => {
    const me = await owner()
    const cash = await account(me, 'AMD', '41000')
    await account(me, 'RUB', '1000')
    await account(me, 'USD', '100', { savings: true })
    await spend(me, '4100', '2025-03-20', cash)
    // After the month: in April's rest, not in March's.
    await spend(me, '8200', '2025-04-02', cash)

    const march = await month(me, '2025-03')
    // 36 900 ֏ at 4,1 ֏/₽ is 9 000 ₽; 100 $ at 410 ֏ is 10 000 ₽.
    expect(march.rest).toEqual({
      total: rub(20000),
      spendable: rub(10000),
      uncounted: [],
      operationsUncounted: 0,
    })
    expect(march.accountsFrom).toBe('2025-03-10')
  })

  it('месяц до первого счёта — без остатка, со днём старта; без счетов — ни того ни другого (В-4)', async () => {
    const me = await owner()
    expect(await month(me, '2025-02')).toMatchObject({ rest: null, accountsFrom: null })
    await account(me, 'RUB', '1000')
    expect(await month(me, '2025-02')).toMatchObject({ rest: null, accountsFrom: '2025-03-10' })
  })

  it('счёт, начатый в последний день, входит; на день позже — нет', async () => {
    const me = await owner()
    await account(me, 'RUB', '1000', { startOn: '2025-03-31' })
    await account(me, 'RUB', '500', { startOn: '2025-04-01' })
    expect((await month(me, '2025-03')).rest?.total).toEqual(rub(1000))
  })

  it('убранный счёт не входит ни в один месяц, и в прошлый тоже (Р-2)', async () => {
    const me = await owner()
    await account(me, 'RUB', '1000')
    const card = await account(me, 'AMD', '41000')
    await spend(me, '4100', '2025-03-20', card)
    expect((await call(me, 'DELETE', `/money/accounts/${card}`)).statusCode).toBe(200)
    expect((await month(me, '2025-03')).rest?.total).toEqual(rub(1000))
  })

  it('правка траты марта двигает остаток марта: он не замораживается (Р-3)', async () => {
    const me = await owner()
    const cash = await account(me, 'AMD', '41000')
    const rent = await spend(me, '4100', '2025-03-20', cash)
    expect((await month(me, '2025-03')).rest?.total).toEqual(rub(9000))
    const amended = await call(me, 'PUT', `/spendings/${rent.id}`, {
      ...rent.body,
      id: undefined,
      revision: rent.revision,
      amount: { amount: '8200', currency: 'AMD' },
    })
    expect(amended.statusCode, amended.body).toBe(200)
    expect((await month(me, '2025-03')).rest?.total).toEqual(rub(8000))
  })

  it('трата без счёта в остаток не входит (Р-4)', async () => {
    const me = await owner()
    await account(me, 'AMD', '41000')
    await spend(me, '4100', '2025-03-20', null)
    expect((await month(me, '2025-03')).rest?.total).toEqual(rub(10000))
  })

  it('счёт, который нечем пересчитать, — «не посчитано» в своей валюте, не ноль (п. 5)', async () => {
    const me = await owner()
    await account(me, 'RUB', '1000')
    await account(me, 'EUR', '8470', { savings: true })
    expect((await month(me, '2025-03')).rest).toEqual({
      total: rub(1000),
      spendable: rub(1000),
      uncounted: [{ balance: { minor: 847000n, currency: 'EUR' }, savings: true }],
      operationsUncounted: 0,
    })
  })

  it('операция, которую нечем посчитать, названа числом — остаток не выглядит целым (Б)', async () => {
    const me = await owner()
    const card = await account(me, 'AMD', '41000')
    await spend(me, '10', '2025-03-20', card, 'EUR')
    const march = await month(me, '2025-03')
    expect(march.rest).toMatchObject({ total: rub(10000), operationsUncounted: 1 })
    // The next month carries the same account, and says the same.
    expect((await month(me, '2025-04')).rest).toMatchObject({ operationsUncounted: 1 })
  })

  it('закрытый месяц считает счета в валюте трат по замороженному курсу, а не по новому (№6)', async () => {
    const me = await owner()
    const cash = await account(me, 'AMD', '41000')
    await spend(me, '4100', '2025-03-20', cash)
    expect((await month(me, '2025-03')).rest?.total).toEqual(rub(9000))
    // The cache learns another rate for the same day: the frozen month keeps its own.
    await rates.upsert([official('RUB', '5', '2025-03-31')])
    const again = await month(me, '2025-03')
    expect(again.rateKind).toBe('frozen')
    expect(again.rest?.total).toEqual(rub(9000))
  })

  it('следующая страница журнала остатка не считает: телефон берёт его с первой (№3)', async () => {
    const me = await owner()
    await account(me, 'RUB', '1000')
    const response = await call(
      me,
      'GET',
      `/money/months/2025-03?cursor=2025-03-31~9999999999999~${randomUUID()}`,
    )
    expect(response.statusCode, response.body).toBe(200)
    expect(moneyMonthCodec.parse(response.json()).rest).toBeNull()
    expect((await month(me, '2025-03')).rest?.total).toEqual(rub(1000))
  })

  it('все счета убраны — «Завести счёт» не предлагается: accountsRemoved (№4)', async () => {
    const me = await owner()
    const card = await account(me, 'AMD', '41000')
    await spend(me, '4100', '2025-03-20', card)
    expect((await call(me, 'DELETE', `/money/accounts/${card}`)).statusCode).toBe(200)
    expect(await month(me, '2025-03')).toMatchObject({
      rest: null,
      accountsFrom: null,
      accountsRemoved: true,
    })
  })

  it('чужие счета не видны', async () => {
    const me = await owner()
    const stranger = await owner()
    await account(stranger, 'RUB', '1000')
    expect(await month(me, '2025-03')).toMatchObject({
      rest: null,
      accountsFrom: null,
      accountsRemoved: false,
    })
  })
})
