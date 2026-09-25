import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { SessionView, SessionsResponse } from '@molvia/model'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'

/**
 * `idle` — no identity yet. There is no `empty`: a live session is always in its own list, and
 * a request without one is a 401 that the login screen answers, not this one.
 */
export type SessionsPhase = 'idle' | 'loading' | 'ready' | 'error' | 'offline'

export interface Sessions {
  readonly phase: ComputedRef<SessionsPhase>
  readonly list: Ref<SessionsResponse | null>
  /** The session being ended right now — the sheet holds its button while it is. */
  readonly ending: Ref<string | null>
  /** The last «Завершить» did not reach an answer — said in the sheet, which stays open. */
  readonly endFailed: Ref<boolean>
  retry(): Promise<void>
  /** Resolves whether the session is gone; the list is read again either way it went. */
  end(session: SessionView): Promise<boolean>
}

/**
 * «Устройства» as this phone sees it (MOL-57): the server's answer and nothing kept.
 *
 * **No copy on the phone, on purpose.** Every other screen remembers its last answer so the shelf
 * without a signal still has something to show; this one lists the keys to the account, and
 * yesterday's list read as today's would hide exactly the device a person came here to end.
 * Offline, the screen says so and waits.
 */
export function useSessions(): Sessions {
  const actor = useActorStore()
  const list = ref<SessionsResponse | null>(null)
  const failure = ref<'offline' | 'error' | null>(null)
  const ending = ref<string | null>(null)
  const endFailed = ref(false)
  let latest = 0

  async function load(): Promise<void> {
    if (!actor.id) return
    const mine = ++latest
    try {
      const answer = await api.sessions()
      if (mine !== latest) return
      list.value = answer
      failure.value = null
    } catch {
      if (mine !== latest) return
      // A list that could not be read again is not shown as if it had been (round 2, Д4): it is
      // the copy this composable refuses to keep, only in memory instead of on the disk.
      list.value = null
      // Decided after the failure, never before the request (MOL-19, A1).
      failure.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  const phase = computed<SessionsPhase>(() => {
    if (!actor.id) return 'idle'
    if (list.value) return 'ready'
    return failure.value ?? 'loading'
  })

  onMounted(() => void load())
  // Another owner, another list: nothing of the last one may stay on the screen.
  watch(
    () => actor.id,
    () => {
      list.value = null
      failure.value = null
      endFailed.value = false
      void load()
    },
  )
  // Every return, not only one after a failure (adversarial В2): an installed app comes back to
  // this screen hours later, and a list kept in memory that long is the copy this composable
  // refuses to keep on the disk — a stranger's login meanwhile would not be in it.
  useReconnect(() => {
    void load()
  })

  return {
    phase,
    list,
    ending,
    endFailed,
    retry: load,
    async end(session) {
      if (ending.value) return false
      ending.value = session.id
      endFailed.value = false
      try {
        await api.endSession(session.id)
      } catch (caught) {
        // The server's own «no such session»: ended already — from another device, by a tap whose
        // answer was lost, or it simply ran out. What the person asked for is true, so it is not a
        // failure. A 404 a portal made up (`answered === false`) is not the server saying so.
        const gone =
          caught instanceof ApiError && caught.code === ERROR.NOT_FOUND && caught.answered
        if (!gone) {
          endFailed.value = true
          ending.value = null
          return false
        }
      }
      ending.value = null
      // Gone from the screen at once, not when the list is read again (adversarial В1): with that
      // read failing, the device just ended stayed in the list with its button under the words
      // «ended», and nothing said the list was stale.
      const shown = list.value
      if (shown?.sessions.some((row) => row.id === session.id)) {
        list.value = {
          sessions: shown.sessions.filter((row) => row.id !== session.id),
          total: Math.max(0, shown.total - 1),
        }
      }
      await load()
      return true
    },
  }
}
