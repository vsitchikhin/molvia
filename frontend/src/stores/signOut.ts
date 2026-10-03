import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import {
  clearLeaving,
  dropErasureNote,
  erasureNote,
  erasingOwner,
  forgetOwner,
  leavingOwner,
  markLeaving,
  noteErasure,
} from '@/stores/identity'
import type { ErasureNote } from '@/stores/identity'
import { whileQueueIsStill } from '@/stores/tripQueue'
import { whileSpendingsAreStill } from '@/stores/spendingQueue'
import { reportFailure } from '@/failures'

/** Read afresh each time: the connection read before an `await` says nothing about after it. */
function connected(): boolean {
  return navigator.onLine
}

/**
 * An answer that came, and not from our API — a captive portal's page, a stranger's 404 (round 4,
 * Ж1). The request never reached the server, so nothing is unknown about it. A dropped connection,
 * a timeout and a `5xx` stay unknown: the server may have done its part before the answer was lost.
 */
function notReached(error: unknown): boolean {
  return error instanceof ApiError && !error.answered && error.code !== ERROR.INTERNAL
}

/**
 * The drawer goes while no window sends either queue of this owner — the trip's, then the
 * spendings' (MOL-82), always in that order, so two windows never wait on each other.
 */
function whileQueuesAreStill(owner: string, work: () => void): Promise<void> {
  return whileQueueIsStill(owner, () =>
    whileSpendingsAreStill(owner, () => {
      work()
      return Promise.resolve()
    }),
  )
}

/**
 * The two doors out of this device: «Выйти» ends the session, «Удалить мои данные» erases the
 * person and every session of theirs with them (MOL-94). Past the request they are one way out.
 */
export type WayOut = 'logout' | 'erase'

/**
 * Why the last attempt did not go through. The erasure has two of its own (adversarial А, В): its
 * `401` says the session was gone, which for «Выйти» is the goal and for an erasure is not.
 */
type Failure = 'offline' | 'error' | 'signed_out' | 'unknown'

