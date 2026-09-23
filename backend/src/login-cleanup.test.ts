import { afterEach, expect, it, vi } from 'vitest'
import { startLoginCleanup } from './login-cleanup'

afterEach(() => vi.useRealTimers())

it('cleans at boot, skips overlaps, reports failure and stops with the server', async () => {
  vi.useFakeTimers()
  let finish: (() => void) | undefined
  const clean = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const failed = vi.fn()
  const stop = startLoginCleanup(clean, failed)
  expect(clean).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(120_000)
  expect(clean).toHaveBeenCalledTimes(1)
  finish?.()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(clean).toHaveBeenCalledTimes(2)
  finish?.()
  await stop()
  await vi.advanceTimersByTimeAsync(120_000)
  expect(clean).toHaveBeenCalledTimes(2)
  expect(failed).not.toHaveBeenCalled()
})

it('retries a failed cleanup at the next minute without an unhandled rejection', async () => {
  vi.useFakeTimers()
  const failed = vi.fn()
  const clean = vi.fn(() => Promise.reject(new Error('database down')))
  const stop = startLoginCleanup(clean, failed)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(clean).toHaveBeenCalledTimes(2)
  expect(failed).toHaveBeenCalledTimes(2)
  await stop()
})
