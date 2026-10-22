import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import page, { pageTimers } from './page-environment'

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

  it('clears a timer that ran and was set going again by refresh() (adversarial А2)', async () => {
    const { window } = host()
    const timers = pageTimers(window)
    const ran = vi.fn()
    const timer = window.setTimeout(ran, 0) as unknown as { refresh: () => unknown }
    await wait(20)
    expect(ran).toHaveBeenCalledOnce()

    timer.refresh()
    timers.close()
    await wait(20)
    expect(ran).toHaveBeenCalledOnce()
  })

  it('clears again at the close what was set after a clear, the functions kept between (adversarial А1)', async () => {
    const { window } = host()
    const timers = pageTimers(window)
    const ran = vi.fn()
    window.setTimeout(ran, 0)

    timers.clear()
    expect(window.setTimeout).not.toBe(setTimeout)
    window.setTimeout(ran, 0)
    timers.close()
    await wait(20)
    expect(ran).not.toHaveBeenCalled()
  })
})

describe('the page environment (MOL-286)', () => {
  // Set up over a global object of its own, beside the one this file runs in. Taking happy-dom down
  // aborts a request still in the air, and the page's handler of the failure sets a timer while the
  // window is still there: cleared only before that, it ran after the window was gone.
  it('clears a timer the page sets while its window is taken down (adversarial А1)', async () => {
    // A server that takes the request and never answers. The test waits for it to arrive: happy-dom
    // aborts no request still on its way, and its teardown then waits for it for ever.
    let arrived = (): void => undefined
    const reached = new Promise<void>((resolve) => (arrived = resolve))
    const server = createServer(() => {
      arrived()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const global = { setTimeout, setInterval, clearTimeout, clearInterval, console }
    const window = await page.setup(global, {})
    const ran = vi.fn()
    const asked = (global as unknown as { fetch: typeof fetch }).fetch(
      `http://127.0.0.1:${String(port)}/`,
    )
    const failed = asked.catch(() => {
      global.setTimeout(ran, 0)
    })

    await reached
    await window.teardown(global)
    await failed
    await wait(20)
    server.close()
    expect(ran).not.toHaveBeenCalled()
    expect(global.setTimeout).toBe(setTimeout)
  })

  // vitest names the environment it set up in the state of `expect`: `'happy-dom'` put back in the
  // config, or `--environment` on the command line, and this is red.
  it('is the environment of this file, from the config', () => {
    expect(expect.getState().environment).toBe('page')
  })

  // A file may name its own environment past the config, and a name is all it can give: vitest reads
  // the first `@vitest-environment` or `@jest-environment` in the file by this very pattern, and a
  // path does not fit it. Any DOM by name brings Node's timers back, so only `node` passes.
  it('is named past in no test file but for `node`', () => {
    const files = import.meta.glob<string>(['/**/*.test.ts', '!/node_modules/**'], {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const named = Object.entries(files)
      .map(([file, code]) => [file, /@(?:vitest|jest)-environment\s+([\w-]+)\b/.exec(code)?.[1]])
      .filter(([, name]) => name !== undefined && name !== 'node')
    expect(Object.keys(files).length).toBeGreaterThan(100)
    expect(named).toEqual([])
  })
})
