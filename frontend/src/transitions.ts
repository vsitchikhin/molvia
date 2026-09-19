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
export function installViewTransitions(router: Router): void {
  let settled: (() => void) | undefined

  router.beforeResolve((to, from) => {
    const move = direction(from, to)
    if (!move || typeof document.startViewTransition !== 'function' || reducedMotion()) return

    const root = document.documentElement
    return new Promise<void>((proceed) => {
      root.dataset.nav = move
      const transition = document.startViewTransition(
        () =>
          new Promise<void>((done) => {
            settled = done
            // The old screen is captured; the router may now swap it for the new one.
            proceed()
          }),
      )
      void transition.finished.finally(() => {
        delete root.dataset.nav
      })
    })
  })

  // Runs for a failed or cancelled move too, so a transition never waits forever.
  router.afterEach(async () => {
    const done = settled
    settled = undefined
    if (!done) return
    await nextTick()
    done()
  })
}

/**
 * What a person who cannot see the screen needs after a move: the tab's title names the screen
 * (and the Android task switcher shows it), and focus lands on the new heading instead of
 * staying on a button that has just disappeared. Not on the first render — nothing moved yet.
 */
export function installArrival(router: Router, t: (key: string) => string): void {
  const name = (to: RouteLocationNormalized): string => `${t(to.meta.titleKey)} · ${t('app.name')}`

  document.title = name(router.currentRoute.value)
  router.afterEach(async (to, from, failure) => {
    if (failure) return
    document.title = name(to)
    if (from.matched.length === 0) return
    await nextTick()
    document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
  })
}
