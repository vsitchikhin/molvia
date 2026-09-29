import { inject, readonly, shallowRef, type InjectionKey, type Ref } from 'vue'
import { UNNAMED_BUILD } from '@molvia/model'

/**
 * What a new version of the app waits for, and what the page needs to be told about the world.
 * The browser's own in production; a test's by hand.
 */
export interface PwaEnvironment {
  readonly serviceWorker: ServiceWorkerContainer
  /** The worker the build emits, and where it serves. */
  readonly script: string
  readonly scope: string
  /** Something typed lives in memory only — see `holdsTyping`. */
  holdsTyping(): boolean
  reload(): void
  /**
   * A note that outlives the reload «Обновить» asks for, so the page it brings can tell whether
   * the version was taken: `mark` writes the moment, `takeMark` reads it and clears it.
   */
  mark(at: number): void
  takeMark(): number | null
  now(): number
}

/**
 * Where a new version stands, as the page shows it (MOL-132): `none` — nothing to take; `ready` —
 * one waits, and «Обновить» takes it; `applying` — let in, the reload is on its way; `failed` — it
 * did not take, and only closing the app all the way will.
 */
export type UpdatePhase = 'none' | 'ready' | 'applying' | 'failed'

export interface PwaUpdate {
  readonly phase: Readonly<Ref<UpdatePhase>>
  /** «Обновить»: the person asked for the version, on a page they are looking at. */
  apply(): void
  /** The build an answer of the API named (`VERSION_HEADER`). */
  serverVersion(version: string): void
}

/** How often a page on the screen looks for a new version by itself (Р-1). */
export const CHECK_EVERY_MS = 15 * 60 * 1000
/** How long a version let in by «Обновить» has to take over before it is called a failure. */
export const APPLY_TIMEOUT_MS = 10 * 1000
/** A note older than this is not about the reload that just happened. */
const MARK_LIFETIME_MS = 60 * 1000

/** Provided by the app once the worker is registered; read by the band and the error state. */
export const pwaUpdateKey: InjectionKey<PwaUpdate> = Symbol('pwa-update')

/** What a page with no worker has: the development server, the tests, a browser without one. */
export const NO_UPDATE: PwaUpdate = {
  phase: readonly(shallowRef<UpdatePhase>('none')),
  apply: () => undefined,
  serverVersion: () => undefined,
}

export function usePwaUpdate(): PwaUpdate {
  return inject(pwaUpdateKey, NO_UPDATE)
}

/**
 * Whether the page holds typing that lives in memory only, which a reload would take away: a sheet
 * up — what is typed there is written nowhere until its main action, the price of a purchase, a
 * proposed item, an exchange. Everything else typed keeps a draft on the device and comes back:
 * the settings, the ratings, and the search on «Что взяли?» with its miss (`searchDraft.ts`). Not
 * held against the update, the search: a typed query kept out the version that fixes a search the
 * old code could no longer read (adversarial review Ж2).
 */
export function holdsTyping(page: Document): boolean {
  return page.querySelector('dialog[open]') !== null
}

/**
 * An installed app takes a new version only when nobody can lose anything to it: hidden, holding
 * no typing — and looks for one whenever it is looked at again or the network is back (MOL-46,
 * owner's decision).
 *
 * The client reads the server's answers strictly, so an old page against a new API fails — the
 * search did, the day `near` was added — and nothing reloaded that page: an iOS app frozen in the
 * background came back on the old code until a cold start.
 *
 * The plugin's own `registerSW` is not used. In `prompt` mode it reloads the page the moment the
 * new worker takes control, whoever let it: another window of the app put away, or this one
 * brought back before the worker activated — a visible page reloaded under the finger (adversarial
 * review Г). And hidden is not enough by itself: at the shelf the phone is put away mid-sheet for
 * the calculator or the bank (`holdsTyping`).
 * So the new worker is let in, and the page reloaded after it took over, only while the app is
 * hidden and holds no typing; a takeover that came some other way waits for that moment. The worker waits too (`registerType: 'prompt'`):
 * taking control at once, as `autoUpdate` does, leaves the old page on a precache that is no
 * longer its own.
 *
 * **A page that stays on the screen takes its version by the person's hand** (MOL-132): one that
 * never goes to the background never reaches that moment, and a server rolled out under it answers
 * in a shape the old code refuses. So a new version is also looked for every quarter of an hour
 * while the app is looked at, and at once when an answer names another build than the last; while
 * one waits, the page offers «Обновить» (`phase`), and that — consent, on a page looked at — lets
 * the worker in and reloads when it takes over. It never reloads without it: a version that did not
 * take over in ten seconds, or still waits after the reload, is `failed`, and the words ask for the
 * app to be closed all the way. Nothing is cleared for it: the queue of purchases lives there.
 */
