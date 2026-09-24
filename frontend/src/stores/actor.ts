import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR, settingsOf } from '@molvia/model'
import type { ActorView } from '@molvia/model'
import {
  recallSettings,
  recallSettingsSnapshot,
  rememberSettings,
  settingsKey,
} from '@/stores/settingsMemory'
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
  const cachedSettings = ref(recallSettings(id.value))
  const settings = computed(() =>
    actor.value?.id === id.value ? settingsOf(actor.value) : cachedSettings.value,
  )
  watch(
    id,
    (owner) => {
      cachedSettings.value = recallSettings(owner)
    },
    { flush: 'sync' },
  )
  watch(
    actor,
    (loaded) => {
      if (loaded?.id === id.value) {
        cachedSettings.value = settingsOf(loaded)
        rememberSettings(loaded.id, cachedSettings.value, loaded.updatedAt)
      }
    },
    { flush: 'sync' },
  )
  window.addEventListener('storage', (event) => {
    if (id.value && event.key === settingsKey(id.value)) {
      const snapshot = recallSettingsSnapshot(id.value)
      if (
        !snapshot ||
        (actor.value && snapshot.updatedAt && actor.value.updatedAt > snapshot.updatedAt)
      )
        return
      cachedSettings.value = snapshot.settings
      if (actor.value)
        actor.value = {
          ...actor.value,
          ...snapshot.settings,
          updatedAt: snapshot.updatedAt ?? actor.value.updatedAt,
        }
    }
  })
  /** True while `start` is in flight, so a retry button cannot queue a second one. */
  let running = false

  function settle(loaded: ActorView): void {
    const was = currentIdentity()
    if (actor.value?.id === loaded.id && actor.value.updatedAt > loaded.updatedAt) return
    actor.value = loaded
    id.value = loaded.id
    // Written down because the app needs it **before** the server can be asked: at the shelf
    // with no signal the trip queue and the recent items are found by this key, and there is
    // nobody to ask who we are (MOL-53, Р-9). It is not a credential any more — nothing sends
    // it anywhere — it is the name of a drawer.
    rememberIdentity(loaded.id)
    cachedSettings.value = settingsOf(loaded)
    rememberSettings(loaded.id, cachedSettings.value, loaded.updatedAt)

    // **A different owner than last time leaves the previous one's drawers where they are, and
    // out of reach** (MOL-53, Б1/Б2): the trip queue, the recent items and the verdict drafts
    // are all filed under the owner's id, so purchases entered with no signal stay on the device
    // and are never sent. Nothing here moves them — they belong to that account, and sending
    // them as this one would put somebody's shopping into another person's history.
    //
    // In production this is rare by construction: signing in through Telegram finds the *same*
    // owner, so the drawer comes back with them — that is the whole promise of the epic. It
    // happens when the person genuinely changes account, and every time in development, where
    // the seam mints a new Telegram id on each call. Said out loud here because the screen that
    // could say it to a person is MOL-56's, and until then a log line is better than silence.
    if (was !== null && was !== loaded.id) {
      console.warn('[molvia] владелец сменился: записи прежнего остались на устройстве', was)
    }
  }

  function fail(error: unknown): void {
    state.value = navigator.onLine ? 'error' : 'offline'
    console.error('[molvia] личность не поднялась', error)
  }

  /**
   * The development seam. Its only caller stands behind `import.meta.env.DEV`, a literal Vite
   * folds, so a production bundle holds no call to an address the production server does not
   * carry — the same shape the seam has on the server (MOL-52, Р-14).
   *
   * In production, until MOL-54, there is simply no way in, and the honest state for that is
   * `error`. MOL-56 replaces it with a screen that offers the Telegram login.
   */
  async function signIn(): Promise<void> {
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
      if (!isMissingActor(error)) {
        fail(error)
        return
      }

      // **The second ask is only worth making where signing in is possible** (MOL-53, Б3). It
      // exists to catch a session another tab opened while this one waited for the lock — and
      // in a production build there is no way to open one until MOL-54, so both the lock and
      // the second request are spent on nothing. `recover()` comes back on every return to the
      // tab, so «nothing» was two requests each time.
      if (!import.meta.env.DEV) {
        state.value = 'error'
        return
      }

      return claiming(askAgainOrSignIn)
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

  function apply(loaded: ActorView): void {
    if (
      loaded.id !== id.value ||
      (actor.value?.id === loaded.id && actor.value.updatedAt > loaded.updatedAt)
    )
      return
    actor.value = loaded
    state.value = 'ready'
  }

  return { actor, id, settings, state, start, apply, retry: start }
})
