import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ERROR,
  ISSUE,
  accountCheckCodec,
  accountJournalCodec,
  exchangesResponseCodec,
  latestDay,
  moneyAccountsCodec,
  moneyMonthCodec,
  parseRate,
  spendingCategoriesResponseCodec,
  transferResponseCodec,
  transferViewCodec,
  yerevanDate,
} from '@molvia/model'
import type { CachedRate, MoneyAccountsResponse } from '@molvia/model'
import { drizzle } from 'drizzle-orm/postgres-js'
import type { FastifyInstance } from 'fastify'
import postgres from 'postgres'
import { createErasureRepository } from '@/db/erasure-repository'
import { createExportRepository } from '@/db/export-repository'
import { createRateRepository } from '@/db/rates-repository'
import { createSpendingRepository } from '@/db/spendings-repository'
import { accountTransferRevisions, accountTransfers, actors, spendings } from '@/db/schema'
import { createTransferRepository } from '@/db/transfers-repository'
import * as schema from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle, testDatabaseUrl } from './db'
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
  await rates.upsert([official('USD', '390', today), official('RUB', '4.15', today)])
})
afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

const today = yerevanDate(new Date())
const month = today.slice(0, 7)
const daysAgo = (days: number): string =>
  yerevanDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000))
function official(currency: 'RUB' | 'USD', value: string, date: string): CachedRate {
  return { provider: 'cba', currency, date, scaled: parseRate(value), jump: false }
}
const usd = (amount: string) => ({ amount, currency: 'USD' })
const amd = (amount: string) => ({ amount, currency: 'AMD' })

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

async function addAccount(
  me: Owner,
  name: string,
  start: { amount: string; currency: string },
  savings = false,
) {
  const id = randomUUID()
  const response = await call(me, 'POST', '/money/accounts', {
    id,
    name,
    currency: start.currency,
    savings,
    start,
    startOn: daysAgo(5),
  })
  expect(response.statusCode, response.body).toBe(201)
  return id
}

async function overview(me: Owner): Promise<MoneyAccountsResponse> {
  const response = await call(me, 'GET', '/money/accounts')
  expect(response.statusCode).toBe(200)
  return moneyAccountsCodec.parse(response.json())
}

async function balanceOf(me: Owner, id: string): Promise<string> {
  const account = (await overview(me)).accounts.find((candidate) => candidate.id === id)
  if (!account) throw new Error(`no account ${id}`)
  return `${String(account.balance.minor)} ${account.balance.currency}`
}

async function monthOf(me: Owner) {
  const response = await call(me, 'GET', `/money/months/${month}`)
  expect(response.statusCode, response.body).toBe(200)
  return moneyMonthCodec.parse(response.json())
}

/** The owner of «Папина карта» and «Доллары», both in dollars — the owner's case of 08.10.2026. */
async function twoDollarAccounts() {
  const me = await owner()
  const card = await addAccount(me, 'Папина карта', usd('3140'))
  const dollars = await addAccount(me, 'Доллары', usd('4400'))
  return { me, card, dollars }
}

/** A body without the fields named: an amendment is the body whole, less its name. */
function without(body: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !keys.includes(key)))
}

function transferBody(from: string, to: string, patch: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    fromAccountId: from,
    toAccountId: to,
    amount: usd('2000'),
    fee: usd('20'),
    transferredOn: today,
    ...patch,
  }
}

async function transfer(me: Owner, body: Record<string, unknown>) {
  const response = await call(me, 'POST', '/transfers', body)
  expect(response.statusCode, response.body).toBe(201)
  expect(response.headers['cache-control']).toBe('no-store')
  return transferResponseCodec.parse(response.json())
}

