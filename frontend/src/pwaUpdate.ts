import type { RegisterSWOptions } from 'vite-plugin-pwa/types'

type Register = (options: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>

/**
 * An installed app takes a new version the moment it is put away, and looks for one whenever it
 * is looked at again (MOL-46, owner's decision).
 *
 * The client reads the server's answers strictly, so an old page against a new API fails — the
 * search did, the day `near` was added. And nothing reloaded that page: a new service worker was
 * installed, but an iOS app frozen in the background comes back on the old code, with no
 * navigation to pick the new one up, until it is started cold.
 *
 * Not the moment the new version is found: a reload then takes away whatever is being typed at the
 * shelf. When the app is hidden instead — which is when iOS itself may unload it, and everything
 * that must survive is already written down for that (the queue, the drafts). The new worker waits
 * until then (`registerType: 'prompt'`), so the old page keeps being served its own files: taking
 * control at once, as `autoUpdate` does, leaves it asking for chunks the new precache no longer
 * holds.
 */
export function installPwaUpdate(register: Register): void {
  let waiting = false
  let registration: ServiceWorkerRegistration | undefined

  const update = register({
    immediate: true,
    onNeedRefresh() {
      waiting = true
      if (document.visibilityState === 'hidden') apply()
    },
    onRegisteredSW(_url, found) {
      registration = found
    },
  })

  function apply(): void {
    if (!waiting) return
    waiting = false
    void update(true)
  }

  // A check fails offline and says nothing worth hearing: the next return asks again.
  function check(): void {
    registration?.update().catch(() => undefined)
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') apply()
    else check()
  })
  window.addEventListener('online', check)
}
