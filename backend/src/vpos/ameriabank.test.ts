import { describe, expect, it, vi } from 'vitest'
import type { PaymentRow } from '@/db/payments-repository'
import {
  VPOS_CANCEL_WITHIN_MS,
  VPOS_TEST_DRAMS,
  ameriabankChannel,
  chargedDrams,
  judged,
  vposDescription,
} from './ameriabank'
import { VposError } from './client'
import type { VposClient, VposDetails } from './client'
import type { VposStrangeAnswer } from './ameriabank'

const created = new Date('2026-12-01T12:00:00Z')

const payment: PaymentRow = {
  id: 'p1',
  orderNo: 2350301n,
  actorId: 'anna',
  tariff: 'receipts',
  amount: { minor: 77_000n, currency: 'AMD' },
  refundedMinor: 0n,
  channel: 'ameriabank',
  channelRef: 'A1B2-C3',
  state: 'created',
  createdAt: created,
}

const paid: VposDetails = {
  responseCode: '00',
  orderStatus: '2',
  orderId: '2350301',
  currency: '051',
  approvedAmount: 770,
  approvalCode: '123456',
  rrn: '626301234567',
}

const expected = { orderNo: 2350301n, drams: 770n }

describe('judged — «paid» only by the bank’s own word for our order (requirement 4)', () => {
  it('is paid with the bank’s numbers when all five hold', () => {
    expect(judged(paid, expected)).toEqual({
      word: { said: 'paid', facts: { rrn: '626301234567', approvalCode: '123456' } },
      strange: null,
    })
  })

  it('is no payment when any one of the five fails, and the owner hears of it', () => {
    for (const broken of [
      { responseCode: '01' },
      { orderId: '2350302' },
      { currency: '840' },
      { approvedAmount: 760 },
      { approvedAmount: null },
    ]) {
      expect(judged({ ...paid, ...broken }, expected)).toEqual({
        word: { said: 'waiting' },
        strange: 'paid_mismatch',
      })
    }
  })

  it('declined and void are declined; nothing tried, its time out, a state between — waiting', () => {
    expect(judged({ ...paid, orderStatus: '6', responseCode: '0116' }, expected).word).toEqual({
      said: 'declined',
    })
    expect(judged({ ...paid, orderStatus: '3' }, expected).word).toEqual({ said: 'declined' })
    for (const orderStatus of ['0', '1', null]) {
      expect(judged({ ...paid, orderStatus, responseCode: '0-100' }, expected)).toEqual({
        word: { said: 'waiting' },
        strange: null,
      })
    }
    expect(judged(null, expected)).toEqual({ word: { said: 'waiting' }, strange: null })
  })

  it('«5» and «refunded» are not acted on, and said to the owner (Р-2)', () => {
    expect(judged({ ...paid, orderStatus: '5' }, expected).strange).toBe('status_5')
    expect(judged({ ...paid, orderStatus: '4' }, expected).strange).toBe('refunded_unknown')
  })
})

describe('what is charged and how it is described', () => {
  it('charges the journal’s drams, 10 ֏ on the test stand', () => {
    expect(chargedDrams(payment, 'live')).toBe(770n)
    expect(chargedDrams(payment, 'test')).toBe(VPOS_TEST_DRAMS)
  })

  it('describes it in Latin with nothing of the person', () => {
    expect(vposDescription('both')).toBe('Molvia, 30 days, both')
    expect(vposDescription('tip')).toBe('Molvia, tip')
  })
})

function bank(details: VposDetails | null = paid) {
  const client = {
    initPayment: vi.fn<VposClient['initPayment']>(() => Promise.resolve('A1B2-C3')),
    paymentDetails: vi.fn<VposClient['paymentDetails']>(() => Promise.resolve(details)),
    paymentId: vi.fn<VposClient['paymentId']>(() => Promise.resolve(null)),
    refund: vi.fn<VposClient['refund']>(() => Promise.resolve()),
    cancel: vi.fn<VposClient['cancel']>(() => Promise.resolve()),
    operations: vi.fn<VposClient['operations']>(() => Promise.resolve([])),
    pageUrl: (id: string, lang: string) => `https://bank.test/Pay?id=${id}&lang=${lang}`,
  } satisfies VposClient
  const strange: VposStrangeAnswer[] = []
  let clock = created.getTime()
  const channel = ameriabankChannel({
    client,
    stand: 'live',
    appBaseUrl: 'https://molvia.net',
    strange: (error) => strange.push(error),
    now: () => clock,
  })
  return { client, channel, strange, later: (ms: number) => (clock += ms) }
}

