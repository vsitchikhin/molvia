import { describe, expect, it, vi } from 'vitest'
import { DomainError, ERROR } from '@molvia/model'
import type { CachedRate } from '@molvia/model'
import type { PaymentRow, PaymentsRepository } from '@/db/payments-repository'
import type { RateRepository } from '@/db/rates-repository'
import { openPayment, refundPayment, settlePayment } from './payments'
import type { PaymentChannelAdapter } from './payments'

const now = new Date('2026-12-01T12:00:00Z')

const usd = (
  date: string,
  scaled = 383_120_000n,
  provider: CachedRate['provider'] = 'cba',
): CachedRate => ({
  provider,
  currency: 'USD',
  date,
  scaled,
  jump: false,
})

function journal(row: Partial<PaymentRow> = {}) {
  const payment: PaymentRow = {
    id: 'p1',
    orderNo: 1042n,
    actorId: 'anna',
    tariff: 'receipts',
    amount: { minor: 77_000n, currency: 'AMD' },
    refundedMinor: 0n,
    channel: 'ameriabank',
    channelRef: 'ref',
    state: 'paid',
    createdAt: now,
    ...row,
  }
  return {
    create: vi.fn<PaymentsRepository['create']>(() => Promise.resolve({ orderNo: 1042n })),
    named: vi.fn<PaymentsRepository['named']>(() => Promise.resolve()),
    get: vi.fn<PaymentsRepository['get']>(() => Promise.resolve(payment)),
    markPaid: vi.fn<PaymentsRepository['markPaid']>(() =>
      Promise.resolve({ state: 'paid', moved: true, access: {} }),
    ),
    markClosed: vi.fn<PaymentsRepository['markClosed']>(() =>
      Promise.resolve({ state: 'declined', moved: true, access: {} }),
    ),
    refund: vi.fn<PaymentsRepository['refund']>(() =>
      Promise.resolve({ state: 'refunded', moved: true, access: {} }),
    ),
    sweep: vi.fn<PaymentsRepository['sweep']>(() => Promise.resolve(0)),
  } satisfies PaymentsRepository
}

const rates = (rows: readonly CachedRate[]): Pick<RateRepository, 'latestOnOrBefore'> => ({
  latestOnOrBefore: vi.fn(() => Promise.resolve(rows)),
})

function bank() {
  const refund = vi.fn<PaymentChannelAdapter['refund']>(() => Promise.resolve())
  const channel: PaymentChannelAdapter = {
    channel: 'ameriabank',
    start: vi.fn(),
    check: vi.fn(),
    refund,
  }
  return { channel, refund }
}

describe('openPayment — the price fixed at creation (MOL-283)', () => {
  it('writes the tariff at the CBA’s rate fresh for today, rounded up to 10 ֏, with its moment', async () => {
    const payments = journal()
    const rows = rates([usd('2026-11-28')])

    const opened = await openPayment(
      { payments, rates: rows },
      { actorId: 'anna', tariff: 'both', channel: 'ameriabank', now },
    )

    expect(opened).toMatchObject({ orderNo: 1042n, amount: { minor: 96_000n, currency: 'AMD' } })
    expect(rows.latestOnOrBefore).toHaveBeenCalledWith(['USD'], '2026-12-01')
    expect(payments.create.mock.calls[0]?.[0]).toMatchObject({
      actorId: 'anna',
      tariff: 'both',
      anchor: { minor: 250n, currency: 'USD' },
      rate: {
        scaled: 383_120_000n,
        source: 'official',
        asOf: new Date('2026-11-28T00:00:00+04:00'),
      },
      amount: { minor: 96_000n, currency: 'AMD' },
    })
  })

  it('counts today by Yerevan: 21:00 UTC is already the next day there', async () => {
    const rows = rates([usd('2026-11-28')])

    await openPayment(
      { payments: journal(), rates: rows },
      {
        actorId: 'anna',
        tariff: 'data',
        channel: 'ameriabank',
        now: new Date('2026-11-30T21:00:00Z'),
      },
    )

    expect(rows.latestOnOrBefore).toHaveBeenCalledWith(['USD'], '2026-12-01')
  })

  it('opens nothing without the CBA’s rate fresh for today', async () => {
    const payments = journal()

    const opened = await openPayment(
      { payments, rates: rates([usd('2026-11-01')]) },
      { actorId: 'anna', tariff: 'data', channel: 'ameriabank', now },
    )

    expect(opened).toBeNull()
    expect(payments.create).not.toHaveBeenCalled()
  })

  it('never takes another provider’s rate while the CBA is silent (А3)', async () => {
    const payments = journal()

    const opened = await openPayment(
      {
        payments,
        rates: rates([usd('2026-11-10'), usd('2026-11-30', 400_000_000n, 'erapi')]),
      },
      { actorId: 'anna', tariff: 'data', channel: 'ameriabank', now },
    )

    expect(opened).toBeNull()
    expect(payments.create).not.toHaveBeenCalled()
  })

  it('refuses a tip of an amount not offered', async () => {
    const payments = journal()

    await expect(
      openPayment(
        { payments, rates: rates([usd('2026-11-30')]) },
        { actorId: 'anna', tariff: 'tip', tipCents: 200n, channel: 'ameriabank', now },
      ),
    ).rejects.toThrow(expect.objectContaining({ code: ERROR.INVALID_AMOUNT }))
    expect(payments.create).not.toHaveBeenCalled()
  })
})

