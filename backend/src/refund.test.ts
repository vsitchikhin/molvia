import { describe, expect, it, vi } from 'vitest'
import type { PaymentRow, PaymentsRepository } from '@/db/payments-repository'
import type { PaymentChannelAdapter } from '@/usecases/payments'
import { refund } from './refund'

const now = new Date('2026-12-01T12:00:00Z')

const PAID: PaymentRow = {
  id: 'p1',
  orderNo: 1042n,
  actorId: 'anna',
  tariff: 'receipts',
  amount: { minor: 77_000n, currency: 'AMD' },
  refundedMinor: 0n,
  channel: 'ameriabank',
  channelRef: 'A1B2',
  state: 'paid',
  createdAt: now,
}

function setup(row: PaymentRow | null = PAID) {
  const payments = {
    byOrders: vi.fn<PaymentsRepository['byOrders']>(() => Promise.resolve(row ? [row] : [])),
    get: vi.fn<PaymentsRepository['get']>(() => Promise.resolve(row)),
    refund: vi.fn<PaymentsRepository['refund']>(() =>
      Promise.resolve({ state: 'refunded', moved: true, access: {} }),
    ),
  }
  const bank = vi.fn<PaymentChannelAdapter['refund']>(() => Promise.resolve())
  const channel: PaymentChannelAdapter = {
    channel: 'ameriabank',
    start: vi.fn(),
    check: vi.fn(),
    refund: bank,
  }
  const lines: string[] = []
  const run = (args: string[], withChannel = true) =>
    refund(
      args,
      {
        payments: payments as unknown as PaymentsRepository,
        channel: withChannel ? channel : null,
        now: () => now,
      },
      (line) => lines.push(line),
    )
  return { payments, bank, lines, run }
}

describe('make refund — the owner gives money back (MOL-277, Р-9)', () => {
  it('is a dry run without --yes: the payment and what would go back, the bank never asked', async () => {
    const { bank, lines, run } = setup()

    expect(await run(['--order', '1042'])).toBe(0)

    expect(bank).not.toHaveBeenCalled()
    expect(lines.join('\n')).toContain('payment №1042: receipts, paid')
    expect(lines.join('\n')).toContain('would refund')
    expect(lines.join('\n')).toContain('the rest: the days not lived go back')
  })

  it('refunds all that is left with --yes — the bank first, then the journal', async () => {
    const { bank, payments, lines, run } = setup()

    expect(await run(['--order', '1042', '--yes'])).toBe(0)

    expect(bank).toHaveBeenCalledWith(PAID, 77_000n)
    expect(payments.refund).toHaveBeenCalledWith('p1', 77_000n, now)
    expect(bank.mock.invocationCallOrder[0]).toBeLessThan(
      payments.refund.mock.invocationCallOrder[0] ?? 0,
    )
    expect(lines.at(-1)).toBe('done: refunded')
  })

  it('refunds a part named in drams — money only', async () => {
    const { bank, lines, run } = setup()
    expect(await run(['--order', '1042', '--amount', '300', '--yes'])).toBe(0)
    expect(bank).toHaveBeenCalledWith(PAID, 30_000n)
    expect(lines.join('\n')).toContain('a part: money only')
  })

  it('refuses a sum past what is left, a payment not paid, no such order and a wrong call, before the bank', async () => {
    for (const [row, args, code] of [
      [PAID, ['--order', '1042', '--amount', '771', '--yes'], 1],
      [{ ...PAID, state: 'created' as const }, ['--order', '1042', '--yes'], 1],
      [null, ['--order', '1042', '--yes'], 1],
      [PAID, ['--order', 'abc'], 2],
      [PAID, ['--order', '1042', '--amount', 'lots'], 2],
      [PAID, ['--refund-everything'], 2],
    ] as const) {
      const { bank, run } = setup(row)
      expect(await run([...args])).toBe(code)
      expect(bank).not.toHaveBeenCalled()
    }
  })

  it('says the rule’s own reason of a refusal — never its guess (review №13)', async () => {
    for (const [row, args, said] of [
      [PAID, ['--order', '1042', '--amount', '0'], 'refused: nothing to refund'],
      [PAID, ['--order', '1042', '--amount', '771'], 'refused: 77100 past the 77000 left'],
      [{ ...PAID, state: 'created' as const }, ['--order', '1042'], 'refused: a payment created'],
    ] as const) {
      const { lines, run } = setup(row)
      await run([...args])
      expect(lines.at(-1)).toBe(said)
    }
  })

  it('refuses a sum of no whole drams before the bank (review №7)', async () => {
    const { bank, lines, run } = setup()
    expect(await run(['--order', '1042', '--amount', '100.5', '--yes'])).toBe(2)
    expect(bank).not.toHaveBeenCalled()
    expect(lines.at(-1)).toContain('no whole sum')
  })

  it('without the bank configured says what is needed and refunds nothing', async () => {
    const { payments, lines, run } = setup()
    expect(await run(['--order', '1042', '--yes'], false)).toBe(1)
    expect(payments.refund).not.toHaveBeenCalled()
    expect(lines.at(-1)).toContain('VPOS_PASSWORD')
  })
})
