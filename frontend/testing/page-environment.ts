import { builtinEnvironments } from 'vitest/runtime'
import type { Environment } from 'vitest/runtime'

type Timers = Pick<
  typeof globalThis,
  'setTimeout' | 'setInterval' | 'clearTimeout' | 'clearInterval'
>
/** The timer functions as called here: the DOM's and Node's overloads meet, and a handle is opaque. */
type Start = (handler: TimerHandler, delay?: number, ...args: unknown[]) => unknown
type Stop = (timer?: unknown) => void

/**
 * Keeps the timers set through `target` until `close()`, which clears every one still pending and
 * gives `target` its own functions back. A timer that ran once, or was cleared, is let go of then.
 */
export function pageTimers(target: Timers): { close: () => void } {
  const given: Timers = {
    setTimeout: target.setTimeout,
    setInterval: target.setInterval,
    clearTimeout: target.clearTimeout,
    clearInterval: target.clearInterval,
  }
  const start = given.setTimeout as Start
  const repeat = given.setInterval as Start
  const stop = given.clearTimeout as Stop
  const stopRepeat = given.clearInterval as Stop
  const pending = new Set<unknown>()

  const setTimeout: Start = (handler, delay, ...args) => {
    if (typeof handler !== 'function') return start(handler, delay, ...args)
    const run = handler as (...passed: unknown[]) => unknown
    const timer = start(
      (...passed: unknown[]) => {
        pending.delete(timer)
        run(...passed)
      },
      delay,
      ...args,
    )
    pending.add(timer)
    return timer
  }
  const setInterval: Start = (handler, delay, ...args) => {
    const timer = repeat(handler, delay, ...args)
    pending.add(timer)
    return timer
  }
  // Either clears either kind, in a browser and in Node alike.
  const clearTimeout: Stop = (timer) => {
    pending.delete(timer)
    stop(timer)
  }
  const clearInterval: Stop = (timer) => {
    pending.delete(timer)
    stopRepeat(timer)
  }
  Object.assign(target, { setTimeout, setInterval, clearTimeout, clearInterval })

  return {
    close() {
      for (const timer of pending) stop(timer)
      pending.clear()
      Object.assign(target, given)
    },
  }
}

const happyDom = builtinEnvironments['happy-dom']

/**
 * happy-dom whose timers go with its window, as a tab's do (MOL-286). vitest makes `window` the global
 * object and leaves Node's own `setTimeout` in it, so a timer the page set outlived the window it was
 * set for: a step back's guard (`stepBack`, a second) fired after the file was taken down, in a worker
 * a busy runner had not stopped yet — `window is not defined`, the run red with every test green.
 */
export default {
  name: 'page',
  viteEnvironment: 'client',
  async setup(global, options) {
    const page = await happyDom.setup(global, options)
    const timers = pageTimers(globalThis)
    return {
      async teardown(taken) {
        timers.close()
        await page.teardown(taken)
      },
    }
  },
} satisfies Environment