describe('settlePayment — a channel’s word into the journal', () => {
  it('«paid» goes to the one transition that extends access', async () => {
    const payments = journal()
    const facts = { rrn: '626301234567', approvalCode: '123456' }

    await settlePayment({ payments }, 'p1', { said: 'paid', facts }, now)

    expect(payments.markPaid).toHaveBeenCalledWith('p1', facts, now)
  })

  it('«declined» and «abandoned» close it, «waiting» moves nothing', async () => {
    const payments = journal({ state: 'created' })

    await settlePayment({ payments }, 'p1', { said: 'abandoned' }, now)
    const waiting = await settlePayment({ payments }, 'p1', { said: 'waiting' }, now)

    expect(payments.markClosed).toHaveBeenCalledWith('p1', 'abandoned', now)
    expect(waiting).toEqual({ state: 'created', moved: false, access: {} })
    expect(payments.markPaid).not.toHaveBeenCalled()
  })
})

describe('refundPayment — the bank first, the journal after', () => {
  it('gives back all that is left when no sum is named', async () => {
    const payments = journal({ refundedMinor: 7_000n })
    const { channel, refund } = bank()

    await refundPayment({ payments, channel }, 'p1', undefined, now)

    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 70_000n)
    expect(payments.refund).toHaveBeenCalledWith('p1', 70_000n, now)
  })

  it('refuses past what is left, and a payment not paid, before asking the bank', async () => {
    for (const [row, sum] of [
      [{ refundedMinor: 7_000n }, 70_001n],
      [{ state: 'created' as const }, 1_000n],
      [{ state: 'refunded' as const, refundedMinor: 77_000n }, undefined],
    ] as const) {
      const payments = journal(row)
      const { channel, refund } = bank()

      await expect(refundPayment({ payments, channel }, 'p1', sum, now)).rejects.toThrow(
        expect.objectContaining({ code: ERROR.CONFLICT }),
      )
      expect(refund).not.toHaveBeenCalled()
      expect(payments.refund).not.toHaveBeenCalled()
    }
  })

  it('writes nothing when the bank refused', async () => {
    const payments = journal()
    const { channel, refund } = bank()
    refund.mockRejectedValueOnce(new Error('bank says no'))

    await expect(refundPayment({ payments, channel }, 'p1', 1_000n, now)).rejects.toThrow(
      'bank says no',
    )
    expect(payments.refund).not.toHaveBeenCalled()
  })

  it('says the bank gave the money when the journal refuses after it — no conflict (review №3)', async () => {
    const payments = journal()
    const { channel } = bank()
    payments.refund.mockRejectedValueOnce(new DomainError(ERROR.CONFLICT, 'refund 77000 of paid'))

    const refused = refundPayment({ payments, channel }, 'p1', undefined, now)

    await expect(refused).rejects.toThrow('the bank refunded 77000 of p1')
    await expect(refused).rejects.not.toBeInstanceOf(DomainError)
  })
})
