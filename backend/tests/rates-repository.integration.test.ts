import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { parseRate } from '@molvia/model'
import type { AmdRate, CachedRate, RateProvider } from '@molvia/model'
import { sql } from 'drizzle-orm'
import { createRateRepository } from '@/db/rates-repository'
import { officialRates, trips } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertPlace } from './fixtures'

const { db, close } = connectDrizzle()
const rates = createRateRepository(db)

const amd = (
  currency: AmdRate['currency'],
  value: string,
  date: string,
  provider: RateProvider = 'cba',
  jump = false,
): CachedRate => ({ provider, currency, date, scaled: parseRate(value), jump })

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('кеш официальных курсов', () => {
  it('записывает ответ поставщика целиком и отдаёт его как записан', async () => {
    await rates.upsert([
      amd('RUB', '4.3123', '2026-09-18'),
      amd('USD', '363.44', '2026-09-18'),
      amd('EUR', '417.05', '2026-09-18'),
    ])

    const read = await rates.latestOnOrBefore(['RUB', 'USD', 'EUR'], '2026-09-19')

    expect([...read].sort((a, b) => a.currency.localeCompare(b.currency))).toEqual([
      amd('EUR', '417.05', '2026-09-18'),
      amd('RUB', '4.3123', '2026-09-18'),
      amd('USD', '363.44', '2026-09-18'),
    ])
  })

  it('тот же день второй раз — одна строка с новым числом: кеш зеркалит поставщика', async () => {
    await rates.upsert([amd('RUB', '4.3123', '2026-09-18')])
    await rates.upsert([amd('RUB', '4.3200', '2026-09-18')])

    const stored = await db.select().from(officialRates)

    expect(stored).toHaveLength(1)
    expect(stored[0]?.scaled).toBe(4_320_000n)
  })

  it('отдаёт последний день не позже заданного — ровно этот день берётся, следующий нет', async () => {
    await rates.upsert([
      amd('RUB', '4.2971', '2026-09-11'),
      amd('RUB', '4.3123', '2026-09-18'),
      amd('RUB', '4.3300', '2026-09-21'),
    ])

    expect(await rates.latestOnOrBefore(['RUB'], '2026-09-18')).toEqual([
      amd('RUB', '4.3123', '2026-09-18'),
    ])
    expect(await rates.latestOnOrBefore(['RUB'], '2026-09-17')).toEqual([
      amd('RUB', '4.2971', '2026-09-11'),
    ])
    expect(await rates.latestOnOrBefore(['RUB'], '2026-09-10')).toEqual([])
  })

  it('отдаёт строку каждого поставщика: какого взять, решает домен', async () => {
    await rates.upsert([
      amd('RUB', '4.3123', '2026-09-18', 'cba'),
      amd('RUB', '4.3165', '2026-09-19', 'cbr'),
      amd('RUB', '4.3148', '2026-09-19', 'erapi'),
    ])

    const read = await rates.latestOnOrBefore(['RUB'], '2026-09-20')

    expect(read.map((row) => row.provider).sort()).toEqual(['cba', 'cbr', 'erapi'])
  })

  it('не отдаёт валюту, о которой не спросили, и ничего — на пустой список', async () => {
    await rates.upsert([amd('RUB', '4.3123', '2026-09-18'), amd('USD', '363.44', '2026-09-18')])

    expect(await rates.latestOnOrBefore(['USD'], '2026-09-18')).toEqual([
      amd('USD', '363.44', '2026-09-18'),
    ])
    expect(await rates.latestOnOrBefore([], '2026-09-18')).toEqual([])
  })

  it('помнит, когда кеш писали последний раз, и молчит, пока не писали никогда', async () => {
    expect(await rates.lastFetchedAt()).toBeNull()
    const before = Date.now()
    await rates.upsert([amd('RUB', '4.3123', '2026-09-18')])
    const at = await rates.lastFetchedAt()
    expect(at?.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('пустая запись — ни строки и не ошибка', async () => {
    await rates.upsert([])
    expect(await db.select().from(officialRates)).toEqual([])
  })

  it('одна плохая строка в ответе — не записывается ни одна', async () => {
    const zero = { ...amd('USD', '363.44', '2026-09-18'), scaled: 0n }

    await expect(rates.upsert([amd('RUB', '4.3123', '2026-09-18'), zero])).rejects.toThrow()

    expect(await db.select().from(officialRates)).toEqual([])
  })
})

describe('Р-19: скачок в кеше', () => {
  it('метка пишется и читается, и повтор дня её перезаписывает', async () => {
    await rates.upsert([amd('RUB', '431.23', '2026-09-18', 'cba', true)])
    expect(await rates.latestOnOrBefore(['RUB'], '2026-09-18')).toEqual([
      amd('RUB', '431.23', '2026-09-18', 'cba', true),
      // nothing steady before it: nothing more to offer
    ])

    await rates.upsert([amd('RUB', '4.3123', '2026-09-18')])
    expect(await rates.latestOnOrBefore(['RUB'], '2026-09-18')).toEqual([
      amd('RUB', '4.3123', '2026-09-18'),
    ])
  })

  it('последняя строка со скачком — рядом отдаётся последняя без него', async () => {
    await rates.upsert([
      amd('RUB', '4.2971', '2026-09-16'),
      amd('RUB', '4.3050', '2026-09-17'),
      amd('RUB', '431.23', '2026-09-18', 'cba', true),
    ])

    expect(await rates.latestOnOrBefore(['RUB'], '2026-09-19')).toEqual([
      amd('RUB', '431.23', '2026-09-18', 'cba', true),
      amd('RUB', '4.3050', '2026-09-17'),
    ])
  })

  it('история — пять последних до даты, новые первыми, у каждой валюты своя и только у своего поставщика', async () => {
    const days = ['10', '11', '12', '13', '14', '15', '16'].map((day) => `2026-09-${day}`)
    await rates.upsert(days.map((date, index) => amd('RUB', `4.30${String(index)}`, date)))
    await rates.upsert([
      amd('USD', '363.44', '2026-09-15'),
      amd('RUB', '9.99', '2026-09-15', 'cbr'),
    ])

    const history = await rates.history('cba', ['RUB', 'USD', 'EUR'], '2026-09-16')

    expect(history.get('RUB')).toEqual([4_305_000n, 4_304_000n, 4_303_000n, 4_302_000n, 4_301_000n])
    expect(history.get('USD')).toEqual([363_440_000n])
    expect(history.get('EUR')).toBeUndefined()
  })
})

describe('ограничения official_rates', () => {
  const insert = (row: Record<string, string>) =>
    db.execute(
      sql`insert into official_rates (provider, currency, rate_date, scaled) values (${row.provider}, ${row.currency}, ${row.date}, ${row.scaled})`,
    )
  const ok = { provider: 'cba', currency: 'RUB', date: '2026-09-18', scaled: '4312300' }

  it('принимает строку, которую пишет репозиторий', async () => {
    await expect(insert(ok)).resolves.toBeDefined()
  })

  it('не принимает драм против драма, чужую валюту и чужого поставщика', async () => {
    await expect(insert({ ...ok, currency: 'AMD' })).rejects.toThrow()
    await expect(insert({ ...ok, currency: 'GEL' })).rejects.toThrow()
    await expect(insert({ ...ok, provider: 'rate.am' })).rejects.toThrow()
  })

  it('не принимает нулевой и отрицательный курс', async () => {
    await expect(insert({ ...ok, scaled: '0' })).rejects.toThrow()
    await expect(insert({ ...ok, scaled: '-1' })).rejects.toThrow()
  })
})

describe('снимок курса в походе после миграции 0011', () => {
  it('принимает источник fallback и по-прежнему отвергает неизвестный', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const snapshot = {
      actorId,
      placeId,
      currency: 'AMD' as const,
      rateBase: 'RUB' as const,
      rateQuote: 'AMD' as const,
      rateScaled: 4_316_500n,
      rateAsOf: new Date('2026-09-18T20:00:00Z'),
    }

    await db.insert(trips).values({ ...snapshot, id: crypto.randomUUID(), rateSource: 'fallback' })
    await expect(
      db.execute(sql`update trips set rate_source = 'rate.am' where actor_id = ${actorId}`),
    ).rejects.toThrow()
  })
})
