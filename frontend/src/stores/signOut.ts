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
 * erasure would never come. So the intent is written down before the request leaves, and the
 * server's own «no session» — the identity settling as signed out — finishes the job. The server
 * saying the session is alive means the request did not land: the intent goes, and «Выйти» is
 * there to press again. Closing the sheet withdraws it too: the person decided to stay.
 *
 * A store rather than a composable for that reason: it has to hear the identity settle from the
 * moment the app starts, the screen with the button or not.
 */
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
    leaving.value = true
    failure.value = null
    markLeaving(owner)
    try {
      await api.logout()
    } catch {
      // Decided after the failure (MOL-19, A1).
      failure.value = navigator.onLine ? 'error' : 'offline'
      leaving.value = false
      // A `401` may have settled the identity while this was in flight — its settling was skipped
      // then, and nothing will settle it again. Only that: a «ready» here is stale, not an answer,
      // and reading it as «the session is alive» withdrew the intent this failure is kept for.
      if (actor.state === 'signed-out') void finish(owner)
      return
    }
    await finish(owner)
  }

  /** The sheet was closed: whatever did not work is not to be finished behind the person's back. */
  function stay(): void {
    if (leaving.value || finishing) return
    failure.value = null
    clearLeaving()
  }

  /** The server has answered who we are, and a «Выйти» is waiting for that answer. */
  function settle(): void {
    const owner = leavingOwner()
    if (!owner || leaving.value) return
    if (actor.state === 'signed-out') void finish(owner)
    else if (actor.state === 'ready' && actor.id === owner) clearLeaving()
  }

  watch(() => actor.state, settle)

  return { leaving, failure, leave, stay, settle }
})
