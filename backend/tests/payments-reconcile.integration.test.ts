import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ownerNoticeSchema } from '@molvia/model'
import type { PaymentMismatchNotice } from '@molvia/model'
import { createOwnerNoticeRepository } from '@/db/owner-notices-repository'
import { createPaymentsRepository } from '@/db/payments-repository'
import { connectDrizzle } from './db'
import { NO_QUOTA, clearAll, insertActor } from './fixtures'
import { sorted } from './rows'

const { db, close } = connectDrizzle()
const journal = createPaymentsRepository(db)
const notices = createOwnerNoticeRepository(db)

afterAll(close)
beforeEach(() => clearAll(db))

const facts = { rrn: '626301234567', approvalCode: '123456' }

async function aPayment(actorId: string) {
  const id = randomUUID()
  const written = await journal.createWithin(
    {
      id,
      actorId,
      tariff: 'receipts',
      anchor: { minor: 200n, currency: 'USD' },
      rate: {
        base: 'USD',
        quote: 'AMD',
        scaled: 383_120_000n,
        source: 'official',
        asOf: new Date('2026-11-30T00:00:00+04:00'),
      },
      amount: { minor: 77_000n, currency: 'AMD' },
      channel: 'ameriabank',
    },
    NO_QUOTA,
  )
  return { id, orderNo: written?.orderNo ?? 0n }
}

describe('what the reconciliation reads of the journal (MOL-277)', () => {
  it('names the payments still «created», old enough, oldest order first, at most the batch', async () => {
    const anna = await insertActor(db)
    const first = await aPayment(anna)
    const second = await aPayment(anna)
    const paid = await aPayment(anna)
    await journal.markPaid(paid.id, facts, new Date())

    const due = await journal.pending('ameriabank', new Date(Date.now() + 60_000), 10)
    expect(due.map((row) => row.id)).toEqual([first.id, second.id])
    expect(await journal.pending('ameriabank', new Date(Date.now() + 60_000), 1)).toHaveLength(1)
    // made a moment ago: not a minute old yet
    expect(await journal.pending('ameriabank', new Date(Date.now() - 60_000), 10)).toEqual([])
  })

  it('finds payments by their orders, and the paid ones of a period by when they were paid', async () => {
    const anna = await insertActor(db)
    const one = await aPayment(anna)
    const two = await aPayment(anna)
    const paidAt = new Date('2026-12-02T10:00:00+04:00')
    await journal.markPaid(one.id, facts, paidAt)

    expect(
      sorted(
        (await journal.byOrders('ameriabank', [one.orderNo, two.orderNo, 999_999n])).map(
          (r) => r.id,
        ),
      ),
    ).toEqual(sorted([one.id, two.id]))
    expect(await journal.byOrders('ameriabank', [])).toEqual([])
    const day = (from: string, to: string) =>
      journal.paidWithin('ameriabank', new Date(from), new Date(to))
    expect(
      (await day('2026-12-02T00:00:00+04:00', '2026-12-03T00:00:00+04:00')).map((r) => r.id),
    ).toEqual([one.id])
    expect(await day('2026-12-02T10:00:00.001+04:00', '2026-12-03T00:00:00+04:00')).toEqual([])
    expect(await day('2026-12-01T00:00:00+04:00', '2026-12-02T10:00:00+04:00')).toEqual([])
  })
})

describe('a mismatch told to the owner once (В-5 «а»)', () => {
  it('queues the notice once however many runs see it, and the claim reads it by the contract', async () => {
    const notice: PaymentMismatchNotice = {
      kind: 'payment_mismatch',
      orderNo: '1042',
      bank: '2',
      journal: 'declined',
    }
    await notices.queueOnce(notice, new Date())
    await notices.queueOnce(notice, new Date())
    await notices.queueOnce({ ...notice, bank: 'none' }, new Date())

    const claimed = await notices.claim(10, new Date())
    expect(
      sorted(
        claimed.map((payload) => ownerNoticeSchema.parse(payload)).map((n) => JSON.stringify(n)),
      ),
    ).toEqual(sorted([JSON.stringify(notice), JSON.stringify({ ...notice, bank: 'none' })]))
  })
})
