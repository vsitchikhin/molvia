import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REFRESH_EVERY_MS, refreshAtBoot, startSchedule } from './schedule'

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
    const stop = startSchedule(run, { everyMs: 1000 })

    await vi.advanceTimersByTimeAsync(3000)
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
    stop()
  })

  it('после остановки больше не запускает', async () => {
    const run = vi.fn(() => Promise.resolve())
    const stop = startSchedule(run, { everyMs: 1000 })
    stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('обновление при старте', () => {
  const now = new Date('2026-09-19T12:00:00.000Z')
  const ago = (ms: number) => new Date(now.getTime() - ms)

  it('пустой кеш или запись час назад и раньше — обновить сразу', () => {
    expect(refreshAtBoot(null, now)).toBe(true)
    expect(refreshAtBoot(ago(REFRESH_EVERY_MS), now)).toBe(true)
  })

  it('кеш записан меньше часа назад — перезапуск `make dev` в ЦБ РА не идёт', () => {
    expect(refreshAtBoot(ago(REFRESH_EVERY_MS - 1), now)).toBe(false)
    expect(refreshAtBoot(ago(0), now)).toBe(false)
  })

  it('без немедленного прогона — первый по расписанию, через период', async () => {
    const run = vi.fn(() => Promise.resolve())
    const stop = startSchedule(run, { everyMs: 1000, immediately: false })

    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(1)
    stop()
  })
})
