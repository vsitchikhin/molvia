/**
 * What a new version of the app waits for, and what the page needs to be told about the world.
 * The browser's own in production; a test's by hand.
 */
export interface PwaEnvironment {
  readonly serviceWorker: ServiceWorkerContainer
  /** The worker the build emits, and where it serves. */
  readonly script: string
  readonly scope: string
  /** A sheet is up: whatever is typed in it lives in memory only. */
  sheetOpen(): boolean
  reload(): void
}

/**
 * An installed app takes a new version only when nobody can lose anything to it: hidden, with no
 * sheet up — and looks for one whenever it is looked at again or the network is back (MOL-46,
 * owner's decision).
 *
 * The client reads the server's answers strictly, so an old page against a new API fails — the
 * search did, the day `near` was added — and nothing reloaded that page: an iOS app frozen in the
 * background came back on the old code until a cold start.
 *
 * The plugin's own `registerSW` is not used. In `prompt` mode it reloads the page the moment the
 * new worker takes control, whoever let it: another window of the app put away, or this one
 * brought back before the worker activated — a visible page reloaded under the finger (adversarial
 * review Г). And hidden is not enough by itself: a sheet keeps what is typed in memory until its
 * main action — the price of a purchase, a proposed item, an exchange — and the phone is put away
 * mid-sheet at the shelf for the calculator or the bank. So the new worker is let in, and the page
 * reloaded after it took over, only while the app is hidden with no sheet up; a takeover that
 * came some other way waits for that moment. The worker waits too (`registerType: 'prompt'`):
 * taking control at once, as `autoUpdate` does, leaves the old page on a precache that is no
 * longer its own.
 */
export function installPwaUpdate(environment: PwaEnvironment): void {
  const { serviceWorker } = environment
  let registration: ServiceWorkerRegistration | undefined
  // A first install takes control of nothing it replaces: no reload is owed for it.
  let owed = false
  const controlled = serviceWorker.controller !== null

  serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) return
    owed = true
    settle()
  })

  function quiet(): boolean {
    return document.visibilityState === 'hidden' && !environment.sheetOpen()
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

  serviceWorker
    .register(environment.script, { scope: environment.scope })
    .then((found) => {
      registration = found
      // A worker installed while the page was not looking waits for the same moment.
      found.addEventListener('updatefound', () => {
        found.installing?.addEventListener('statechange', settle)
      })
      settle()
    })
    .catch((error: unknown) => {
      console.error('[molvia]', 'service worker', error)
    })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') settle()
    else check()
  })
  window.addEventListener('online', check)
}