export function installPwaUpdate(environment: PwaEnvironment): PwaUpdate {
  const { serviceWorker } = environment
  const phase = shallowRef<UpdatePhase>('none')
  let registration: ServiceWorkerRegistration | undefined
  // A first install takes control of nothing it replaces: no reload is owed for it.
  let owed = false
  const controlled = serviceWorker.controller !== null
  let build: string | undefined
  let looking: ReturnType<typeof setInterval> | undefined
  let giveUp: ReturnType<typeof setTimeout> | undefined

  serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) return
    owed = true
    if (phase.value === 'applying') {
      clearTimeout(giveUp)
      reload()
      return
    }
    // Taken over after all, past the ten seconds: «close the app» is no longer true, and a reload
    // is all that is left — offered again, never done under the finger.
    if (phase.value === 'failed') phase.value = 'none'
    refresh()
    settle()
  })

  function quiet(): boolean {
    return document.visibilityState === 'hidden' && !environment.holdsTyping()
  }

  function reload(): void {
    environment.mark(environment.now())
    environment.reload()
  }

  /**
   * Whether a version waits: a worker installed behind the one this page runs on, or one already
   * let in by another window while this page still runs the old code (`owed`). A page nothing
   * controls runs what it fetched and has nothing to take.
   */
  function refresh(): void {
    if (phase.value === 'applying' || phase.value === 'failed') return
    const waits = owed || (controlled && Boolean(registration?.waiting))
    phase.value = waits ? 'ready' : 'none'
  }

  function settle(): void {
    if (!quiet()) return
    if (owed) {
      owed = false
      environment.reload()
      return
    }
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' })
  }

  // A check fails offline and says nothing worth hearing: the next return asks again.
  function check(): void {
    registration?.update().catch(() => undefined)
  }

  // While the app is looked at, and only then: a page on the table all day never goes to the
  // background, and nothing else would look (MOL-132). Offline the look would only fail.
  function watch(): void {
    clearInterval(looking)
    looking = undefined
    if (document.visibilityState !== 'visible') return
    looking = setInterval(() => {
      if (navigator.onLine) check()
    }, CHECK_EVERY_MS)
  }

  function apply(): void {
    if (phase.value !== 'ready') return
    phase.value = 'applying'
    // Let in already — by another window: this page only has to come up on it.
    if (owed) {
      reload()
      return
    }
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' })
    giveUp = setTimeout(() => {
      phase.value = 'failed'
    }, APPLY_TIMEOUT_MS)
  }

  function serverVersion(version: string): void {
    if (version === UNNAMED_BUILD) return
    if (build !== undefined && build !== version) check()
    build = version
  }

  serviceWorker
    .register(environment.script, { scope: environment.scope })
    .then((found) => {
      registration = found
      // A worker installed while the page was not looking waits for the same moment.
      found.addEventListener('updatefound', () => {
        found.installing?.addEventListener('statechange', () => {
          refresh()
          settle()
        })
      })
      // Brought up by «Обновить», and a version still waits: it was never taken (Т-7).
      const marked = environment.takeMark()
      const retried = marked !== null && environment.now() - marked < MARK_LIFETIME_MS
      if (retried && controlled && found.waiting) phase.value = 'failed'
      refresh()
      settle()
    })
    .catch((error: unknown) => {
      console.error('[molvia]', 'service worker', error)
    })

  document.addEventListener('visibilitychange', () => {
    watch()
    if (document.visibilityState === 'hidden') settle()
    else check()
  })
  window.addEventListener('online', check)
  watch()

  return { phase: readonly(phase), apply, serverVersion }
}
