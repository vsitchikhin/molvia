import { nextTick } from 'vue'
import type { RouteLocation, RouteLocationNormalized, Router } from 'vue-router'

/**
 * Which way a move goes, read from the routes alone: into a nested screen is a push, out of
 * it a pop — whether by the chevron, the system button or a swipe — and between sections a
 * cross-fade. The first render and a redirect have no direction and are not animated.
 */
export type Direction = 'push' | 'pop' | 'tab'

type Place = Pick<RouteLocation, 'matched' | 'fullPath' | 'meta' | 'name'>

export function direction(from: Place, to: Place): Direction | null {
  if (from.matched.length === 0 || from.fullPath === to.fullPath) return null
  if (to.meta.parent && to.meta.parent === from.name) return 'push'
  if (from.meta.parent && from.meta.parent === to.name) return 'pop'
  if (from.meta.tab && to.meta.tab) return 'tab'
  return null
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Moves are animated with the View Transitions API rather than `<Transition>`: the page is what
 * scrolls, and two screens held in the DOM side by side for 220 ms would each carry their own
 * scroll and jump. A view transition animates a snapshot of the old screen instead.
 *
 * Where the API is missing, or motion is reduced, the move simply happens. The direction rides
 * on `<html data-nav>` for the length of the transition — main.scss picks the animation by it.
 */
/**
 * A swipe from the edge on iOS and predictive back on Android already show the page leaving;
 * sliding it out again on top would play the move twice. The browser says so on the event.
 * This listens to the history, not to a gesture: nothing is taken from the browser.
 *
 * **It must be listening before the router is.** A real `popstate` runs the microtasks after
 * each listener, so the router's whole guard chain — `beforeResolve` included — finishes before
 * a listener registered after it is called. Registered later, the flag was read as «no» and the
 * pop animated anyway, and then set to «yes» for the next move, whose animation it swallowed.
 * `capture` does not help: on `window` listeners run in the order they were added. So
 * `router.ts` calls this right before it creates the web history.
 */
let animatedByBrowser = false

export function watchBrowserAnimatedBack(): void {
  window.addEventListener('popstate', (event) => {
    // Undefined where the browser does not report it — read as «not animated», which is right.
    animatedByBrowser = event.hasUAVisualTransition
  })
}

export function installViewTransitions(router: Router): void {
  const waiting: (() => void)[] = []
  let current: ViewTransition | undefined

  router.beforeResolve((to, from) => {
    const byBrowser = animatedByBrowser
    animatedByBrowser = false
    const move = direction(from, to)
    if (!move || byBrowser) return
    if (typeof document.startViewTransition !== 'function' || reducedMotion()) return

    const root = document.documentElement
    return new Promise<void>((proceed) => {
      root.dataset.nav = move
      const transition = document.startViewTransition(
        () =>
          new Promise<void>((done) => {
            waiting.push(done)
            // The old screen is captured; the router may now swap it for the new one.
            proceed()
          }),
      )
      current = transition
      // A transition cut short by the next one rejects `ready`; that is the platform's way of
      // saying «skipped», not an error of ours.
      transition.ready.catch(() => undefined)
      void transition.finished.finally(() => {
        // A skipped transition finishes at once — it must not take the direction away from the
        // one that replaced it and is still running.
        if (current !== transition) return
        current = undefined
        delete root.dataset.nav
      })
    })
  })

  // Runs for a failed or cancelled move too, so a transition never waits forever.
  router.afterEach(async () => {
    // Whatever move the flag was raised for is over; it must not reach the next one.
    animatedByBrowser = false
    if (waiting.length === 0) return
    const done = waiting.splice(0)
    await nextTick()
    for (const release of done) release()
  })
}

/**
 * Focus on the screen's own heading, where a screen reader starts reading it. For whatever just
 * took the focused control away: a move to another screen, or a «Try again» that swaps its
 * state for a skeleton — left alone, the focus falls to <body> and the page is read from the top.
 */
export function focusScreenTitle(): void {
  document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
}

/**
 * What a person who cannot see the screen needs after a move: the tab's title names the screen
 * (and the Android task switcher shows it), and focus lands on the new heading instead of
 * staying on a button that has just disappeared. Not on the first render — nothing moved yet.
 *
 * Nor when the address stayed the same. The router calls every `popstate` a move, and a sheet
 * closed by «back» is one: the screen did not change, the button that opened the sheet is still
 * there, and `<dialog>` has just handed focus back to it — taking it to the heading would drop a
 * screen-reader user at the top of the page (MOL-18).
 */
export function installArrival(router: Router, t: (key: string) => string): void {
  const name = (to: RouteLocationNormalized): string => `${t(to.meta.titleKey)} · ${t('app.name')}`

  document.title = name(router.currentRoute.value)
  router.afterEach(async (to, from, failure) => {
    if (failure || to.fullPath === from.fullPath) return
    document.title = name(to)
    if (from.matched.length === 0) return
    await nextTick()
    focusScreenTitle()
  })
}
