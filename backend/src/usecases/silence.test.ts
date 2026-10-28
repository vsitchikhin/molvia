import { describe, expect, it, vi } from 'vitest'
import type { ErasureReport } from '@/db/erasure-repository'
import { claimSilenceNotices, eraseSilent } from './silence'

const NOON = new Date('2027-09-26T08:00:00.000Z')
const NIGHT = new Date('2027-09-25T21:00:00.000Z')

const warned = {
  telegramUserId: 4242,
  country: 'AM',
  step: 30 as const,
  eraseAt: new Date('2027-10-26T08:00:00.000Z'),
}

describe('claimSilenceNotices (MOL-239)', () => {
  it('ночью во всех странах базу не спрашивает', async () => {
    const claimWarnings = vi.fn(() => Promise.resolve([warned]))
    const queue = vi.fn(() => Promise.resolve())
    const due = await claimSilenceNotices(
      { silence: { claimWarnings }, notices: { queue }, owner: true, failed: vi.fn() },
      NIGHT,
    )
    expect(due).toEqual({ notices: [] })
    expect(claimWarnings).not.toHaveBeenCalled()
    expect(queue).not.toHaveBeenCalled()
  })

  it('уведомление владельцу не встало в очередь — предупреждения всё равно уходят, сбой назван', async () => {
    const failure = new Error('owner_notices down')
    const failed = vi.fn()
    const due = await claimSilenceNotices(
      {
        silence: { claimWarnings: () => Promise.resolve([warned]) },
        notices: { queue: () => Promise.reject(failure) },
        owner: true,
        failed,
      },
      NOON,
    )
    expect(due).toEqual({ notices: [{ telegramUserId: 4242, day: '2027-10-26', days: 30 }] })
    expect(failed).toHaveBeenCalledWith(failure)
  })

  it('без владельца в окружении — ничего не ставит в очередь', async () => {
    const queue = vi.fn(() => Promise.resolve())
    await claimSilenceNotices(
      {
        silence: { claimWarnings: () => Promise.resolve([warned]) },
        notices: { queue },
        owner: false,
        failed: vi.fn(),
      },
      NOON,
    )
    expect(queue).not.toHaveBeenCalled()
  })
})

describe('eraseSilent (MOL-239, Р-8)', () => {
  const report = (found: boolean): ErasureReport => ({
    found,
    erased: {} as ErasureReport['erased'],
    itemsReleased: 0,
    barcodesReleased: 0,
    memoryReleased: 0,
    counted: found,
  })

  it('сбой одного — назван, остальные стёрты; вход под замком — не стёрт и не посчитан', async () => {
    const failure = new Error('deadlock')
    const failed = vi.fn()
    const queue = vi.fn(() => Promise.resolve())
    const erase = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(report(false))
      .mockResolvedValueOnce(report(true))
    const result = await eraseSilent(
      {
        silence: {
          due: () =>
            Promise.resolve([
              { telegramUserId: 1, blocked: false },
              { telegramUserId: 2, blocked: true },
              { telegramUserId: 3, blocked: true },
            ]),
        },
        erasure: { erase },
        notices: { queue },
        owner: true,
        failed,
      },
      NOON,
    )
    expect(result).toEqual({ erased: 1, erasedBlocked: 1 })
    expect(failed).toHaveBeenCalledWith(failure)
    expect(erase).toHaveBeenCalledWith(3, { dryRun: false, silentAt: NOON })
    expect(queue).toHaveBeenCalledWith(
      { kind: 'silence', warned30: 0, warned7: 0, erased: 1, erasedBlocked: 1 },
      NOON,
    )
  })

  it('никого не стёрто — владельцу ничего', async () => {
    const queue = vi.fn(() => Promise.resolve())
    await eraseSilent(
      {
        silence: { due: () => Promise.resolve([]) },
        erasure: { erase: vi.fn() },
        notices: { queue },
        owner: true,
        failed: vi.fn(),
      },
      NOON,
    )
    expect(queue).not.toHaveBeenCalled()
  })
})
