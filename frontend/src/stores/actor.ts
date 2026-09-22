import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { ActorView } from '@molvia/model'
import { api } from '@/api'
import { IDENTITY_KEY, currentIdentity, isIdentifier, rememberIdentity } from '@/stores/identity'

/**
 * What the identity is doing, so a screen can show the right one of four states.
 *
 * Two of them have gone, each with the world it described. `uninvited` went with the invite
 * door (MOL-52). `lost` went with MOL-53: it meant «the data of this device is unreachable and
 * a new identity has been started», and neither half is true any more — a session is not the
 * data, and losing one is a reason to sign in again rather than to begin empty. MOL-56 brings
 * the state that replaces it, together with the screen that can act on it.
 */
export type IdentityState = 'idle' | 'loading' | 'ready' | 'offline' | 'error'

function isMissingActor(error: unknown): boolean {
  return error instanceof ApiError && error.code === ERROR.NO_ACTOR
}

/**
 * One tab signs in, the others wait and then simply ask again.
 *
 * Before MOL-53 this was an elaborate affair: the identity lived in storage, so two tabs
 * reading an empty one created two accounts and split a person's data in two, and the fallback
 * for browsers without `navigator.locks` kept a heartbeat claim in storage to narrow the race.
 * A cookie is one per origin and the browser owns it, so the second tab does not need to be
 * told what the first got — it re-asks the server and is recognised. What is left is a lock to
 * keep both from opening a session at once, and where there is no lock the cost is one extra
 * account in development, on the seam, in a browser older than Firefox 96.
 */
async function claiming<T>(run: () => Promise<T>): Promise<T> {
  // The DOM types promise `navigator.locks` is always there; Firefox before 96 and older
  // WebViews say otherwise, and a phone at a shelf is exactly where an old WebView turns up.
  const locks = (navigator as unknown as Record<string, unknown>).locks as LockManager | undefined
  return locks ? locks.request(IDENTITY_KEY, run) : run()
}

export const useActorStore = defineStore('actor', () => {
  const actor = ref<ActorView | null>(null)
  const id = ref<string | null>(currentIdentity())
  const state = ref<IdentityState>('idle')
  /** True while `start` is in flight, so a retry button cannot queue a second one. */
  let running = false

  function settle(loaded: ActorView): void {
    actor.value = loaded
    id.value = loaded.id
    // Written down because the app needs it **before** the server can be asked: at the shelf
    // with no signal the trip queue and the recent items are found by this key, and there is
    // nobody to ask who we are (MOL-53, Р-9). It is not a credential any more — nothing sends
    // it anywhere — it is the name of a drawer.
    rememberIdentity(loaded.id)
  }

  function fail(error: unknown): void {
    state.value = navigator.onLine ? 'error' : 'offline'
    console.error('[molvia] личность не поднялась', error)
  }

  /**
   * The development seam, and the branch exists only in a development build: `import.meta.env.DEV`
   * is a literal Vite folds, so the production bundle has no call to an address the production
   * server does not carry — the same shape the seam has on the server (MOL-52, Р-14).
   *
   * In production, until MOL-54, there is simply no way in, and the honest state for that is
   * `error`. MOL-56 replaces it with a screen that offers the Telegram login.
   */
  async function signIn(): Promise<void> {
    if (!import.meta.env.DEV) {
      state.value = 'error'
      return
    }

    try {
      settle(await api.devLogin())
      state.value = 'ready'
    } catch (error) {
      fail(error)
    }
  }

  /**
   * Under the lock, and it asks again before signing in: between requesting the lock and
   * getting it, another tab may have signed this browser in — and the cookie it got is already
   * ours, because cookies belong to the origin rather than to a tab.
   */
  async function askAgainOrSignIn(): Promise<void> {
    try {
      settle(await api.me())
      state.value = 'ready'
      return
    } catch (error) {
      if (!isMissingActor(error)) {
        fail(error)
        return
      }
    }

    return signIn()
  }

  async function load(): Promise<void> {
    try {
      settle(await api.me())
      state.value = 'ready'
    } catch (error) {
      if (isMissingActor(error)) return claiming(askAgainOrSignIn)
      fail(error)
    }
  }

  /** Called once after the app mounts, and again by the retry control. */
  async function start(): Promise<void> {
    if (running) return
    running = true
    state.value = 'loading'
    try {
      if (!navigator.onLine) {
        // The identifier already on the device is usable without a network — a PWA precached
        // for the shelf shows its cached screens as this person — but nothing has been
        // checked, and saying «ready» would promise an entity nothing has fetched. The state
        // stays «offline», which is both true and the one the offline text belongs to.
        const known = currentIdentity()
        if (isIdentifier(known)) id.value = known
        state.value = 'offline'
        return
      }
      await load()
    } finally {
      running = false
    }
  }

  // A connection that came back is the commonest recovery there is, and until now it took a
  // reload. `error` is listened for too: `navigator.onLine` is true on a captive portal and
  // on wifi with no route out, so the commonest way to lose the network lands there (Н-3).
  //
  // Coming back into view is listened for as well: an iOS PWA frozen in the background misses
  // `online` while the network returns, and since MOL-19 the offline notice has no button — it
  // would have waited for a restart (Р-8).
  function recover(): void {
    if (state.value === 'offline' || state.value === 'error') void start()
  }
  window.addEventListener('online', recover)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recover()
  })

  return { actor, id, state, start, retry: start }
})
