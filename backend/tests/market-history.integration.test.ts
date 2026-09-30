import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { exchangesResponseCodec } from '@molvia/model'
import type { AmdRate, MarketRate } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createMarketRateRepository } from '@/db/market-rates-repository'
import { createRateRepository } from '@/db/rates-repository'
import { marketRates, officialRates } from '@/db/schema'
import { parseCbaRange } from '@/rates/cba-history'
import { parseMarketFile } from '@/rates/cba-market'
import type { MarketFile } from '@/rates/cba-market'
import { buildServer } from '@/server'
import { marketRatesRefresh } from '@/usecases/refresh-market-rates'
import { officialRatesRefresh } from '@/usecases/refresh-official-rates'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'

/**
 * The central bank's own bytes against each other (MOL-137, adversarial review А): the archive of
 * the official rate since 2022 and the recorded file of banks, both from 30.09.2026. The first band
 * of the market, fifteen percent, refused that file for good once the history was in the cache —
 * banks sold roubles 27.5 % above the official rate on 3 March 2022 — and nothing smaller than the
 * two files together shows it.
 */
const { db, close } = connectDrizzle()
const rates = createRateRepository(db)
const market = createMarketRateRepository(db)
let app: FastifyInstance

// Wednesday 30.09.2026, noon in Yerevan — the day both were recorded.
const NOW = new Date('2026-09-30T08:00:00.000Z')
const HOUR = 60 * 60 * 1000

function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/rates/${name}`, import.meta.url))
}

let archive: AmdRate[]
let daily: MarketRate[]

beforeAll(async () => {
  app = buildServer({ db })
  await app.ready()
  archive = parseCbaRange(fixture('cba-range-2022-01-01-2026-09-30.xml').toString('utf8'))
  const bytes = fixture('cba-forex-daily-2026-09-30.xlsx')
  daily = await parseMarketFile('FOREX ENG_Daily.xlsx', new Uint8Array(bytes).buffer)
}, 120_000)
beforeEach(async () => {
  await clearAll(db)
})
afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

/** An hour as `index.ts` runs it: the official refresh with its history, then the market. */
function hours() {
  const refused: object[] = []
  const asked: (string | null)[] = []
  let clock = NOW.getTime()
  const now = () => new Date(clock)
  const log = {
    warn: (details: object, message: string) => {
      if (message === 'market rates refused') refused.push(details)
    },
  }
  const official = officialRatesRefresh({
    primary: { provider: 'cba', fetchLatest: () => Promise.reject(new Error('silent')) },
    fallbacks: [],
    rates,
    log,
    now,
    history: { feed: { fetchRange: () => Promise.resolve(archive) }, rates },
  })
  const file: MarketFile = {
    name: 'FOREX ENG_Daily.xlsx',
    fetch(version) {
      asked.push(version)
      return Promise.resolve(version === 'daily' ? 'unchanged' : { version: 'daily', rates: daily })
    },
  }
  const marketRun = marketRatesRefresh({ files: [file], market, rates, log, now })
  return {
    refused,
    asked,
    async run() {
      await official()
      await marketRun()
      clock += HOUR
    },
  }
}

describe('the market against the official history since 2022 (MOL-137, review А)', () => {
  it('writes the file of banks whole once the history is in, and asks it by its version after', async () => {
    const run = hours()
    await run.run()
    await run.run()
    expect(await db.$count(officialRates)).toBe(3588)
    expect(await db.$count(marketRates, eq(marketRates.channel, 'banksAll'))).toBe(1196 * 6)
    expect(run.refused).toEqual([])
    expect(run.asked).toEqual([null, 'daily'])
  }, 120_000)

  it('sets a non-cash exchange of 2024 beside all bank clients, as В-2 says', async () => {
    await hours().run()
    const id = await insertActor(db)
    const response = await app.inject({
      method: 'POST',
      url: '/exchanges',
      headers: { cookie: await signIn(db, id) },
      payload: {
        id: randomUUID(),
        given: { amount: '100000', currency: 'RUB' },
        received: { amount: '440000', currency: 'AMD' },
        exchangedOn: '2024-05-10',
        channel: 'bankNoncash',
      },
    })
    const [exchange] = exchangesResponseCodec.parse(response.json()).exchanges
    expect(exchange?.official).not.toBeNull()
    expect(exchange?.market).toMatchObject({ best: { channel: 'bankNoncash', basis: 'banksAll' } })
  }, 120_000)
})
