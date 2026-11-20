import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAYMENTS_DAY_MAX, yerevanDate } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, officialRates, payments } from '@/db/schema'
import { buildServer } from '@/server'
import type { ChannelWord, PaymentChannelAdapter } from '@/usecases/payments'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'
import { onlyRow } from './rows'

const { db, close } = connectDrizzle()

let word: ChannelWord = { said: 'waiting' }
const channel = {
  channel: 'ameriabank',
  start: vi.fn<PaymentChannelAdapter['start']>((payment, lang) =>
    Promise.resolve({
      ref: `BANK-${String(payment.orderNo)}`,
      url: `https://bank.test/Pay?id=BANK-${String(payment.orderNo)}&lang=${lang}`,
    }),
  ),
  check: vi.fn<PaymentChannelAdapter['check']>(() => Promise.resolve(word)),
  refund: vi.fn<PaymentChannelAdapter['refund']>(() => Promise.resolve()),
} satisfies PaymentChannelAdapter

let on: FastifyInstance
let off: FastifyInstance

beforeAll(async () => {
  on = buildServer({ db, ff: new Set(['payments']), paymentChannel: channel })
  off = buildServer({ db, ff: new Set() })
  await Promise.all([on.ready(), off.ready()])
})
beforeEach(async () => {
  await clearAll(db)
  word = { said: 'waiting' }
  vi.clearAllMocks()
})
afterAll(async () => {
  await Promise.all([on.close(), off.close()])
  await clearAll(db)
  await close()
})

/** The CBA's dollar of today in Yerevan — the price's one rate. */
async function dollarToday(provider: 'cba' | 'erapi' = 'cba') {
  await db.insert(officialRates).values({
    provider,
    currency: 'USD',
    rateDate: yerevanDate(new Date()),
    scaled: 383_120_000n,
  })
}