/**
 * «Выйти» on this device (MOL-57, owner's decisions Q1–Q3), and since MOL-94 «Удалить мои данные»
 * through the same door: one intent — «this owner leaves this device» — and one ending, so the two
 * cannot drift apart. Only the request differs, and what the login screen says after the reload.
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
export const useSignOutStore = defineStore('signOut', () => {
  const actor = useActorStore()
  /** The request is on its way — the sheet holds its button. */
  const leaving = ref(false)
  /**
   * Why the last attempt failed, and through which door (adversarial Б): one value for both sheets
   * showed a failed erasure in the sheet of «Выйти» as «Не получилось выйти», and the other way.
   */
  const failure = ref<{ readonly way: WayOut; readonly kind: Failure } | null>(null)
  const logoutFailure = computed(() => {
    const last = failure.value
    return last?.way === 'logout' && (last.kind === 'offline' || last.kind === 'error')
      ? last.kind
      : null
  })
  const eraseFailure = computed(() => (failure.value?.way === 'erase' ? failure.value.kind : null))
  let finishing = false

  /**
   * What the login screen says about an intent finished by the server's «nobody», or by «Выйти»'s
   * own `204`, rather than by the erasure's answer: nothing for «Выйти» alone, which either word
   * completes; for an erasure still waiting, that its outcome is not known — the answer was lost,
   * and neither word says anything about the person.
   */
  function noteOfWaiting(owner: string): ErasureNote | null {
    return erasingOwner() === owner ? 'unknown' : null
  }

  /**
   * The owner is let go in this window first, so a write still in flight — a rating answering
   * late — finds nobody to file itself under (adversarial Б1); then the drawer goes, under the trip
   * queue's lock so a window sending it cannot write it back; then the page is loaded afresh at
   * `/`, the one sweep that forgets the stores' memory as well.
   */
  async function finish(owner: string, note: ErasureNote | null): Promise<void> {
    if (finishing) return
    finishing = true
    actor.release()
    await whileQueuesAreStill(owner, () => {
      forgetOwner(owner)
    })
    // «Удалены» only on the erasure's own `204` (В-3); the screen says nothing it does not know. A
    // note written by this tab's last tap stays: a «Выйти» it found waiting finishes here (round 2,
    // Д), and the tap is still the last thing the person did. «Выйти»'s own `204` takes it away.
    if (note) noteErasure(note)
    window.location.replace('/')
  }

  /** Resolves only if it failed: on success the page is replaced and nothing after it runs. */
  async function leave(way: WayOut = 'logout'): Promise<void> {
    const owner = actor.id
    if (leaving.value || !owner) return
    // Known offline before anything is sent — the approved plan's «only with a connection» — so
    // nothing leaves and nothing is left behind (round 3, Е1). A cancelled tap at the shelf with no
    // signal used to leave an intent that locked the app at the next launch until a signal came.
    if (!connected()) {
      failure.value = { way, kind: 'offline' }
      return
    }
    // The way out this owner was already waiting on — a «Выйти» or an erasure whose answer was
    // lost — which this tap is about to write over. A tap that settles nothing puts it back.
    const wasLeaving = leavingOwner() === owner
    const wasErasing = erasingOwner() === owner
    const noteBefore = erasureNote()
    // An erasure tried before, its answer lost: a `401` now may be that erasure done.
    const unsettled = way === 'erase' && wasErasing
    const putBack = (): void => {
      if (wasLeaving) markLeaving(owner, wasErasing)
      else clearLeaving()
      // And the note it took away: a «Выйти» that never reached the server was not the last thing
      // done (round 5, З).
      if (noteBefore) noteErasure(noteBefore)
    }
    leaving.value = true
    failure.value = null
    // An erasure whose answer was lost stays unknown through a «Выйти»: its `204` and its «nobody»
    // say nothing of the person, and both say «не знаем» on the login screen (round 4, № 11).
    markLeaving(owner, way === 'erase' || wasErasing)
    // A tap of «Выйти» is the last thing done here: a note of an earlier «Удалить» is not about it,
    // however this way out ends — its own `204` or the server's «nobody» (round 3 Ж, round 4 Ж′).
    if (way === 'logout') dropErasureNote()
    const before = actor.heard
    try {
      await (way === 'erase' ? api.eraseMe() : api.logout())
    } catch (error) {
      reportFailure(error, 'screen')
      leaving.value = false
      if (way === 'erase' && error instanceof ApiError && error.code === ERROR.NO_ACTOR) {
        if (!unsettled) {
          // **The session was gone before the tap** (adversarial А): ended from «Устройства», run
          // out in a tab left open, or the person already erased through another door — a `401`
          // is all of them at once (self-review 8). This tap erased nothing, so the device erases
          // nothing either — MOL-56's «a 401 erases nothing», the queue may hold a purchase of an
          // account that is still there. The sheet and the login screen say what is known: this
          // tap deleted nothing, and an empty account on signing in means it was deleted before.
          // A «Выйти» that was waiting (round 2, Д): «no session» is the very word that completes
          // it, so it is put back as it was, and the server's next «nobody» finishes it — never
          // dropped, or the next launch offline would open the app of the person who left. Before
          // the note, which `putBack` also restores: this tap's note is the one that stands (№ 12).
          putBack()
          noteErasure('kept')
          failure.value = { way, kind: 'signed_out' }
          if (wasLeaving && actor.heard !== before && actor.nobody) void finish(owner, null)
          return
        }
        // A repeat after a lost answer: the first tap may have erased everything, or the session
        // may have ended meanwhile — nobody can tell, and the sheet says that rather than nothing.
        failure.value = { way, kind: 'unknown' }
      } else {
        // Decided after the failure (MOL-19, A1).
        failure.value = { way, kind: connected() ? 'error' : 'offline' }
      }
      // The request never reached the server (round 4 of MOL-57, Ж1): this tap's intent goes, and
      // the one it wrote over comes back — a «Выйти» landed earlier, an erasure whose answer was
      // lost (MOL-94, round 3, Д′). Dropped with it, the next launch offline opened the app of the
      // person who left, and a «nobody» later finished nothing.
      if (notReached(error)) {
        putBack()
        return
      }
      // The server may have said «nobody» while this was in flight — its settling was skipped
      // then, and nothing will settle it again. Only that: an answer «this owner» given meanwhile
      // may be about the moment before the way out landed.
      if (actor.heard !== before && actor.nobody) void finish(owner, noteOfWaiting(owner))
      return
    }
    await finish(owner, way === 'erase' ? 'erased' : noteOfWaiting(owner))
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
    // Somebody is signed in: no login screen is coming that a note about an erasure was for.
    if (!actor.nobody) dropErasureNote()
    // Nobody is: words about the session that just ended do not outlive it — the door closes over
    // the sheet without closing it, and a login on this very page found them there (round 2, Г).
    else failure.value = null
    const owner = leavingOwner()
    if (!owner || leaving.value) return
    if (actor.nobody) void finish(owner, noteOfWaiting(owner))
    else if (actor.id === owner) clearLeaving()
    else void erase(owner)
  }

  /**
   * Somebody else signed in while the intent waited (self-review Р3-2): the cookie that proved the
   * owner who left has been replaced, and the server will say nothing more about them. Their drawer
   * goes as they asked, and the person signed in now is left as they are — no release, no reload.
   * Waiting instead let a `401` about the new session, months later, finish the old intent and let
   * go of somebody who never pressed «Выйти».
   */
  async function erase(owner: string): Promise<void> {
    clearLeaving()
    await whileQueuesAreStill(owner, () => {
      forgetOwner(owner)
    })
  }

  watch(() => actor.heard, settle)
  // A return of the connection or of the app is when the waiting intent can be settled.
  window.addEventListener('online', ask)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ask()
  })

  return { leaving, logoutFailure, eraseFailure, leave, stay, settle }
})
