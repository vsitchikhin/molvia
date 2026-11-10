import { describe, expect, it, vi } from 'vitest'
import type { ErasureReport, ErasureRepository } from '@/db/erasure-repository'
import { eraseMe } from './erase-me'

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
