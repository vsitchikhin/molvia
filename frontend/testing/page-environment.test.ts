import { describe, expect, it, vi } from 'vitest'
import { pageTimers } from './page-environment'

/** A window of its own: the timers of the process, under the window's names, and what reached them. */
function host() {
  const cleared = vi.fn((timer?: Parameters<typeof clearTimeout>[0]) => {
    clearTimeout(timer)
  })
  return {
    cleared,
    window: { setTimeout, setInterval, clearTimeout: cleared, clearInterval: cleared },
  }
}

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

describe('pageTimers — the timers go with the window (MOL-286)', () => {
  it('runs nothing still pending once the window is closed: a timeout or an interval', async () => {
    const { window } = host()
    const timers = pageTimers(window)
    const ran = vi.fn()
    window.setTimeout(ran, 20)
    window.setInterval(ran, 10)

    timers.close()
    await wait(80)
    expect(ran).not.toHaveBeenCalled()
  })

  it('runs a timer as it was set while the window is open, its arguments with it', async () => {
    const { window } = host()
    const timers = pageTimers(window)
    const ran = vi.fn()
    window.setTimeout(ran, 0, 'a', 2)

    await wait(20)
    expect(ran).toHaveBeenCalledExactlyOnceWith('a', 2)
    timers.close()
  })

  it('clears at the close only what is still pending: a timer that ran or was cleared is let go of', async () => {
    const { window, cleared } = host()
    const timers = pageTimers(window)
    window.setTimeout(() => undefined, 0)
    await wait(20)
    window.clearTimeout(window.setTimeout(() => undefined, 1000))
    window.clearInterval(window.setInterval(() => undefined, 1000))
    const left = window.setTimeout(() => undefined, 1000)
    cleared.mockClear()

    timers.close()
    expect(cleared.mock.calls).toEqual([[left]])
  })

  it('gives the window its own functions back', () => {
    const { window, cleared } = host()
    const timers = pageTimers(window)
    expect(window.setTimeout).not.toBe(setTimeout)

    timers.close()
    expect(window).toEqual({
      setTimeout,
      setInterval,
      clearTimeout: cleared,
      clearInterval: cleared,
    })
  })
})
