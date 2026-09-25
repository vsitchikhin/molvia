import { ref } from 'vue'
import type { Ref } from 'vue'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import { forgetOwner } from '@/stores/identity'
import { LOGIN_KEY } from '@/stores/login'
import { forget } from '@/stores/storage'
import { whileQueueIsStill } from '@/stores/tripQueue'

export interface SignOut {
  /** The request is on its way — the sheet holds its button. */
  readonly leaving: Ref<boolean>
  /** Why the last attempt did not end the session: no connection, or the server did not answer. */
  readonly failure: Ref<'offline' | 'error' | null>
  /** Resolves only if it failed: on success the page is replaced and nothing after it runs. */
  readonly leave: () => Promise<void>
}

/**
 * «Выйти» on this device (MOL-57, owner's decisions Q1–Q3).
 *
 * **The order is the whole of it: the server first, the phone after.** A session is ended by the
 * `204` of `POST /auth/logout`, and only then is anything erased — a tap whose request never
 * arrived must not wipe the drafts of a person who is still signed in, and the screen withdraws
 * nothing on a tap (the rule of «Вернуть», MOL-40). Offline there is no way out at all: the cookie
 * is `HttpOnly`, so the page cannot put it out itself, and a session left alive on the server is
 * exactly what the person came to end.
 *
 * Then the drawer goes whole — `forgetOwner` — under the trip queue's lock, so a window sending
 * that queue cannot write it back; and the page is loaded afresh at `/`, because the stores hold
 * the same data in memory and a reload is the one sweep that forgets nothing of it. What opens
 * then is the login screen: no owner on the device, no session in the jar.
 */
export function useSignOut(): SignOut {
  const actor = useActorStore()
  const leaving = ref(false)
  const failure = ref<'offline' | 'error' | null>(null)

  async function leave(): Promise<void> {
    if (leaving.value) return
    leaving.value = true
    failure.value = null
    const owner = actor.id
    try {
      await api.logout()
    } catch {
      // Decided after the failure (MOL-19, A1).
      failure.value = navigator.onLine ? 'error' : 'offline'
      leaving.value = false
      return
    }
    if (owner) {
      await whileQueueIsStill(owner, () => {
        forgetOwner(owner)
        return Promise.resolve()
      })
    }
    forget(LOGIN_KEY)
    window.location.replace('/')
  }

  return { leaving, failure, leave }
}
