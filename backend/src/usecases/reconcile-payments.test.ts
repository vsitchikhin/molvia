import { describe, expect, it, vi } from 'vitest'
import type { PaymentMismatchNotice } from '@molvia/model'
import type { PaymentRow, PaymentsRepository } from '@/db/payments-repository'
import type { ChannelWord, PaymentChannelAdapter } from './payments'
import {
  PAYMENT_FIRST_ASK_MS,
  PAYMENT_LAST_ASK_MS,
  reconcilePending,
  reconcileWithList,
} from './reconcile-payments'

const now = new Date('2026-12-03T12:00:00Z')
const facts = { rrn: '626301234567', approvalCode: '123456' }

function payment(row: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'p1',
    orderNo: 1042n,
    actorId: 'anna',
    tariff: 'receipts',
    amount: { minor: 77_000n, currency: 'AMD' },
    refundedMinor: 0n,
    channel: 'ameriabank',
    channelRef: 'A1B2',
    state: 'created',
    createdAt: new Date(now.getTime() - 5 * 60_000),
    ...row,
  }
}

function journal(rows: readonly PaymentRow[] = []) {
  const settled = (state: PaymentRow['state']) =>
    Promise.resolve({ state, moved: true, access: {} })
  return {
    pending: vi.fn<PaymentsRepository['pending']>(() => Promise.resolve(rows)),
    byOrders: vi.fn<PaymentsRepository['byOrders']>(() => Promise.resolve(rows)),
    paidWithin: vi.fn<PaymentsRepository['paidWithin']>(() => Promise.resolve([])),
    get: vi.fn<PaymentsRepository['get']>((id) =>
      Promise.resolve(rows.find((row) => row.id === id) ?? null),
    ),
    markPaid: vi.fn<PaymentsRepository['markPaid']>(() => settled('paid')),
    markClosed: vi.fn<PaymentsRepository['markClosed']>((_id, state) => settled(state)),
  }
}

function bank(...words: ChannelWord[]) {
  const check = vi.fn<PaymentChannelAdapter['check']>()
  for (const word of words) check.mockResolvedValueOnce(word)
  check.mockResolvedValue({ said: 'waiting' })
  const channel: PaymentChannelAdapter = {
    channel: 'ameriabank',
    start: vi.fn(),
    check,
    refund: vi.fn(),
  }
  return { channel, check }
}

/** The journal mock as the use case's type: the methods it calls, the rest never reached. */
const asJournal = (mock: ReturnType<typeof journal>) => mock as unknown as PaymentsRepository

describe('reconcilePending — the minute asks the bank of each page still open (requirement 6)', () => {
  it('asks of the payments a minute old and more, and writes «paid» as the return page would', async () => {
    const rows = [payment()]
    const payments = journal(rows)
    const { channel } = bank({ said: 'paid', facts })

    expect(
      await reconcilePending({ payments: asJournal(payments), channel, failed: vi.fn() }, now),
    ).toBe(1)
    expect(payments.pending).toHaveBeenCalledWith(
      'ameriabank',
      new Date(now.getTime() - PAYMENT_FIRST_ASK_MS),
      100,
    )
    expect(payments.markPaid).toHaveBeenCalledWith('p1', facts, now)
  })

  it('leaves a page under 25 minutes waiting, and abandons it at 25 unless the bank says otherwise', async () => {
    const young = payment({
      id: 'young',
      createdAt: new Date(now.getTime() - PAYMENT_LAST_ASK_MS + 1),
    })
    const old = payment({ id: 'old', createdAt: new Date(now.getTime() - PAYMENT_LAST_ASK_MS) })
    const declined = payment({ id: 'declined', createdAt: old.createdAt })
    const payments = journal([young, old, declined])
    const { channel } = bank({ said: 'waiting' }, { said: 'waiting' }, { said: 'declined' })

    await reconcilePending({ payments: asJournal(payments), channel, failed: vi.fn() }, now)

    expect(payments.markClosed.mock.calls).toEqual([
      ['old', 'abandoned', now],
      ['declined', 'declined', now],
    ])
  })

  it('a bank away leaves the payment for the next minute, tells it, and asks the next one all the same', async () => {
    const payments = journal([payment({ id: 'a' }), payment({ id: 'b' })])
    const { channel, check } = bank()
    const away = new Error('down')
    check.mockRejectedValueOnce(away).mockResolvedValueOnce({ said: 'paid', facts })
    const failed = vi.fn()

    await reconcilePending({ payments: asJournal(payments), channel, failed }, now)

    expect(failed).toHaveBeenCalledWith(away)
    expect(payments.markPaid).toHaveBeenCalledWith('b', facts, now)
    expect(payments.markClosed).not.toHaveBeenCalled()
  })
})

