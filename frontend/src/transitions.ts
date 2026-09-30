import { nextTick } from 'vue'
import type { RouteLocation, RouteLocationNormalized, Router } from 'vue-router'

/**
 * Which way a move goes, read from the routes alone: into a nested screen is a push, out of
 * it a pop — whether by the chevron, the system button or a swipe — and between sections a
 * cross-fade. The first render and a redirect have no direction and are not animated.
 */
export type Direction = 'push' | 'pop' | 'tab'

type Place = Pick<RouteLocation, 'matched' | 'fullPath' | 'path' | 'meta' | 'name'> &
  Partial<Pick<RouteLocation, 'query'>>

/**
 * A move that leaves the path as it was is the screen's own state, not another screen: the same
 * address — a sheet put away — or only the query — the category and the period of «Графики», the
 * month of «Деньги», each by `replace` (MOL-136). It is not scrolled to the top, not animated, not
 * an arrival, and it does not move the control it was made with (MOL-138). The first navigation is
 * always another screen: it comes from `START_LOCATION`, at «/».
 */
export function sameScreen(
  from: Pick<RouteLocation, 'matched' | 'path'>,
  to: Pick<RouteLocation, 'path'>,
): boolean {
  return from.matched.length > 0 && from.path === to.path
}

/** The screen a route leads back to: its own parent, or one `?from=` names that it lists (MOL-82). */
function parentOf(place: Place): string | undefined {
  const from = place.query?.from
  if (typeof from === 'string' && place.meta.from?.some((name) => name === from)) return from
  return place.meta.parent
}

export function direction(from: Place, to: Place): Direction | null {
  if (from.matched.length === 0 || sameScreen(from, to)) return null
  const into = parentOf(to)
  const outOf = parentOf(from)
  if (into && into === from.name) return 'push'
  if (outOf && outOf === to.name) return 'pop'
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
 * screen-reader user at the top of the page (MOL-18). Nor when only the query changed: the arrow of
 * the month, the period, the category keep the focus, and the next Enter or arrow is theirs — taken
 * to the heading, the second tap on «‹» went into the title (MOL-136, adversarial Ф).
 */
export function installArrival(router: Router, t: (key: string) => string): void {
  const name = (to: RouteLocationNormalized): string => `${t(to.meta.titleKey)} · ${t('app.name')}`

  document.title = name(router.currentRoute.value)
  router.afterEach(async (to, from, failure) => {
    if (failure || to.fullPath === from.fullPath || sameScreen(from, to)) return
    document.title = name(to)
    if (from.matched.length === 0) return
    await nextTick()
    focusScreenTitle()
  })
}

/**
 * A change of the query leaves the control it was made with where it stood on the screen (MOL-138):
 * the arrow of the month, the period, the category stay under the thumb, whatever the screen redraws
 * around them.
 *
 * **Below them, the page is held as tall as the bottom of the window.** The new version of the screen
 * may be shorter — a month read for the first time comes under the skeleton, a category card loses a
 * line at the very end of the page — and the browser brings the scroll up to the new end in the very
 * layout that made it shorter; seen after the fact it is too late, a scroll put back is a jump there
 * and back. So the height is held before the router lets the screen redraw: as far as the bottom of
 * the window and no further, since more is empty room to scroll into. The hold is on `#app`, a
 * block: room under the screen, never the screen stretched (main.scss).
 *
 * **Above them, what went or came is made up by the scroll**, in the same frame, before it is painted:
 * a strip «Нет связи» over the month the phone kept, a card «Не удалось загрузить» over the charts, a
 * line of the card over the category chosen — each belonged to the answer on screen, and a month
 * read for the first time has none (adversarial Б). The control is the one the move was made with — the
 * target of the click or the change that made it, in the same task; a move made by the code, not
 * by a hand, has none and is only held.
 *
 * The hold goes when it no longer holds anything in view — the bottom of the window within the screen
 * again, at the next scroll — with a move to another screen, after the view transition has taken its
 * picture of the old one, and when the login closes the app (`releaseHeightHold`): that screen takes
 * the place of the router's without a move, and held, it was drawn scrolled off the window.
 */
let held = false
/** What was clicked or changed last, for as long as the task that did it runs. */
let used: Element | null = null
let noting = false

function note(event: Event): void {
  const target = event.target instanceof Element ? event.target : null
  used = target
  setTimeout(() => {
    if (used === target) used = null
  }, 0)
}

/** Where the screen ends without the hold: what flows in `#app`, not what floats over it. */
function contentBottom(): number {
  let bottom = 0
  for (const child of document.getElementById('app')?.children ?? []) {
    const { position } = getComputedStyle(child)
    if (position === 'fixed' || position === 'absolute') continue
    bottom = Math.max(bottom, child.getBoundingClientRect().bottom)
  }
  return Math.ceil(bottom + window.scrollY)
}

function settle(): void {
  if (window.scrollY + window.innerHeight <= contentBottom()) releaseHeightHold()
}

/** Holds the page at least as tall as `bottom`, the page's own coordinate. */
function holdTo(bottom: number): void {
  const now = Number.parseFloat(document.documentElement.style.getPropertyValue('--page-hold')) || 0
  const next = Math.max(now, Math.ceil(bottom))
  document.documentElement.style.setProperty('--page-hold', `${String(next)}px`)
  if (held) return
  held = true
  window.addEventListener('scroll', settle, { passive: true })
}

export function releaseHeightHold(): void {
  if (!held) return
  held = false
  document.documentElement.style.removeProperty('--page-hold')
  window.removeEventListener('scroll', settle)
}

/** Where on the screen the element stands, or null once it is gone or not drawn. */
function standing(element: Element | null): number | null {
  if (!element?.isConnected || element.getClientRects().length === 0) return null
  return element.getBoundingClientRect().top
}

export function installHeightHold(router: Router): void {
  if (!noting) {
    noting = true
    document.addEventListener('click', note, true)
    document.addEventListener('change', note, true)
  }
  let anchor: { element: Element; top: number } | null = null

  router.beforeEach((to, from) => {
    anchor = null
    if (to.fullPath === from.fullPath || !sameScreen(from, to)) return
    const top = standing(used)
    if (used && top !== null) anchor = { element: used, top }
    // Anew from where the window is now: the last hold is room under a screen no longer drawn.
    releaseHeightHold()
    holdTo(window.scrollY + window.innerHeight)
  })

  router.afterEach(async (to, from, failure) => {
    if (failure) return
    if (!sameScreen(from, to)) {
      releaseHeightHold()
      return
    }
    const kept = anchor
    anchor = null
    if (!kept) return
    await nextTick()
    const top = standing(kept.element)
    if (top === null) return
    const moved = top - kept.top
    if (Math.abs(moved) < 1) return
    holdTo(window.scrollY + moved + window.innerHeight)
    window.scrollBy({ top: moved, behavior: 'instant' })
  })
}
