import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR } from '@molvia/model'
import type { PaymentTariff } from '@molvia/model'
import { createErasureRepository } from '@/db/erasure-repository'
import { createPaymentsRepository } from '@/db/payments-repository'
import { actors, payments } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll, insertActor, telegramId } from './fixtures'
import { onlyRow } from './rows'

const { db, close } = connectDrizzle()
const journal = createPaymentsRepository(db)
const erasure = createErasureRepository(db)

afterAll(close)
beforeEach(() => clearAll(db))

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-12-01T12:00:00.000Z')
const days = (count: number, from = now) => new Date(from.getTime() + count * DAY)
const facts = { rrn: '626301234567', approvalCode: '123456' }
const conflict = { code: ERROR.CONFLICT }

async function aPayment(actorId: string, tariff: PaymentTariff = 'receipts', minor = 77_000n) {
  const id = randomUUID()
  await journal.create({
    id,
    actorId,
    tariff,
    anchor: { minor: 200n, currency: 'USD' },
    rate: {
      base: 'USD',
      quote: 'AMD',
      scaled: 383_120_000n,
      source: 'official',
      asOf: new Date('2026-11-30T00:00:00+04:00'),
    },
    amount: { minor, currency: 'AMD' },
    channel: 'ameriabank',
  })
  return id
}

async function accessOf(actorId: string) {
  return onlyRow(
    await db
      .select({ shared: actors.sharedUntil, receipts: actors.receiptsModelUntil })
      .from(actors)
      .where(eq(actors.id, actorId)),
  )
}

async function rowOf(id: string) {
  return onlyRow(await db.select().from(payments).where(eq(payments.id, id)))
}

describe('журнал платежей: создание (MOL-283)', () => {
  it('выдаёт номера заказов по порядку, целыми числами', async () => {
    const anna = await insertActor(db)
    const first = await journal.create({
      id: randomUUID(),
      actorId: anna,
      tariff: 'data',
      anchor: { minor: 100n, currency: 'USD' },
      rate: { base: 'USD', quote: 'AMD', scaled: 383_120_000n, source: 'official', asOf: now },
      amount: { minor: 39_000n, currency: 'AMD' },
      channel: 'ameriabank',
    })
    const second = await aPayment(anna)

    expect((await rowOf(second))?.orderNo).toBe(first.orderNo + 1n)
    expect((await rowOf(second))?.state).toBe('created')
  })

  it('номер канала уникален: второй платёж с тем же номером не пишется', async () => {
    const anna = await insertActor(db)
    const one = await aPayment(anna)
    const two = await aPayment(anna)
    await journal.named(one, 'F3A9')

    await expect(journal.named(two, 'F3A9')).rejects.toMatchObject({
      cause: { constraint_name: 'payments_channel_ref_key' },
    })
    expect((await rowOf(two))?.channelRef).toBeNull()
  })

  it('номер канал даёт один раз: повтор и другой номер не меняют ничего', async () => {
    const anna = await insertActor(db)
    const id = await aPayment(anna)
    await journal.named(id, 'F3A9')

    await journal.named(id, 'F3A9')
    await journal.named(id, 'B7D0')

    expect((await rowOf(id))?.channelRef).toBe('F3A9')
  })
})

