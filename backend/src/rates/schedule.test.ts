import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REFRESH_EVERY_MS, startSchedule } from './schedule'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('расписание обновления курсов', () => {
  it('запускает сразу при старте и потом раз в час', async () => {
    const run = vi.fn(() => Promise.resolve())
    const stop = startSchedule(run)

    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS - 1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
    stop()
  })

  it('не запускает второй прогон, пока первый ещё идёт', async () => {
    let finish: () => void = () => undefined
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const stop = startSchedule(run, 1000)

    await vi.advanceTimersByTimeAsync(3000)
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
    stop()
  })

  it('после остановки больше не запускает', async () => {
    const run = vi.fn(() => Promise.resolve())
    const stop = startSchedule(run, 1000)
    stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
