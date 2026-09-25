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
import {
  IDENTITY_KEY,
  currentIdentity,
  dropIdentity,
  erasedWhileAway,
  forgetOwner,
  isIdentifier,
  leavingOwner,
  rememberIdentity,
} from '@/stores/identity'

/**
 * What the identity is doing, so a screen can show the right one of its states.
 *
 * Two have gone and one has arrived. `uninvited` went with the invite door (MOL-52). `lost`
 * went with MOL-53: it meant «the data of this device is unreachable and a new identity has
 * been started», and neither half was true any more — a session is not the data, and losing one
 * is a reason to sign in again rather than to begin empty. **`signed-out` is what replaces it**
 * (MOL-56): there is no session, the app draws the login screen instead of any of its own, and
 * nothing on the device has been lost — the drawers are still filed under the same owner and
 * the same account comes back through Telegram.
 *
 * `error` keeps its own meaning and is not the same thing: the server could not be asked at
 * all. A session may be perfectly alive behind a captive portal, so that case shows the app
 * with a notice rather than a door.
 */
export type IdentityState = 'idle' | 'loading' | 'ready' | 'offline' | 'error' | 'signed-out'

function isMissingActor(error: unknown): boolean {
  return error instanceof ApiError && error.code === ERROR.NO_ACTOR
}