describe('«оплачен» — ровно один раз, с продлением в той же транзакции', () => {
  it('продлевает чеки на 30 суток от конца действующего срока', async () => {
    const anna = await insertActor(db, { receiptsModelUntil: days(5) })
    const id = await aPayment(anna)

    const settled = await journal.markPaid(id, facts, now)

    expect(settled).toEqual({
      state: 'paid',
      moved: true,
      access: { receiptsModelUntil: days(35) },
    })
    expect(await accessOf(anna)).toEqual({ shared: null, receipts: days(35) })
    expect(await rowOf(id)).toMatchObject({
      state: 'paid',
      paidAt: now,
      movedAt: now,
      sharedUntil: null,
      receiptsModelUntil: days(35),
      ...facts,
    })
  })

  it('«оба» продлевает каждый срок от своего конца, кончившийся — от «сейчас»', async () => {
    const anna = await insertActor(db, { sharedUntil: days(-3), receiptsModelUntil: days(10) })
    const id = await aPayment(anna, 'both', 96_000n)

    await journal.markPaid(id, facts, now)

    expect(await accessOf(anna)).toEqual({ shared: days(30), receipts: days(40) })
    expect(await rowOf(id)).toMatchObject({ sharedUntil: days(30), receiptsModelUntil: days(40) })
  })

  it('чаевые не продлевают ничего', async () => {
    const anna = await insertActor(db, { sharedUntil: days(2) })
    const id = await aPayment(anna, 'tip', 39_000n)

    expect(await journal.markPaid(id, facts, now)).toEqual({
      state: 'paid',
      moved: true,
      access: {},
    })
    expect(await accessOf(anna)).toEqual({ shared: days(2), receipts: null })
  })

  it('два «оплачен» одного платежа разом — одно продление', async () => {
    const anna = await insertActor(db)
    const id = await aPayment(anna)

    const both = await Promise.all([
      journal.markPaid(id, facts, now),
      journal.markPaid(id, facts, now),
    ])

    expect(both.map((settled) => settled?.moved).sort()).toEqual([false, true])
    expect(await accessOf(anna)).toEqual({ shared: null, receipts: days(30) })
  })

  it('два разных платежа подряд продлевают дважды (В-3 «а»)', async () => {
    const anna = await insertActor(db)
    const one = await aPayment(anna)
    const two = await aPayment(anna)

    await journal.markPaid(one, facts, now)
    await journal.markPaid(two, facts, now)

    expect(await accessOf(anna)).toEqual({ shared: null, receipts: days(60) })
  })

  it('«оплачен» после «отклонён» не меняет ничего — отказ банка окончателен', async () => {
    const anna = await insertActor(db)
    const declined = await aPayment(anna)
    await journal.markClosed(declined, 'declined', now)

    expect(await journal.markPaid(declined, facts, days(1))).toEqual({
      state: 'declined',
      moved: false,
      access: {},
    })
    expect(await accessOf(anna)).toEqual({ shared: null, receipts: null })
    expect(await rowOf(declined)).toMatchObject({ closedAt: now, paidAt: null, rrn: null })
  })

  it('«оплачен» после «брошен» — оплачен: «брошен» наше суждение, не банка (адверсариал А2)', async () => {
    const anna = await insertActor(db)
    const abandoned = await aPayment(anna)
    await journal.markClosed(abandoned, 'abandoned', now)

    expect(await journal.markPaid(abandoned, facts, days(1))).toEqual({
      state: 'paid',
      moved: true,
      access: { receiptsModelUntil: days(31) },
    })
    expect(await rowOf(abandoned)).toMatchObject({
      state: 'paid',
      paidAt: days(1),
      closedAt: null,
      ...facts,
    })
    await journal.refund(abandoned, 77_000n, days(2))
    expect(await accessOf(anna)).toEqual({ shared: null, receipts: days(2) })
  })

  it('«отклонён» после «оплачен» не меняет ничего', async () => {
    const anna = await insertActor(db)
    const id = await aPayment(anna)
    await journal.markPaid(id, facts, now)

    expect((await journal.markClosed(id, 'declined', days(1)))?.moved).toBe(false)
    expect((await rowOf(id))?.state).toBe('paid')
  })

  it('платёж стёртого человека оплачивается и ничего не продлевает', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const id = await aPayment(anna)
    await journal.named(id, 'F3A9')
    await erasure.erase(tg, { dryRun: false })

    expect(await journal.markPaid(id, facts, now)).toEqual({
      state: 'paid',
      moved: true,
      access: {},
    })
    expect(await rowOf(id)).toMatchObject({ actorId: null, state: 'paid' })
  })

  it('неизвестный платёж — null', async () => {
    expect(await journal.markPaid(randomUUID(), facts, now)).toBeNull()
    expect(await journal.markClosed(randomUUID(), 'declined', now)).toBeNull()
  })
})

