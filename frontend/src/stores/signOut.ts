import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import { clearLeaving, forgetOwner, leavingOwner, markLeaving } from '@/stores/identity'
import { whileQueueIsStill } from '@/stores/tripQueue'

/**
 * «Выйти» on this device (MOL-57, owner's decisions Q1–Q3).
 *
 * **The order is the whole of it: the server first, the phone after.** A session is ended by the
 * `204` of `POST /auth/logout`, and only then is anything erased — a tap whose request never
 * arrived must not wipe the drafts of a person who is still signed in. Offline there is no way out
 * at all: the cookie is `HttpOnly`, so the page cannot put it out itself, and a session left alive
 * on the server is exactly what the person came to end.
 *
 * **An answer can be lost after the server did its part** (adversarial Б2), and then the first
 * `401` of any request closes the door — the settings with «Выйти» on them are behind it, and the
 * erasure would never come. So the intent is written down before the request leaves, and **only
 * the server's answer settles it**: «nobody» finishes the erasure, «this very owner» means the
 * request did not land and withdraws it. Nothing the device concludes by itself does either
 * (round 2): a launch with no connection closes the door on the intent, and that `signed-out` is
 * not the server's word — erasing on it threw away a purchase while the session lived on (Д1).
 * Closing the sheet after a failure is not a decision to stay either — the outcome is unknown —
 * so it asks the server rather than dropping the intent (Д3), and so does a return of the
 * connection while the intent waits.
 *
 * A store rather than a composable for that reason: it has to hear the identity settle from the
 * moment the app starts, the screen with the button or not.
 */
/** Read afresh each time: the connection read before an `await` says nothing about after it. */
function connected(): boolean {
  return navigator.onLine
}

export const useSignOutStore = defineStore('signOut', () => {
  const actor = useActorStore()
  /** The request is on its way — the sheet holds its button. */
  const leaving = ref(false)
  /** Why the last attempt did not end the session: no connection, or the server did not answer. */
  const failure = ref<'offline' | 'error' | null>(null)
  let finishing = false

  /**
   * The owner is let go in this window first, so a write still in flight — a rating answering
   * late — finds nobody to file itself under (adversarial Б1); then the drawer goes, under the trip
   * queue's lock so a window sending it cannot write it back; then the page is loaded afresh at
   * `/`, the one sweep that forgets the stores' memory as well.
   */
  async function finish(owner: string): Promise<void> {
    if (finishing) return
    finishing = true
    actor.release()
    await whileQueueIsStill(owner, () => {
      forgetOwner(owner)
      return Promise.resolve()
    })
    window.location.replace('/')
  }

  /** Resolves only if it failed: on success the page is replaced and nothing after it runs. */
  async function leave(): Promise<void> {
    const owner = actor.id
    if (leaving.value || !owner) return
    // Known offline before anything is sent — the approved plan's «only with a connection» — so
    // nothing leaves and nothing is left behind (round 3, Е1). A cancelled tap at the shelf with no
    // signal used to leave an intent that locked the app at the next launch until a signal came.
    if (!connected()) {
      failure.value = 'offline'
      return
    }
    leaving.value = true
    failure.value = null
    markLeaving(owner)
    const before = actor.heard
    try {
      await api.logout()
    } catch {
      // Decided after the failure (MOL-19, A1).
      failure.value = connected() ? 'error' : 'offline'
      leaving.value = false
      // The server may have said «nobody» while this was in flight — its settling was skipped
      // then, and nothing will settle it again. Only that: an answer «this owner» given meanwhile
      // may be about the moment before the way out landed.
      if (actor.heard !== before && actor.nobody) void finish(owner)
      return
    }
    await finish(owner)
  }

  /**
   * The sheet was closed. After a failure the outcome is unknown, so the intent stays and the
   * server is asked instead (round 2, Д3): its answer withdraws the intent or finishes the job.
   */
  function stay(): void {
    if (leaving.value || finishing) return
    failure.value = null
    ask()
  }

  function ask(): void {
    if (leavingOwner() && !leaving.value && !finishing) void actor.verify()
  }

  /** The server has answered who this browser is, and a «Выйти» may be waiting for that answer. */
  function settle(): void {
    const owner = leavingOwner()
    if (!owner || leaving.value) return
    if (actor.nobody) void finish(owner)
    else if (actor.id === owner) clearLeaving()
  }

  watch(() => actor.heard, settle)
  // A return of the connection or of the app is when the waiting intent can be settled.
  window.addEventListener('online', ask)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ask()
  })

  return { leaving, failure, leave, stay, settle }
})
