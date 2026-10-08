import type { Page } from '@playwright/test'

/**
 * Stands in for the iOS keyboard, which no Playwright browser has: the visual viewport is replaced
 * before the app loads, and `keyboard(covered, pan)` moves it — the keys cover the bottom `covered`
 * px of the window, and the visible part is said to be `pan` px down it, as Safari says it on the
 * owner's iPhone (304 for keys of 304, MOL-135) while what a page draws stays where it was. Not all
 * of what Safari was measured doing: it also shrinks the window to the visible part and leaves
 * `dvh`, which a Chromium window cannot, since its `dvh` shrinks along. The same faults show in
 * this geometry: a sheet sized from `dvh` is taller than what is visible, and a lift less the
 * reported scroll leaves it under the keys (MOL-151). The measured numbers are held by
 * `useKeyboardInset.test`.
 */
export async function fakeKeyboard(
  page: Page,
): Promise<(covered: number, pan: number) => Promise<void>> {
  await page.addInitScript(() => {
    const events = new EventTarget()
    const state = { covered: 0, pan: 0 }
    const viewport = {
      get height() {
        return window.innerHeight - state.covered
      },
      get width() {
        return window.innerWidth
      },
      get offsetTop() {
        return state.pan
      },
      get pageTop() {
        return window.scrollY + state.pan
      },
      offsetLeft: 0,
      pageLeft: 0,
      scale: 1,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    }
    Object.defineProperty(window, 'visualViewport', { get: () => viewport, configurable: true })
    Object.assign(window, {
      keyboard(covered: number, pan: number) {
        state.covered = covered
        state.pan = pan
        events.dispatchEvent(new Event('resize'))
        events.dispatchEvent(new Event('scroll'))
      },
    })
  })
  return async (covered, pan) => {
    await page.evaluate(
      ({ c, p }) => {
        ;(window as unknown as { keyboard: (c: number, p: number) => void }).keyboard(c, p)
      },
      { c: covered, p: pan },
    )
  }
}