async function signedIn() {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

const start = (app: FastifyInstance, cookie: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/payments', headers: { cookie }, payload })

describe('payment by card — the routes (MOL-277)', () => {
  it('offers the three tariffs and the tips at today’s CBA rate, with the access as it stands', async () => {
    await dollarToday()
    const { cookie } = await signedIn()

    const response = await on.inject({
      method: 'GET',
      url: '/payments/tariffs',
      headers: { cookie },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const offer = response.json<{
      access: { shared: string | null; receipts: string | null }
      tariffs: { tariff: string; cents: number; amount: { amount: string; currency: string } }[]
      tips: { cents: number; amount: { amount: string } }[]
    }>()
    expect(offer.access).toEqual({ shared: null, receipts: null })
    expect(offer.tariffs.map((t) => [t.tariff, t.cents, t.amount])).toEqual([
      ['data', 100, { amount: '390.00', currency: 'AMD' }],
      ['receipts', 200, { amount: '770.00', currency: 'AMD' }],
      ['both', 250, { amount: '960.00', currency: 'AMD' }],
    ])
    expect(offer.tips.map((t) => t.cents)).toEqual([100, 300, 500])
  })

  it('offers no price while the CBA is silent — another provider’s rate is no price', async () => {
    await dollarToday('erapi')
    const { cookie } = await signedIn()

    const offer = (
      await on.inject({ method: 'GET', url: '/payments/tariffs', headers: { cookie } })
    ).json<{ tariffs: unknown; tips: unknown }>()
    const refused = await start(on, cookie, { tariff: 'data', lang: 'ru' })

    expect(offer).toMatchObject({ tariffs: null, tips: null })
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ code: 'error.payment_unpriced' })
    expect(await db.select().from(payments)).toEqual([])
  })

  it('starts a payment: written, named by the bank and the bank’s page handed back in the person’s language', async () => {
    await dollarToday()
    const { id, cookie } = await signedIn()

    const response = await start(on, cookie, { tariff: 'receipts', lang: 'en' })

    expect(response.statusCode).toBe(201)
    const started = response.json<{ id: string; url: string }>()
    const row = onlyRow(await db.select().from(payments).where(eq(payments.id, started.id)))
    expect(row).toMatchObject({
      actorId: id,
      tariff: 'receipts',
      amountMinor: 77_000n,
      state: 'created',
      channelRef: `BANK-${String(row?.orderNo)}`,
    })
    expect(started.url).toBe(`https://bank.test/Pay?id=BANK-${String(row?.orderNo)}&lang=en`)
  })

  it('takes a tip of its three sums only, and nothing else in the body', async () => {
    await dollarToday()
    const { cookie } = await signedIn()

    expect((await start(on, cookie, { tariff: 'tip', tipCents: 300, lang: 'ru' })).statusCode).toBe(
      201,
    )
    for (const body of [
      { tariff: 'tip', tipCents: 200, lang: 'ru' },
      { tariff: 'tip', lang: 'ru' },
      { tariff: 'data', lang: 'hy' },
      { tariff: 'data', lang: 'ru', amount: '1' },
      { tariff: 'gold', lang: 'ru' },
    ]) {
      expect((await start(on, cookie, body)).statusCode).toBe(400)
    }
    expect(await db.select({ id: payments.id }).from(payments)).toHaveLength(1)
  })

  it('a bank that did not register the payment is a 503, nothing charged and the row left for the reconciliation', async () => {
    await dollarToday()
    const { cookie } = await signedIn()
    channel.start.mockRejectedValueOnce(new Error('bank away'))

    const response = await start(on, cookie, { tariff: 'data', lang: 'ru' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ code: 'error.payment_channel_unavailable' })
    expect(onlyRow(await db.select().from(payments))).toMatchObject({
      state: 'created',
      channelRef: null,
    })
  })

  it('starts ten a rolling day of a person, refuses the eleventh, and counts nobody else’s', async () => {
    await dollarToday()
    const anna = await signedIn()
    const boris = await signedIn()

    for (let i = 0; i < PAYMENTS_DAY_MAX; i += 1) {
      expect((await start(on, anna.cookie, { tariff: 'data', lang: 'ru' })).statusCode).toBe(201)
    }
    const eleventh = await start(on, anna.cookie, { tariff: 'data', lang: 'ru' })

    expect(eleventh.statusCode).toBe(429)
    expect(eleventh.json()).toMatchObject({ code: 'error.payments_day_limited' })
    expect((await start(on, boris.cookie, { tariff: 'data', lang: 'ru' })).statusCode).toBe(201)
    expect(await db.select({ id: payments.id }).from(payments)).toHaveLength(PAYMENTS_DAY_MAX + 1)
  }, 30_000)

  it('the return page asks the bank of the person’s own payment and opens the access on «paid»', async () => {
    await dollarToday()
    const { id, cookie } = await signedIn()
    const started = (await start(on, cookie, { tariff: 'receipts', lang: 'ru' })).json<{
      id: string
    }>()
    word = { said: 'paid', facts: { rrn: '626301234567', approvalCode: '123456' } }

    const response = await on.inject({
      method: 'GET',
      url: `/payments/${started.id.toUpperCase()}`,
      headers: { cookie },
    })

    expect(response.statusCode).toBe(200)
    const status = response.json<{ state: string; access: { receipts: string | null } }>()
    expect(status.state).toBe('paid')
    const until = onlyRow(
      await db.select({ until: actors.receiptsModelUntil }).from(actors).where(eq(actors.id, id)),
    )?.until
    expect(status.access.receipts).toBe(until?.toISOString())
  })

  it('someone else’s payment, a missing one and a malformed address are one 404, the bank never asked', async () => {
    await dollarToday()
    const anna = await signedIn()
    const boris = await signedIn()
    const annas = (await start(on, anna.cookie, { tariff: 'data', lang: 'ru' })).json<{
      id: string
    }>()

    for (const url of [`/payments/${annas.id}`, `/payments/${randomUUID()}`, '/payments/nope']) {
      const response = await on.inject({ method: 'GET', url, headers: { cookie: boris.cookie } })
      expect(response.statusCode).toBe(404)
    }
    expect(channel.check).not.toHaveBeenCalled()
  })

  it('off, every route of payment is an address the API has not got — no 401 before the session', async () => {
    for (const [method, url] of [
      ['GET', '/payments/tariffs'],
      ['POST', '/payments'],
      ['GET', `/payments/${randomUUID()}`],
    ] as const) {
      expect((await off.inject({ method, url })).statusCode).toBe(404)
    }
  })
})
