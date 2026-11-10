import { describe, expect, it, vi } from 'vitest'
import type { ErasureReport, ErasureRepository } from '@/db/erasure-repository'
import { DOOR_SWEEP_ITEMS, eraseMe } from './erase-me'

const report = (leavingItems: readonly string[]): ErasureReport => ({
  found: true,
  erased: {} as ErasureReport['erased'],
  itemsLeaving: leavingItems.length,
  leavingItems,
  itemsReleased: 0,
  barcodesReleased: 0,
  memoryReleased: 0,
  counted: true,
})

describe('eraseMe (MOL-374, review 3, №11, №12)', () => {
  it('стирает, потом убирает только товары этого стирания', async () => {
    const erasure = {
      erase: vi.fn<ErasureRepository['erase']>(() => Promise.resolve(report(['a', 'b']))),
      sweepReleased: vi.fn<ErasureRepository['sweepReleased']>(() => Promise.resolve(2)),
    }
    const failed = vi.fn()

    await eraseMe(erasure, 184467331, failed)

    expect(erasure.erase).toHaveBeenCalledWith(184467331, { dryRun: false })
    expect(erasure.sweepReleased).toHaveBeenCalledWith(['a', 'b'])
    expect(failed).not.toHaveBeenCalled()
  })

  // Adversarial Р5-А16: the bot waits 5 s, and 32 767 items took the door 6.6 s.
  it('до ответа убирает не больше DOOR_SWEEP_ITEMS, остальное — минутному таймеру', async () => {
    const ids = Array.from({ length: DOOR_SWEEP_ITEMS + 1 }, (_, n) => String(n))
    const erasure = {
      erase: vi.fn<ErasureRepository['erase']>(() => Promise.resolve(report(ids))),
      sweepReleased: vi.fn<ErasureRepository['sweepReleased']>(() =>
        Promise.resolve(DOOR_SWEEP_ITEMS),
      ),
    }

    await eraseMe(erasure, 184467331, vi.fn())

    expect(erasure.sweepReleased).toHaveBeenCalledWith(ids.slice(0, DOOR_SWEEP_ITEMS))
  })

  it('сбой уборки отдаёт колбэку и не валит стирание', async () => {
    const broken = new Error('sweep')
    const erasure = {
      erase: vi.fn<ErasureRepository['erase']>(() => Promise.resolve(report(['a']))),
      sweepReleased: vi.fn<ErasureRepository['sweepReleased']>(() => Promise.reject(broken)),
    }
    const failed = vi.fn()

    await expect(eraseMe(erasure, 184467331, failed)).resolves.toBeUndefined()
    expect(failed).toHaveBeenCalledWith(broken)
  })
})