describe('reconcileWithList — the bank’s list of the days before against the journal (В-5 «а»)', () => {
  function deps(rows: readonly PaymentRow[], operations: { orderId: string; state: string }[]) {
    const payments = journal(rows)
    const told: PaymentMismatchNotice[] = []
    const { channel, check } = bank()
    const list = vi.fn(() => Promise.resolve(operations))
    return {
      payments,
      check,
      told,
      list,
      all: {
        payments: asJournal(payments),
        channel,
        operations: list,
        tell: (notice: PaymentMismatchNotice) => {
          told.push(notice)
          return Promise.resolve()
        },
        failed: vi.fn(),
      },
    }
  }

  it('reads the two whole days before today in Yerevan', async () => {
    const { all, list } = deps([], [])
    await reconcileWithList(all, new Date('2026-12-03T21:30:00Z'))
    expect(list).toHaveBeenCalledWith(
      new Date('2026-12-02T00:00:00+04:00'),
      new Date('2026-12-04T00:00:00+04:00'),
    )
  })

  it('says nothing where both agree — paid, or refunded after it', async () => {
    const { all, told, check } = deps(
      [payment({ state: 'paid' }), payment({ id: 'p2', orderNo: 1043n, state: 'refunded' })],
      [
        { orderId: '1042', state: '2' },
        { orderId: '1043', state: '4' },
        { orderId: '1044', state: '6' },
      ],
    )
    expect(await reconcileWithList(all, now)).toBe(0)
    expect(told).toEqual([])
    expect(check).not.toHaveBeenCalled()
  })

  it('settles an order the bank took money for and the minute missed, and tells nothing once it is paid', async () => {
    const { all, told, check, payments } = deps(
      [payment({ state: 'abandoned' })],
      [{ orderId: '1042', state: '2' }],
    )
    check.mockResolvedValueOnce({ said: 'paid', facts })

    await reconcileWithList(all, now)

    expect(payments.markPaid).toHaveBeenCalledWith('p1', facts, now)
    expect(told).toEqual([])
  })

  it('tells what still disagrees, either way round, by the order and the two states', async () => {
    const declined = payment({ state: 'declined' })
    const { all, told, payments, check } = deps(
      [declined],
      [
        { orderId: '1042', state: '2' },
        { orderId: '9999', state: '2' },
        { orderId: '1050', state: '6' },
      ],
    )
    payments.markClosed.mockResolvedValue({ state: 'declined', moved: false, access: {} })
    payments.paidWithin.mockResolvedValueOnce([
      payment({ id: 'p3', orderNo: 1050n, state: 'paid' }),
      payment({ id: 'p4', orderNo: 1051n, state: 'paid' }),
    ])
    check.mockResolvedValueOnce({ said: 'declined' })

    expect(await reconcileWithList(all, now)).toBe(4)
    expect(told).toEqual([
      { kind: 'payment_mismatch', orderNo: '1042', bank: '2', journal: 'declined' },
      { kind: 'payment_mismatch', orderNo: '9999', bank: '2', journal: 'none' },
      { kind: 'payment_mismatch', orderNo: '1050', bank: '6', journal: 'paid' },
      { kind: 'payment_mismatch', orderNo: '1051', bank: 'none', journal: 'paid' },
    ])
  })

  it('an order the bank lists that is no number of ours is a failure, never a notice', async () => {
    const { all, told } = deps([], [{ orderId: 'abc', state: '2' }])
    await reconcileWithList(all, now)
    expect(told).toEqual([])
    expect(all.failed).toHaveBeenCalled()
  })
})
