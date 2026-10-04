import { describe, expect, it, vi } from 'vitest'
import type { ReceiptSummary } from '@molvia/model'
import type { TinPlace, UntoldReceipt } from '@/db/receipts-repository'
import { ReceiptNoticeUnreadable, claimReceiptNotices } from './tell-receipts'

const AT = new Date('2026-10-04T08:00:00Z') // 12:00 in Yerevan

function untold(patch: Partial<ReceiptSummary> = {}, telegramUserId = 4242): UntoldReceipt {
  return {
    receipt: {
      id: '0b0e2b9e-9a4d-4b0e-9f0e-6e6a4c3b2a10',
      status: 'parsed',
      failure: null,
      parts: 1,
      received: 1,
      capturedAt: new Date('2026-10-04T07:59:00Z'),
      country: 'AM',
      language: 'ru',
      header: { tin: '01234567', date: '2026-10-03', time: '20:15', receiptNo: '7' },
      total: null,
      balanced: true,
      lineCount: 7,
      unsettled: 0,
      place: null,
      tripId: null,
      ...patch,
    },
    currency: 'AMD',
    city: null,
    heard: 'bot',
    actor: { id: 'a1', telegramUserId, country: 'AM', city: 'Гюмри' },
  }
}

function seller(name: string): TinPlace {
  return {
    tin: '01234567',
    place: { id: 'p1', kind: 'store', name, country: 'AM', city: 'Гюмри' } as TinPlace['place'],
    ownLatest: null,
    voters: 1,
    latest: AT,
  }
}

function repository(receipts: UntoldReceipt[], places: TinPlace[] = [], twin = false) {
  return {
    claimUntold: vi.fn(() => Promise.resolve(receipts)),
    placesOfTins: vi.fn(() => Promise.resolve(places)),
    recordedTwin: vi.fn(() =>
      Promise.resolve(
        twin
          ? { receiptId: 'r0', tripId: 't0', recordedAt: new Date('2026-10-01T10:00:00Z') }
          : null,
      ),
    ),
  }
}

describe('claimReceiptNotices (MOL-129)', () => {
  it('words a receipt by its place, its printed day and its lines, ringing by day', async () => {
    const { notices } = await claimReceiptNotices(
      repository([untold()], [seller('Ереван Сити')]),
      AT,
      vi.fn(),
    )
    expect(notices).toEqual([
      {
        telegramUserId: 4242,
        receiptId: '0b0e2b9e-9a4d-4b0e-9f0e-6e6a4c3b2a10',
        outcome: 'parsed',
        language: 'ru',
        place: 'Ереван Сити',
        day: '2026-10-03',
        lineCount: 7,
        duplicate: false,
        silent: false,
      },
    ])
  })

  it('says a second shot of a receipt recorded before is one (adversarial А4)', async () => {
    const receipt = untold({
      header: { tin: '01234567', date: '2026-10-03', time: null, receiptNo: '417' },
    })
    const twin = repository([receipt], [], true)
    const { notices } = await claimReceiptNotices(twin, AT, vi.fn())
    expect(notices[0]?.duplicate).toBe(true)
    expect(twin.recordedTwin).toHaveBeenCalledWith('a1', '01234567', '417', receipt.receipt.id)
  })

  it('asks nothing about a twin without a number to know it by', async () => {
    const twin = repository(
      [untold({ header: { tin: '01234567', date: null, time: null, receiptNo: null } })],
      [],
      true,
    )
    const { notices } = await claimReceiptNotices(twin, AT, vi.fn())
    expect(notices[0]?.duplicate).toBe(false)
    expect(twin.recordedTwin).not.toHaveBeenCalled()
  })

  it('comes without a sound at night in the person’s zone', async () => {
    const night = new Date('2026-10-04T19:00:00Z') // 23:00 in Yerevan
    const { notices } = await claimReceiptNotices(repository([untold()]), night, vi.fn())
    expect(notices[0]?.silent).toBe(true)
  })

  it('names no place whose stored name today’s rule refuses, rather than lose the message', async () => {
    const { notices } = await claimReceiptNotices(
      repository([untold()], [seller(' ')]),
      AT,
      vi.fn(),
    )
    expect(notices[0]?.place).toBeNull()
  })

  it('says a notice the contract refuses, and hands the others', async () => {
    const unreadable = vi.fn()
    const broken = untold({ id: 'c3c3c3c3-9a4d-4b0e-9f0e-6e6a4c3b2a10' }, -1)
    const { notices } = await claimReceiptNotices(repository([broken, untold()]), AT, unreadable)
    expect(notices.map(({ receiptId }) => receiptId)).toEqual([
      '0b0e2b9e-9a4d-4b0e-9f0e-6e6a4c3b2a10',
    ])
    expect(unreadable).toHaveBeenCalledWith(expect.any(ReceiptNoticeUnreadable))
  })
})