describe('the channel: the page, the word, the money back', () => {
  it('registers the order and sends the person to the bank’s page in their language, back to /pay/done', async () => {
    const { client, channel } = bank()

    expect(await channel.start(payment, 'en')).toEqual({
      ref: 'A1B2-C3',
      url: 'https://bank.test/Pay?id=A1B2-C3&lang=en',
    })
    expect(client.initPayment).toHaveBeenCalledWith({
      orderId: 2350301n,
      amount: 770n,
      description: 'Molvia, 30 days, receipts',
      backUrl: 'https://molvia.net/pay/done/p1',
    })
  })

  it('an answer lost finds the order by its number, else registers it again with the same body', async () => {
    const lost = bank()
    lost.client.initPayment.mockRejectedValueOnce(new VposError('unreachable', 'InitPayment'))
    lost.client.paymentId.mockResolvedValueOnce(null).mockResolvedValueOnce('FOUND-1')
    expect((await lost.channel.start(payment, 'ru')).ref).toBe('FOUND-1')
    expect(lost.client.initPayment).toHaveBeenCalledTimes(1)

    const never = bank()
    never.client.initPayment.mockRejectedValueOnce(new VposError('unreachable', 'InitPayment'))
    expect((await never.channel.start(payment, 'ru')).ref).toBe('A1B2-C3')
    const [first, second] = never.client.initPayment.mock.calls
    expect(second).toEqual(first)
  })

  it('a refusal is not repeated', async () => {
    const { client, channel } = bank()
    client.initPayment.mockRejectedValueOnce(new VposError('refused', 'InitPayment', '05'))
    await expect(channel.start(payment, 'ru')).rejects.toMatchObject({ bankCode: '05' })
    // asked once, before the order, never after a refusal
    expect(client.paymentId).toHaveBeenCalledTimes(1)
  })

  it('never registers an order number the bank already has — a database restored, or two on one stand (А2)', async () => {
    const { client, channel } = bank()
    client.paymentId.mockResolvedValueOnce('SOMEONE-ELSES')
    await expect(channel.start(payment, 'ru')).rejects.toMatchObject({
      kind: 'refused',
      bankCode: 'order_number_taken',
    })
    expect(client.initPayment).not.toHaveBeenCalled()
  })

  it('refuses a sum of no whole drams before the bank (review №7)', async () => {
    const { client, channel } = bank()
    await expect(
      channel.start({ ...payment, amount: { minor: 77_050n, currency: 'AMD' } }, 'ru'),
    ).rejects.toMatchObject({ bankCode: 'not_whole_drams' })
    const late = bank()
    late.later(VPOS_CANCEL_WITHIN_MS)
    await expect(late.channel.refund(payment, 30_050n)).rejects.toMatchObject({
      bankCode: 'not_whole_drams',
    })
    expect(client.initPayment).not.toHaveBeenCalled()
    expect(late.client.refund).not.toHaveBeenCalled()
  })

  it('asks by its own saved id — by our number where the start lost it — and tells the owner what it does not act on', async () => {
    const { client, channel, strange } = bank({ ...paid, orderStatus: '5' })

    expect(await channel.check(payment)).toEqual({ said: 'waiting' })
    expect(client.paymentDetails).toHaveBeenCalledWith('A1B2-C3')
    expect(strange.map((error) => error.strange)).toEqual(['status_5'])

    client.paymentId.mockResolvedValueOnce('FOUND-1')
    await channel.check({ ...payment, channelRef: null })
    expect(client.paymentDetails).toHaveBeenLastCalledWith('FOUND-1')
  })

  it('an order the bank never registered is waiting', async () => {
    const { client, channel } = bank()
    expect(await channel.check({ ...payment, channelRef: null })).toEqual({ said: 'waiting' })
    expect(client.paymentDetails).not.toHaveBeenCalled()
  })

  it('cancels a whole sum within 72 hours, refunds it after, and refunds a part in drams', async () => {
    const whole = bank()
    await whole.channel.refund(payment, 77_000n)
    expect(whole.client.cancel).toHaveBeenCalledWith('A1B2-C3')

    const late = bank()
    late.later(VPOS_CANCEL_WITHIN_MS)
    await late.channel.refund(payment, 77_000n)
    expect(late.client.cancel).not.toHaveBeenCalled()
    expect(late.client.refund).toHaveBeenCalledWith('A1B2-C3', 770n)

    const part = bank()
    await part.channel.refund(payment, 30_000n)
    expect(part.client.refund).toHaveBeenCalledWith('A1B2-C3', 300n)
    await part.channel.refund({ ...payment, refundedMinor: 30_000n }, 47_000n)
    expect(part.client.cancel).not.toHaveBeenCalled()
    expect(part.client.refund).toHaveBeenLastCalledWith('A1B2-C3', 470n)
  })

  it('on the test stand a whole sum is its 10 ֏, and a part is refused before the bank', async () => {
    const client = bank().client
    const channel = ameriabankChannel({
      client,
      stand: 'test',
      appBaseUrl: 'https://molvia.net',
      strange: () => undefined,
      now: () => created.getTime() + VPOS_CANCEL_WITHIN_MS,
    })
    await channel.refund(payment, 77_000n)
    expect(client.refund).toHaveBeenCalledWith('A1B2-C3', VPOS_TEST_DRAMS)
    await expect(channel.refund(payment, 1_000n)).rejects.toMatchObject({
      bankCode: 'test_stand_partial',
    })
  })
})
