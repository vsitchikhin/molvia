import { describe, expect, it, vi } from 'vitest'
import { DomainError, ERROR } from '@molvia/model'
import type { CachedRate } from '@molvia/model'
import type { PaymentRow, PaymentsRepository } from '@/db/payments-repository'
import type { RateRepository } from '@/db/rates-repository'
import {
  confirmPayment,
  offerPayments,
  openPayment,
  paymentAskLimiter,
  refundPayment,
  settlePayment,
  startPayment,
} from './payments'
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
    createWithin: vi.fn<PaymentsRepository['createWithin']>(() =>
      Promise.resolve({ orderNo: 1042n }),
    ),
    paidUntil: vi.fn<PaymentsRepository['paidUntil']>(() =>
      Promise.resolve({ sharedUntil: null, receiptsModelUntil: null }),
    ),
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
    pending: vi.fn<PaymentsRepository['pending']>(() => Promise.resolve([])),
    byOrders: vi.fn<PaymentsRepository['byOrders']>(() => Promise.resolve([])),
    paidWithin: vi.fn<PaymentsRepository['paidWithin']>(() => Promise.resolve([])),
    tapRfCard: vi.fn<PaymentsRepository['tapRfCard']>(() => Promise.resolve()),
  } satisfies PaymentsRepository
}

const rates = (rows: readonly CachedRate[]): Pick<RateRepository, 'latestOnOrBefore'> => ({
  latestOnOrBefore: vi.fn(() => Promise.resolve(rows)),
})