export const useActorStore = defineStore('actor', () => {
  const actor = ref<ActorView | null>(null)
  const id = ref<string | null>(currentIdentity())
  const state = ref<IdentityState>('idle')
  /**
   * How many times the server has answered who this browser is, and whether its last answer was
   * «nobody» (MOL-57, adversarial Д1). `signed-out` alone cannot say that: this device sets it too
   * — a launch with no connection and a «Выйти» not yet confirmed — and erasing a drawer on the
   * device's own guess threw away a purchase while the session lived on.
   */
  const heard = ref(0)
  const nobody = ref(false)
  function told(isNobody: boolean): void {
    nobody.value = isNobody
    heard.value += 1
  }
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
  /**
   * How many questions about the identity are in flight. A refusal earned by one of them is the
   * answer being waited for, not news — `sessionEnded` steps aside while it is non-zero, or a
   * cold start with no session would ask twice and `verify` would ask itself forever.
   */
  let asking = 0
  /**
   * Bumped by every settled answer. A question about the identity that comes back after a newer
   * one has already been answered is about a world that no longer exists — most sharply when
   * the newer answer is a login and the older one is `error.no_actor` about the moment before
   * it (adversarial А1).
   */
  let revision = 0

  function settle(loaded: ActorView): void {
    revision += 1
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
    // happens when the person genuinely changes account. Since MOL-56 a person is shown *which*
    // account they landed in before the app lets them any further, so this line is no longer
    // the only warning there is — it is the one a developer sees, where the change of owner is
    // an ordinary consequence of clearing the browser's cookies.
    if (was !== null && was !== loaded.id) {
      console.warn('[molvia] владелец сменился: записи прежнего остались на устройстве', was)
    }
  }

  function fail(error: unknown): void {
    state.value = navigator.onLine ? 'error' : 'offline'
    console.error('[molvia] личность не поднялась', error)
  }

  /**
   * The development seam, and since MOL-56 it is a button rather than something that happens by
   * itself: the login screen shows it, and only in a development build — its caller stands
   * behind `import.meta.env.DEV`, a literal Vite folds, so a production bundle holds no call to
   * an address the production server does not carry (MOL-52, Р-14).
   *
   * It signed the app in automatically until now, which made the screen this epic exists for
   * invisible in every working copy and unreachable to the end-to-end suite.
   */
  async function signIn(): Promise<ActorView | null> {
    // The literal Vite folds, so the call to an address production does not carry is dropped
    // from that bundle together with this branch — the property MOL-52 (Р-14) wrote down and a
    // `v-if` in the template alone would not have kept.
    if (!import.meta.env.DEV) return null
    state.value = 'loading'
    asking += 1
    try {
      const view = await api.devLogin()
      settle(view)
      state.value = 'ready'
      return view
    } catch (error) {
      // Провал входа дверь не открывает: `error` показывает приложение с плашкой, а здесь
      // приложения ещё нет. Что сказать человеку, решает экран входа — своим состоянием.
      console.error('[molvia] шов разработки не впустил', error)
      state.value = 'signed-out'
      return null
    } finally {
      asking -= 1
    }
  }

  async function load(): Promise<void> {
    asking += 1
    // The same check `verify` makes: an answer to a question asked before the owner was let go
    // is about a session that no longer exists (self-review С-2).
    const at = revision
    try {
      const view = await api.me()
      if (revision !== at) return
      adopt(view)
    } catch (error) {
      if (revision !== at) return
      // **«Nobody» is an answer, not a failure** (MOL-56). The app stops here and draws the
      // login screen; nothing on the device is touched, because the drawers are filed under the
      // owner and Telegram brings the same one back.
      //
      // The lock and the second `me()` that used to stand here went with the automatic sign-in
      // they existed for: two tabs racing to create an account is not a thing that can happen
      // when a person has to tap a button (MOL-53, Б3).
      if (isMissingActor(error)) {
        state.value = 'signed-out'
        told(true)
      } else fail(error)
    } finally {
      asking -= 1
    }
  }

  /**
   * **Asks the server who this browser is, and changes nothing it was not told** (MOL-56,
   * adversarial А1). It is the answer to every «the session may not be what I think it is»:
   * a refusal from a request that left earlier, another window's login, a return to the tab.
   *
   * What it deliberately does not do is take a refusal at face value. `error.no_actor` is the
   * truth about the moment a request **left**, and answers still in flight outlive a login: one
   * of them used to wipe the question «is this your account?» and let the next `me()` walk into
   * the account a stranger had confirmed. So the seam asks again instead of concluding, and only
   * a `me()` of its own may say «nobody». A server that cannot be reached says nothing at all
   * and leaves the screen as it is.
   *
   * Re-entrancy matters more than it looks: the `me()` below goes through the same seam, so
   * without the guard a dead session would ask forever.
   */
  async function verify(): Promise<void> {
    if (asking > 0) return
    asking += 1
    const at = revision
    try {
      const view = await api.me()
      if (revision === at) adopt(view)
    } catch (error) {
      // A refusal earned before a login landed says nothing about after it: the session it was
      // asking about is not the session this browser now holds (adversarial А1).
      if (isMissingActor(error) && revision === at) {
        state.value = 'signed-out'
        told(true)
      }
    } finally {
      asking -= 1
    }
  }

  /** What the login screen calls with the owner its poll collected. */
  function adopt(loaded: ActorView): void {
    settle(loaded)
    state.value = 'ready'
    told(false)
  }

  /** Called once after the app mounts, and again by the retry control. */
  async function start(): Promise<void> {
    if (running) return
    running = true
    state.value = 'loading'
    // «Выйти» in another window that this tab slept through (round 2, Д2): its own shelf still
    // holds the drawer. Let go here as the `storage` listener would have.
    if (erasedWhileAway()) {
      revision += 1
      actor.value = null
      id.value = null
    }
    try {
      if (!navigator.onLine) {
        // The identifier already on the device is usable without a network — a PWA precached
        // for the shelf shows its cached screens as this person — but nothing has been
        // checked, and saying «ready» would promise an entity nothing has fetched. The state
        // stays «offline», which is both true and the one the offline text belongs to.
        //
        // **With no owner on the device there is nothing to show** (MOL-56, Q5): no drawers, no
        // cached answers, and a person who has never signed in on this phone cannot start. That
        // is the login screen's offline state and not a notice over an empty app.
        const known = currentIdentity()
        // An owner who pressed «Выйти» and was not confirmed yet is not somebody to open the
        // app as (adversarial Б2): the drawer waits for the server's word to be erased.
        if (!isIdentifier(known) || leavingOwner() === known) {
          state.value = 'signed-out'
          return
        }
        id.value = known
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

  /**
   * Lets the owner go in this window (MOL-57): nobody is signed in here any more, and nothing may
   * be written under their name. Every write of the stores asks `actor.id` first, so with it
   * `null` a rating answering after the erasure finds nobody to file it under (adversarial Б1);
   * and the revision moves, so a `me()` that left before this — from a return to the tab, from
   * `online` — cannot bring the owner back and write the drawer's name again (self-review С-2).
   */
  function release(): void {
    revision += 1
    dropIdentity()
    actor.value = null
    id.value = null
    state.value = 'signed-out'
  }

  /**
   * «Выйти» in another window: the drawer is gone from storage, and the session with it — that
   * window erased nothing before the server's `204`. So this is not a guess that needs `me()`: the
   * owner is let go here too. **And this window erases its own shelves** (adversarial А1): the
   * one where «Выйти» was pressed cannot reach this tab's `sessionStorage`, where the same drawer
   * lies — `read` falls back to it, and a reload opened the app of the person who left.
   */
  window.addEventListener('storage', (event) => {
    if (event.key !== IDENTITY_KEY || event.newValue !== null || id.value === null) return
    const owner = id.value
    release()
    forgetOwner(owner)
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

  return {
    actor,
    id,
    settings,
    state,
    start,
    apply,
    adopt,
    verify,
    release,
    heard,
    nobody,
    signIn,
    busy: () => asking > 0,
    retry: start,
  }
})

/**
 * What any refusal of `error.no_actor` means, wherever it was earned (MOL-56). Wired to the
 * seam in `main.ts` rather than registered by the store itself: a store that registers a
 * global callback the moment it is created leaves two of them fighting over one slot, and the
 * composition root is where a wire between two modules belongs.
 */
export function sessionEnded(): void {
  const actor = useActorStore()
  // A question already in flight is about to answer this better than the refusal can.
  if (actor.busy()) return
  void actor.verify()
}