describe('«Перевод» между своими счетами (MOL-253)', () => {
  it('двигает только остатки двух счетов: −2 020 у источника, +2 000 у получателя', async () => {
    const { me, card, dollars } = await twoDollarAccounts()
    const { transfer: written, accounts } = await transfer(me, transferBody(card, dollars))
    expect(written).toMatchObject({
      fromAccountId: card,
      toAccountId: dollars,
      amount: { minor: 200000n, currency: 'USD' },
      fee: { minor: 2000n, currency: 'USD' },
      revision: 1,
      amendedAt: null,
    })
    // The answer is «Счета» whole, already counted.
    expect(accounts.accounts.find((one) => one.id === card)?.balance.minor).toBe(112000n)
    expect(await balanceOf(me, card)).toBe('112000 USD')
    expect(await balanceOf(me, dollars)).toBe('640000 USD')
  })

  it('в месяце «Деньги» — только комиссия: «Потрачено» +20 $ по курсу дня, «Пришло» не тронуто', async () => {
    const { me, card, dollars } = await twoDollarAccounts()
    const before = await monthOf(me)
    await transfer(me, transferBody(card, dollars))
    const after = await monthOf(me)
    // 20 $ at 390 ֏ of the day.
    expect(after.spent.minor - before.spent.minor).toBe(780000n)
    expect(after.income).toEqual(before.income)
    expect(after.count).toBe((before.count ?? 0) + 1)
  })

  it('без комиссии месяц не меняется вовсе', async () => {
    const { me, card, dollars } = await twoDollarAccounts()
    const before = await monthOf(me)
    const bare = without(transferBody(card, dollars), 'fee')
    await transfer(me, bare)
    const after = await monthOf(me)
    expect(after.spent).toEqual(before.spent)
    expect(after.count).toBe(before.count)
    expect(await balanceOf(me, card)).toBe('114000 USD')
  })

  it('кошелёк и «мой курс» не трогает: валюта не менялась', async () => {
    const { me, card, dollars } = await twoDollarAccounts()
    const exchanged = await call(me, 'POST', '/exchanges', {
      id: randomUUID(),
      given: { amount: '100000', currency: 'RUB' },
      received: usd('1200'),
      exchangedOn: today,
    })
    expect(exchanged.statusCode, exchanged.body).toBe(201)
    const read = async () => {
      const response = await call(me, 'GET', '/exchanges')
      const { wallet, costs } = exchangesResponseCodec.parse(response.json())
      return { wallet, costs }
    }
    const before = await read()
    await transfer(me, transferBody(card, dollars))
    expect(await read()).toEqual(before)
  })

  it('сбережения: «Остаток» всего тот же, «без сбережений» растёт на перевод из копилки (MOL-134)', async () => {
    const me = await owner()
    const piggy = await addAccount(me, 'Копилка', amd('100000'), true)
    const cash = await addAccount(me, 'Наличные', amd('5000'))
    const before = (await monthOf(me)).rest
    await transfer(me, {
      id: randomUUID(),
      fromAccountId: piggy,
      toAccountId: cash,
      amount: amd('41500'),
      transferredOn: today,
    })
    const after = (await monthOf(me)).rest
    expect(after?.total).toEqual(before?.total)
    // 41 500 ֏ at 4,15 ֏ the rouble is 10 000 ₽ more to spend.
    expect((after?.spendable.minor ?? 0n) - (before?.spendable.minor ?? 0n)).toBe(1000000n)
  })

  it('журнал источника — перевод и комиссия отдельными строками, получателя — одна', async () => {
    const { me, card, dollars } = await twoDollarAccounts()
    const { transfer: written } = await transfer(me, transferBody(card, dollars))
    const journal = async (id: string) => {
      const response = await call(me, 'GET', `/money/accounts/${id}/journal`)
      expect(response.statusCode, response.body).toBe(200)
      return accountJournalCodec.parse(response.json()).rows
    }
    const source = await journal(card)
    expect(
      source.map(({ kind, side, moved, transferId }) => ({ kind, side, moved, transferId })),
    ).toEqual([
      {
        kind: 'transfer',
        side: 'given',
        moved: { minor: -200000n, currency: 'USD' },
        transferId: null,
      },
      {
        kind: 'spending',
        side: null,
        moved: { minor: -2000n, currency: 'USD' },
        transferId: written.id,
      },
    ])
    // The fee says where the transfer went.
    expect(source[1]?.counterpart?.accountId).toBe(dollars)
    expect(source[0]?.counterpart).toEqual({
      accountId: dollars,
      amount: { minor: 200000n, currency: 'USD' },
    })
    const target = await journal(dollars)
    expect(target.map(({ kind, side, moved }) => ({ kind, side, moved }))).toEqual([
      { kind: 'transfer', side: 'received', moved: { minor: 200000n, currency: 'USD' } },
    ])
    expect(target[0]?.counterpart?.accountId).toBe(card)
  })

  it('сверка видит перевод в балансе и не называет его причиной', async () => {
    const { me, card, dollars } = await twoDollarAccounts()
    await transfer(me, transferBody(card, dollars))
    for (const [id, fact] of [
      [card, '1120'],
      [dollars, '6400'],
    ] as const) {
      const response = await call(me, 'POST', `/money/accounts/${id}/checks`, {
        id: randomUUID(),
        fact: usd(fact),
      })
      expect(response.statusCode, response.body).toBe(200)
      const check = accountCheckCodec.parse(response.json())
      expect(check.difference.minor).toBe(0n)
      expect(check.reasons).toEqual([])
    }
    const unassigned = await call(me, 'GET', '/money/accounts/unassigned')
    expect(unassigned.json()).toEqual({ rows: [] })
  })

  describe('повтор и отказы', () => {
    it('тот же перевод ещё раз — 200 и один перевод; другое под тем же именем — 409', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const body = transferBody(card, dollars)
      await transfer(me, body)
      const again = await call(me, 'POST', '/transfers', body)
      expect(again.statusCode).toBe(200)
      expect(await balanceOf(me, card)).toBe('112000 USD')
      const other = await call(me, 'POST', '/transfers', { ...body, amount: usd('2001') })
      expect(other.statusCode).toBe(409)
      expect(other.json()).toEqual({ code: ERROR.CONFLICT })
      const noFee = await call(me, 'POST', '/transfers', { ...body, fee: undefined })
      expect(noFee.statusCode).toBe(409)
    })

    it('счёт другой валюты, чужой, помеченный к удалению — 409 error.transfer_account', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const drams = await addAccount(me, 'Наличные ֏', amd('1000'))
      const stranger = await owner()
      const theirs = await addAccount(stranger, 'Чужие доллары', usd('10'))
      const empty = await addAccount(me, 'Пустой', usd('0'))
      const marked = await call(me, 'DELETE', `/money/accounts/${empty}`)
      expect(marked.statusCode).toBe(200)
      for (const to of [drams, theirs, empty, randomUUID()]) {
        const response = await call(me, 'POST', '/transfers', transferBody(card, to))
        expect(response.statusCode, to).toBe(409)
        expect(response.json()).toEqual({ code: ERROR.TRANSFER_ACCOUNT })
      }
      expect(await balanceOf(me, card)).toBe('314000 USD')
      expect(await balanceOf(me, dollars)).toBe('440000 USD')
    })

    it('один и тот же счёт — отказ схемы; день, которого ещё нет нигде, — error.transfer_in_future', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const same = await call(me, 'POST', '/transfers', transferBody(card, card))
      expect(same.statusCode).toBe(400)
      expect(same.json()).toMatchObject({ code: ISSUE.TRANSFER_SAME_ACCOUNT })
      const ahead = new Date(`${latestDay(new Date())}T12:00:00Z`)
      ahead.setUTCDate(ahead.getUTCDate() + 1)
      const future = await call(
        me,
        'POST',
        '/transfers',
        transferBody(card, dollars, { transferredOn: ahead.toISOString().slice(0, 10) }),
      )
      expect(future.json()).toEqual({ code: ERROR.TRANSFER_IN_FUTURE })
    })

    it('убранный из выбора счёт принимает перевод: правке старого он нужен', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      await transfer(me, transferBody(card, dollars))
      // With operations, removal is «убрать из выбора», never a deletion.
      const removed = await call(me, 'DELETE', `/money/accounts/${dollars}`)
      expect(removed.statusCode).toBe(200)
      const view = moneyAccountsCodec
        .parse(removed.json())
        .accounts.find((one) => one.id === dollars)
      expect(view?.archivedAt).not.toBeNull()
      await transfer(me, transferBody(card, dollars, { amount: usd('100') }))
    })

    it('валюту счёта с переводом не сменить', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      await transfer(me, transferBody(card, dollars))
      const response = await call(me, 'PUT', `/money/accounts/${dollars}`, {
        revision: 1,
        name: 'Доллары',
        currency: 'AMD',
        savings: false,
        start: amd('0'),
        startOn: daysAgo(5),
      })
      expect(response.json()).toEqual({ code: ERROR.MONEY_ACCOUNT_CURRENCY_LOCKED })
    })
  })

  describe('правка', () => {
    it('сумма и комиссия меняются вместе, прежняя версия хранится; поверх чужой правки — 409', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const { transfer: written } = await transfer(me, transferBody(card, dollars))
      const fields = without(transferBody(card, dollars), 'id')
      const amended = await call(me, 'PUT', `/transfers/${written.id}`, {
        ...fields,
        revision: 1,
        amount: usd('1500'),
        fee: usd('15'),
        note: 'на вклад',
      })
      expect(amended.statusCode, amended.body).toBe(200)
      const { transfer: now } = transferResponseCodec.parse(amended.json())
      expect(now).toMatchObject({ revision: 2, note: 'на вклад', fee: { minor: 1500n } })
      expect(now.amendedAt).not.toBeNull()
      expect(await balanceOf(me, card)).toBe('162500 USD')
      expect(await balanceOf(me, dollars)).toBe('590000 USD')
      const versions = await db
        .select()
        .from(accountTransferRevisions)
        .where(eq(accountTransferRevisions.transferId, written.id))
      expect(versions).toMatchObject([{ revision: 1, amountMinor: 200000n, feeMinor: 2000n }])
      const stale = await call(me, 'PUT', `/transfers/${written.id}`, {
        ...fields,
        revision: 1,
        amount: usd('10'),
      })
      expect(stale.statusCode).toBe(409)
    })

    it('комиссия снята правкой — трата уходит; добавлена — появляется', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const bare = without(transferBody(card, dollars), 'fee')
      const { transfer: written } = await transfer(me, bare)
      const fees = () => db.select().from(spendings).where(eq(spendings.transferId, written.id))
      expect(await fees()).toEqual([])
      const fields = without(bare, 'id')
      await call(me, 'PUT', `/transfers/${written.id}`, { ...fields, revision: 1, fee: usd('5') })
      expect(await fees()).toMatchObject([{ amountMinor: 500n, accountId: card }])
      await call(me, 'PUT', `/transfers/${written.id}`, { ...fields, revision: 2 })
      expect(await fees()).toEqual([])
      expect(await balanceOf(me, card)).toBe('114000 USD')
    })

    it('источник сменён — комиссия уходит с новым источником', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const cash = await addAccount(me, 'Наличные $', usd('500'))
      const { transfer: written } = await transfer(me, transferBody(card, dollars))
      const fields = without(transferBody(cash, dollars, { amount: usd('100') }), 'id')
      const amended = await call(me, 'PUT', `/transfers/${written.id}`, { ...fields, revision: 1 })
      expect(amended.statusCode, amended.body).toBe(200)
      expect(await balanceOf(me, card)).toBe('314000 USD')
      expect(await balanceOf(me, cash)).toBe('38000 USD')
      expect(await balanceOf(me, dollars)).toBe('450000 USD')
    })

    it('открывается по своему адресу; чужой, несуществующий и кривой — один ответ 404', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const { transfer: written } = await transfer(me, transferBody(card, dollars))
      const own = await call(me, 'GET', `/transfers/${written.id.toUpperCase()}`)
      expect(own.statusCode).toBe(200)
      expect(transferViewCodec.parse(own.json()).id).toBe(written.id)
      const stranger = await owner()
      for (const url of [
        `/transfers/${written.id}`,
        `/transfers/${randomUUID()}`,
        '/transfers/x',
      ]) {
        const response = await call(stranger, 'GET', url)
        expect(response.statusCode, url).toBe(404)
      }
    })
  })

  describe('курс комиссии и гонка правки с удалением (адверсариальный раунд 1)', () => {
    it('А1: правка одной заметки держит курс комиссии — «Потрачено» прошлого дня не сдвигается', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const day = daysAgo(3)
      await rates.upsert([official('USD', '390', day)])
      const body = transferBody(card, dollars, { transferredOn: day })
      await transfer(me, body)
      const { id } = body
      const feeRate = async () =>
        (await db.select().from(spendings).where(eq(spendings.transferId, id)))[0]?.rateScaled
      expect(await feeRate()).toBe(parseRate('390'))
      // The bank corrected the day since.
      await rates.upsert([official('USD', '395', day)])
      const fields = without(body, 'id')
      const noted = await call(me, 'PUT', `/transfers/${id}`, {
        ...fields,
        revision: 1,
        note: 'папе',
      })
      expect(noted.statusCode, noted.body).toBe(200)
      expect(await feeRate()).toBe(parseRate('390'))
      // Another day is another fact: the rate of that day is taken.
      await rates.upsert([official('USD', '400', daysAgo(2))])
      const moved = await call(me, 'PUT', `/transfers/${id}`, {
        ...fields,
        revision: 2,
        transferredOn: daysAgo(2),
      })
      expect(moved.statusCode, moved.body).toBe(200)
      expect(await feeRate()).toBe(parseRate('400'))
    })

    it('А2: удаление ждёт правку, добавившую комиссию, и уносит комиссию с переводом', async () => {
      // The app on a pool of its own, as in production: one connection would line the two phones up.
      const pool = postgres(testDatabaseUrl(), { max: 4, onnotice: () => undefined })
      const racing = buildServer({ db: drizzle(pool, { schema }) })
      await racing.ready()
      const { me, card, dollars } = await twoDollarAccounts()
      const ask = (method: 'PUT' | 'DELETE', url: string, body?: unknown) =>
        racing.inject({
          method,
          url,
          headers: { cookie: me.cookie },
          ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
        })
      const body = without(transferBody(card, dollars), 'fee')
      await transfer(me, body)
      const id = String(body.id)
      // The window between the amendment's read and its write, widened.
      await db.execute(
        sql.raw(`create or replace function mol253_slow() returns trigger language plpgsql as $$
          begin perform pg_sleep(1); return new; end $$`),
      )
      await db.execute(
        sql.raw(`create trigger mol253_slow before insert on account_transfer_revisions
          for each row execute function mol253_slow()`),
      )
      try {
        const amending = ask('PUT', `/transfers/${id}`, {
          ...without(body, 'id'),
          revision: 1,
          fee: usd('20'),
        })
        await new Promise((resolve) => setTimeout(resolve, 300))
        const removed = await ask('DELETE', `/transfers/${id}`)
        expect(removed.statusCode).toBe(200)
        expect((await amending).statusCode).toBe(200)
      } finally {
        await db.execute(
          sql.raw('drop trigger if exists mol253_slow on account_transfer_revisions'),
        )
        await db.execute(sql.raw('drop function if exists mol253_slow()'))
        await racing.close()
        await pool.end()
      }
      const [fee] = await db.select().from(spendings).where(eq(spendings.transferId, id))
      expect(fee?.deletedAt).not.toBeNull()
      expect(await balanceOf(me, card)).toBe('314000 USD')
    })
  })

  describe('удаление и «Вернуть»', () => {
    it('уходит вместе с комиссией и возвращается вместе с ней', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const before = await monthOf(me)
      const { transfer: written } = await transfer(me, transferBody(card, dollars))
      const removed = await call(me, 'DELETE', `/transfers/${written.id}`)
      expect(removed.statusCode).toBe(200)
      expect(await balanceOf(me, card)).toBe('314000 USD')
      expect(await balanceOf(me, dollars)).toBe('440000 USD')
      expect((await monthOf(me)).spent).toEqual(before.spent)
      const restored = await call(me, 'POST', `/transfers/${written.id}/restore`)
      expect(restored.statusCode, restored.body).toBe(200)
      expect(await balanceOf(me, card)).toBe('112000 USD')
      expect((await monthOf(me)).spent.minor - before.spent.minor).toBe(780000n)
    })

    it('после десяти минут — окончательно, с комиссией и версиями; трата сама по себе не стирается', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const { transfer: written } = await transfer(me, transferBody(card, dollars))
      await call(me, 'DELETE', `/transfers/${written.id}`)
      const past = sql`clock_timestamp() - interval '11 minutes'`
      await db
        .update(accountTransfers)
        .set({ deletedAt: past })
        .where(eq(accountTransfers.id, written.id))
      await db
        .update(spendings)
        .set({ deletedAt: past })
        .where(eq(spendings.transferId, written.id))
      // The spendings' timer leaves a fee to its transfer.
      await createSpendingRepository(db).purgeStale()
      expect(
        await db.select().from(spendings).where(eq(spendings.transferId, written.id)),
      ).toHaveLength(1)
      const late = await call(me, 'POST', `/transfers/${written.id}/restore`)
      expect(late.statusCode).toBe(404)
      await createTransferRepository(db).purgeStale()
      expect(
        await db.select().from(accountTransfers).where(eq(accountTransfers.id, written.id)),
      ).toEqual([])
      expect(await db.select().from(spendings).where(eq(spendings.transferId, written.id))).toEqual(
        [],
      )
    })

    it('удаление чужого ничего не трогает', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const { transfer: written } = await transfer(me, transferBody(card, dollars))
      const stranger = await owner()
      const response = await call(stranger, 'DELETE', `/transfers/${written.id}`)
      expect(response.statusCode).toBe(200)
      expect(await balanceOf(me, card)).toBe('112000 USD')
    })
  })

  describe('комиссия — трата, но только вместе с переводом', () => {
    async function feeOf(transferId: string) {
      const [fee] = await db.select().from(spendings).where(eq(spendings.transferId, transferId))
      if (!fee) throw new Error('no fee')
      return fee
    }

    it('пишется в «Прочее» счёта-источника, с курсом своего дня', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const { transfer: written } = await transfer(me, transferBody(card, dollars))
      const fee = await feeOf(written.id)
      const categories = spendingCategoriesResponseCodec.parse(
        (await call(me, 'GET', '/spending-categories')).json(),
      ).categories
      expect(categories.find((one) => one.id === fee.categoryId)?.preset).toBe('other')
      expect(fee).toMatchObject({
        accountId: card,
        spentOn: today,
        rateBase: 'USD',
        rateQuote: 'AMD',
      })
    })

    it('«Траты» не правят и не удаляют её — 409 error.spending_of_transfer, а «Вернуть» — 404', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const { transfer: written } = await transfer(me, transferBody(card, dollars))
      const fee = await feeOf(written.id)
      const amend = await call(me, 'PUT', `/spendings/${fee.id}`, {
        revision: 1,
        spentOn: today,
        amount: usd('1'),
        categoryId: fee.categoryId,
      })
      expect(amend.statusCode).toBe(409)
      expect(amend.json()).toEqual({ code: ERROR.SPENDING_OF_TRANSFER })
      const remove = await call(me, 'DELETE', `/spendings/${fee.id}`)
      expect(remove.statusCode).toBe(409)
      expect(await balanceOf(me, card)).toBe('112000 USD')
      await call(me, 'DELETE', `/transfers/${written.id}`)
      const restore = await call(me, 'POST', `/spendings/${fee.id}/restore`)
      expect(restore.statusCode).toBe(404)
    })
  })

  describe('приватность', () => {
    it('стирание уносит переводы, их версии и комиссии; копия их показывает', async () => {
      const { me, card, dollars } = await twoDollarAccounts()
      const { transfer: written } = await transfer(me, transferBody(card, dollars))
      const fields = without(transferBody(card, dollars), 'id')
      await call(me, 'PUT', `/transfers/${written.id}`, {
        ...fields,
        revision: 1,
        amount: usd('1'),
      })
      const content = await createExportRepository(db).exportOf(me.id, randomUUID())
      expect(content?.transfers).toMatchObject([
        { id: written.id, revision: 2, earlierVersions: [{ revision: 1, fee: { minor: 2000n } }] },
      ])
      expect(content?.spendings.find((one) => one.transferId === written.id)).toBeDefined()
      const [row] = await db.select().from(actors).where(eq(actors.id, me.id))
      if (!row) throw new Error('no owner')
      const report = await createErasureRepository(db).erase(row.telegramUserId, { dryRun: false })
      expect(report.erased.account_transfers).toBe(1)
      expect(report.erased.spendings).toBe(1)
      expect(await db.select().from(accountTransfers)).toEqual([])
      expect(await db.select().from(accountTransferRevisions)).toEqual([])
    })
  })
})