describe('возврат (В-2 «а»): полный забирает 30 суток, частичный — только деньги', () => {
  it('частичные возвраты суммируются, последний до суммы забирает срок', async () => {
    const anna = await insertActor(db)
    const id = await aPayment(anna)
    await journal.markPaid(id, facts, now)

    expect(await journal.refund(id, 7_000n, days(1))).toEqual({
      state: 'paid',
      moved: true,
      access: {},
    })
    expect(await accessOf(anna)).toEqual({ shared: null, receipts: days(30) })

    expect(await journal.refund(id, 70_000n, days(2))).toEqual({
      state: 'refunded',
      moved: true,
      access: { receiptsModelUntil: days(2) },
    })
    expect(await rowOf(id)).toMatchObject({
      state: 'refunded',
      refundedMinor: 77_000n,
      closedAt: days(2),
      movedAt: days(2),
    })
  })

  it('возврат после второго платежа забирает только непрожитые дни первого', async () => {
    const anna = await insertActor(db)
    const one = await aPayment(anna)
    const two = await aPayment(anna)
    await journal.markPaid(one, facts, now)
    await journal.markPaid(two, facts, now)

    await journal.refund(one, 77_000n, days(10))

    // Ten of the first payment's days lived, twenty taken back; the second's thirty stay from day 10.
    expect(await accessOf(anna)).toEqual({ shared: null, receipts: days(40) })
  })

  it('возврат прожитого платежа не трогает дни выдачи руками (адверсариал А1)', async () => {
    const anna = await insertActor(db)
    const spent = await aPayment(anna)
    await journal.markPaid(spent, facts, now)
    await db
      .update(actors)
      .set({ receiptsModelUntil: days(100) })
      .where(eq(actors.id, anna))

    await journal.refund(spent, 77_000n, days(41))

    expect(await accessOf(anna)).toEqual({ shared: null, receipts: days(100) })
  })

  it('возврат прожитого платежа не трогает дни следующего (адверсариал А1)', async () => {
    const anna = await insertActor(db)
    const spent = await aPayment(anna)
    const later = await aPayment(anna)
    await journal.markPaid(spent, facts, now)
    await journal.markPaid(later, facts, days(40))

    await journal.refund(spent, 77_000n, days(45))
    expect(await accessOf(anna)).toEqual({ shared: null, receipts: days(70) })
  })

  it('возврат раннего платежа сдвигает концы следующих: второй возврат берёт только свои дни (адверсариал Б1)', async () => {
    const anna = await insertActor(db)
    const [a, b, c] = [await aPayment(anna), await aPayment(anna), await aPayment(anna)]
    for (const id of [a, b, c]) await journal.markPaid(id, facts, now)

    await journal.refund(a, 77_000n, now)
    expect(await accessOf(anna)).toEqual({ shared: null, receipts: days(60) })
    expect(await rowOf(b)).toMatchObject({ receiptsModelUntil: days(30) })
    expect(await rowOf(c)).toMatchObject({ receiptsModelUntil: days(60) })

    // B's days are 0…30 now, ten of them left on day 20; C's thirty stay.
    await journal.refund(b, 77_000n, days(20))
    expect(await accessOf(anna)).toEqual({ shared: null, receipts: days(50) })
    expect(await rowOf(c)).toMatchObject({ receiptsModelUntil: days(50) })
  })

  it('и с выдачей руками после: возврат второго берёт только его дни (адверсариал Б1)', async () => {
    const anna = await insertActor(db)
    const [a, b] = [await aPayment(anna), await aPayment(anna)]
    await journal.markPaid(a, facts, now)
    await journal.markPaid(b, facts, now)
    await journal.refund(a, 77_000n, now)
    await db
      .update(actors)
      .set({ receiptsModelUntil: days(100) })
      .where(eq(actors.id, anna))

    await journal.refund(b, 77_000n, days(20))

    expect(await accessOf(anna)).toEqual({ shared: null, receipts: days(90) })
  })

  it('полный возврат платежа стёртого человека — возвращён, доступа нет', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const id = await aPayment(anna)
    await journal.named(id, 'F3A9')
    await journal.markPaid(id, facts, now)
    await erasure.erase(tg, { dryRun: false })

    expect(await journal.refund(id, 77_000n, days(1))).toEqual({
      state: 'refunded',
      moved: true,
      access: {},
    })
  })

  it('сверх суммы, у неоплаченного и у возвращённого — отказ, ничего не записано', async () => {
    const anna = await insertActor(db)
    const paid = await aPayment(anna)
    const created = await aPayment(anna)
    await journal.markPaid(paid, facts, now)

    await expect(journal.refund(paid, 77_001n, now)).rejects.toMatchObject(conflict)
    await expect(journal.refund(paid, 0n, now)).rejects.toMatchObject(conflict)
    await expect(journal.refund(created, 1_000n, now)).rejects.toMatchObject(conflict)
    await journal.refund(paid, 77_000n, now)
    await expect(journal.refund(paid, 1n, now)).rejects.toMatchObject(conflict)
    expect((await rowOf(paid))?.refundedMinor).toBe(77_000n)
    expect((await rowOf(created))?.refundedMinor).toBe(0n)
  })
})

describe('три года: платёж уходит через три года после последнего движения', () => {
  it('уходит ровно в срок, ни мгновением раньше — живого человека тоже', async () => {
    const anna = await insertActor(db)
    const old = await aPayment(anna)
    const young = await aPayment(anna)
    await journal.markPaid(old, facts, new Date('2023-12-01T12:00:00.000Z'))
    await journal.markPaid(young, facts, new Date('2023-12-01T12:00:00.001Z'))

    expect(await journal.sweep(now)).toBe(1)
    expect(await rowOf(old)).toBeUndefined()
    expect(await rowOf(young)).toBeDefined()
  })
})