function bank() {
  const refund = vi.fn<PaymentChannelAdapter['refund']>(() => Promise.resolve())
  const start = vi.fn<PaymentChannelAdapter['start']>(() =>
    Promise.resolve({ ref: 'A1B2', url: 'https://bank.test/Pay?id=A1B2&lang=ru' }),
  )
  const check = vi.fn<PaymentChannelAdapter['check']>(() =>
    Promise.resolve({ said: 'waiting' } as const),
  )
  const channel: PaymentChannelAdapter = { channel: 'ameriabank', start, check, refund }
  return { channel, refund, start, check }
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
    expect(payments.createWithin.mock.calls[0]?.[0]).toMatchObject({
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
    expect(payments.createWithin).not.toHaveBeenCalled()
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
    expect(payments.createWithin).not.toHaveBeenCalled()
  })

  it('refuses a tip of an amount not offered', async () => {
    const payments = journal()

    await expect(
      openPayment(
        { payments, rates: rates([usd('2026-11-30')]) },
        { actorId: 'anna', tariff: 'tip', tipCents: 200n, channel: 'ameriabank', now },
      ),
    ).rejects.toThrow(expect.objectContaining({ code: ERROR.INVALID_AMOUNT }))
    expect(payments.createWithin).not.toHaveBeenCalled()
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

describe('the quota of payments a day (Р-12)', () => {
  it('counts a rolling day of the person’s payments, and refuses past ten with nothing written', async () => {
    const payments = journal()
    await openPayment(
      { payments, rates: rates([usd('2026-11-30')]) },
      { actorId: 'anna', tariff: 'data', channel: 'ameriabank', now },
    )
    expect(payments.createWithin.mock.calls[0]?.slice(1)).toEqual([
      10,
      new Date('2026-11-30T12:00:00Z'),
    ])

    payments.createWithin.mockResolvedValueOnce(null)
    await expect(
      openPayment(
        { payments, rates: rates([usd('2026-11-30')]) },
        { actorId: 'anna', tariff: 'data', channel: 'ameriabank', now },
      ),
    ).rejects.toThrow(expect.objectContaining({ code: ERROR.PAYMENTS_DAY_LIMITED }))
  })
})

describe('offerPayments — the prices today and where each term would end (MOL-277)', () => {
  it('prices every tariff and tip, each term thirty days on from its own end or from now', async () => {
    const payments = journal()
    const running = new Date('2026-12-11T12:00:00Z')
    payments.paidUntil.mockResolvedValueOnce({ sharedUntil: running, receiptsModelUntil: null })

    const offer = await offerPayments({ payments, rates: rates([usd('2026-11-30')]) }, 'anna', now)

    expect(offer.access).toEqual({ shared: running, receipts: null })
    expect(offer.tariffs).toEqual([
      {
        tariff: 'data',
        cents: 100,
        amount: { minor: 39_000n, currency: 'AMD' },
        after: { shared: new Date('2027-01-10T12:00:00Z'), receipts: null },
      },
      {
        tariff: 'receipts',
        cents: 200,
        amount: { minor: 77_000n, currency: 'AMD' },
        after: { shared: running, receipts: new Date('2026-12-31T12:00:00Z') },
      },
      {
        tariff: 'both',
        cents: 250,
        amount: { minor: 96_000n, currency: 'AMD' },
        after: {
          shared: new Date('2027-01-10T12:00:00Z'),
          receipts: new Date('2026-12-31T12:00:00Z'),
        },
      },
    ])
    expect(offer.tips?.map((tip) => [tip.cents, tip.amount.minor])).toEqual([
      [100, 39_000n],
      [300, 115_000n],
      [500, 192_000n],
    ])
  })

  it('offers no price while the CBA is silent, and still says the access', async () => {
    const offer = await offerPayments(
      { payments: journal(), rates: rates([usd('2026-11-01')]) },
      'anna',
      now,
    )
    expect(offer).toEqual({ access: { shared: null, receipts: null }, tariffs: null, tips: null })
  })
})

describe('startPayment — written, then registered with the bank (requirement 3)', () => {
  const deps = (payments = journal(), channel = bank()) => ({
    payments,
    rates: rates([usd('2026-11-30')]),
    channel: channel.channel,
    failed: vi.fn(),
  })

  it('writes the payment, names it by the bank’s id and sends the person to the bank’s page', async () => {
    const payments = journal({ state: 'created', channelRef: null })
    const channel = bank()

    const started = await startPayment(deps(payments, channel), {
      actorId: 'anna',
      tariff: 'receipts',
      lang: 'en',
      now,
    })

    expect(started.url).toBe('https://bank.test/Pay?id=A1B2&lang=ru')
    expect(typeof started.id).toBe('string')
    expect(channel.start).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'en')
    expect(payments.named).toHaveBeenCalledWith(started.id, 'A1B2')
  })

  it('a bank away or refusing is «try later» to the person and a failure to the owner, nothing named', async () => {
    const payments = journal({ state: 'created', channelRef: null })
    const channel = bank()
    const away = new Error('ameriabank down')
    channel.start.mockRejectedValueOnce(away)
    const all = deps(payments, channel)

    await expect(
      startPayment(all, { actorId: 'anna', tariff: 'data', lang: 'ru', now }),
    ).rejects.toThrow(expect.objectContaining({ code: ERROR.PAYMENT_CHANNEL_UNAVAILABLE }))
    expect(all.failed).toHaveBeenCalledWith(away)
    expect(payments.named).not.toHaveBeenCalled()
  })

  it('no price today is refused before the bank', async () => {
    const channel = bank()
    await expect(
      startPayment(
        { ...deps(journal(), channel), rates: rates([]) },
        { actorId: 'anna', tariff: 'data', lang: 'ru', now },
      ),
    ).rejects.toThrow(expect.objectContaining({ code: ERROR.PAYMENT_UNPRICED }))
    expect(channel.start).not.toHaveBeenCalled()
  })
})

describe('confirmPayment — the return page asks what became of it (requirement 5)', () => {
  const facts = { rrn: '626301234567', approvalCode: '123456' }

  it('asks the bank of a payment still «created» and writes its word', async () => {
    const payments = journal({ state: 'created' })
    const { channel, check } = bank()
    check.mockResolvedValueOnce({ said: 'paid', facts })
    const until = new Date('2026-12-31T12:00:00Z')
    payments.paidUntil.mockResolvedValueOnce({ sharedUntil: null, receiptsModelUntil: until })

    const status = await confirmPayment(
      { payments, channel, mayAsk: () => true, failed: vi.fn() },
      'anna',
      'p1',
      now,
    )

    expect(payments.markPaid).toHaveBeenCalledWith('p1', facts, now)
    expect(status).toEqual({
      state: 'paid',
      tariff: 'receipts',
      amount: { minor: 77_000n, currency: 'AMD' },
      access: { shared: null, receipts: until },
    })
  })

  it('someone else’s payment and a missing one are one 404, the bank never asked', async () => {
    const { channel, check } = bank()
    const notMine = journal({ actorId: 'boris', state: 'created' })
    const missing = journal()
    missing.get.mockResolvedValueOnce(null)
    for (const payments of [notMine, missing]) {
      await expect(
        confirmPayment(
          { payments, channel, mayAsk: () => true, failed: vi.fn() },
          'anna',
          'p1',
          now,
        ),
      ).rejects.toThrow(expect.objectContaining({ code: ERROR.NOT_FOUND }))
    }
    expect(check).not.toHaveBeenCalled()
  })

  it('asks nothing of a payment moved, or asked within five seconds', async () => {
    const { channel, check } = bank()
    await confirmPayment(
      { payments: journal({ state: 'paid' }), channel, mayAsk: () => true, failed: vi.fn() },
      'anna',
      'p1',
      now,
    )
    await confirmPayment(
      { payments: journal({ state: 'created' }), channel, mayAsk: () => false, failed: vi.fn() },
      'anna',
      'p1',
      now,
    )
    expect(check).not.toHaveBeenCalled()
  })

  it('a bank away answers the state as it stands, and the owner hears of it', async () => {
    const { channel, check } = bank()
    const away = new Error('down')
    check.mockRejectedValueOnce(away)
    const failed = vi.fn()

    const status = await confirmPayment(
      { payments: journal({ state: 'created' }), channel, mayAsk: () => true, failed },
      'anna',
      'p1',
      now,
    )

    expect(status.state).toBe('created')
    expect(failed).toHaveBeenCalledWith(away)
  })
})

describe('paymentAskLimiter — once in five seconds a payment', () => {
  it('lets a payment be asked again only after its five seconds, others at once', () => {
    let clock = 0
    const mayAsk = paymentAskLimiter(5_000, () => clock)
    expect(mayAsk('p1')).toBe(true)
    expect(mayAsk('p1')).toBe(false)
    expect(mayAsk('p2')).toBe(true)
    clock = 4_999
    expect(mayAsk('p1')).toBe(false)
    clock = 5_000
    expect(mayAsk('p1')).toBe(true)
  })
})
