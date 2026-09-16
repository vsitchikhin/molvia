import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { Actor } from '@molvia/model'
import { api } from '@/api'
import {
  IDENTITY_KEY,
  currentIdentity,
  forgetInviteCode,
  inviteCode,
  isIdentifier,
  rememberIdentity,
  setAsideIdentity,
} from '@/stores/identity'

/** Only used where `navigator.locks` is missing: Firefox before 96, older WebViews. */
const CLAIM_KEY = 'molvia.actor.claiming'

const CLAIM_TIMEOUT_MS = 30_000

/**
 * What the identity is doing, so a screen can show the right one of four states.
 *
 * `lost` and `uninvited` are kept apart although both end in «you cannot use this yet»: one
 * means the data of this device is unreachable and a new identity has already been started,
 * the other that the app cannot get one at all — no link, or a code the door refused. One
 * sentence would be wrong for whichever case it was not written for.
 */
export type IdentityState =
  'idle' | 'loading' | 'ready' | 'offline' | 'error' | 'lost' | 'uninvited'

function isMissingActor(error: unknown): boolean {
  return error instanceof ApiError && error.code === ERROR.NO_ACTOR
}

/**
 * One tab creates the identity, the others wait for it: both would otherwise read an empty
 * storage and create one each, splitting a person's data in two without a trace.
 *
 * `navigator.locks` is the honest tool — atomic, and released by the browser when a tab is
 * closed mid-request, which no timeout can imitate. The fallback keeps a stamped claim for
 * browsers without it; its deadline is long because the case it guards is a slow first
 * request on a cold server, and giving up early is the very split it exists to prevent.
 */
async function claiming<T>(run: () => Promise<T>): Promise<T> {
  // The DOM types promise `navigator.locks` is always there; Firefox before 96 and older
  // WebViews say otherwise, and a phone at a shelf is exactly where an old WebView turns
  // up. Read through a record rather than through the typed property, so the check is
  // honest instead of being argued away as unnecessary.
  const locks = (navigator as unknown as Record<string, unknown>).locks as LockManager | undefined
  if (locks) return locks.request(IDENTITY_KEY, run)

  const claimed = Number(localStorage.getItem(CLAIM_KEY))
  if (claimed && Date.now() - claimed < CLAIM_TIMEOUT_MS) {
    // Waited, and that is all: whether the other tab succeeded is for the runner to see —
    // it re-reads the identity before creating one, so a published identifier is adopted
    // instead of being duplicated.
    await waitForAnotherTab()
  }

  try {
    localStorage.setItem(CLAIM_KEY, String(Date.now()))
  } catch {
    // Without storage there is nothing to coordinate through; one tab is the common case.
  }
  try {
    return await run()
  } finally {
    try {
      localStorage.removeItem(CLAIM_KEY)
    } catch {
      // Nothing was written.
    }
  }
}

/** Resolves when another tab publishes an identifier, or when waiting stops being useful. */
async function waitForAnotherTab(): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (published: boolean) => {
      window.removeEventListener('storage', onStorage)
      clearTimeout(timer)
      resolve(published)
    }
    const onStorage = (event: StorageEvent) => {
      // Whatever arrives here becomes this device's identity, so it has to look like one.
      if (event.key === IDENTITY_KEY && isIdentifier(event.newValue)) done(true)
    }

    window.addEventListener('storage', onStorage)
    const timer = setTimeout(() => {
      done(false)
    }, CLAIM_TIMEOUT_MS)
  })
}

export const useActorStore = defineStore('actor', () => {
  const actor = ref<Actor | null>(null)
  const id = ref<string | null>(currentIdentity())
  const state = ref<IdentityState>('idle')
  /** True while `start` is in flight, so a retry button cannot queue a second one. */
  let running = false

  function settle(loaded: Actor): void {
    actor.value = loaded
    id.value = loaded.id
    // The success path writes back too: a tab that adopted an identifier from another one
    // would otherwise hold it only in memory, and storage and memory would disagree.
    rememberIdentity(loaded.id)
  }

  function fail(error: unknown): void {
    state.value = navigator.onLine ? 'error' : 'offline'
    console.error('[molvia] личность не поднялась', error)
  }

  async function create(): Promise<void> {
    const code = inviteCode()
    if (!code) {
      // Without a code the server refuses, and it is right to: the link people are given
      // carries it. Saying so here beats a 401 the screen cannot explain.
      state.value = 'uninvited'
      return
    }

    try {
      settle(await api.createActor(code))
      state.value = 'ready'
    } catch (error) {
      if (isMissingActor(error)) {
        // The door refused this code — rotated, mistyped, or from another deployment.
        // Keeping it would make every retry the same 401 with the same wrong explanation.
        forgetInviteCode()
        state.value = 'uninvited'
        return
      }
      fail(error)
    }
  }

  /**
   * Runs under the claim, and re-reads the identity first: between asking for the claim and
   * getting it, another tab may have created one. Creating a second here is exactly the
   * split the claim exists to prevent.
   */
  async function createOrAdopt(): Promise<void> {
    const adopted = currentIdentity()
    if (isIdentifier(adopted) && adopted !== id.value) {
      id.value = adopted
      try {
        settle(await api.me())
        state.value = 'ready'
        return
      } catch (error) {
        if (!isMissingActor(error)) {
          fail(error)
          return
        }
        // Published, but the server does not know it either — fall through and create.
        setAsideIdentity()
        id.value = null
      }
    }

    return create()
  }

  async function load(): Promise<void> {
    const stored = id.value
    if (!stored) return claiming(createOrAdopt)

    try {
      settle(await api.me())
      state.value = 'ready'
    } catch (error) {
      if (isMissingActor(error)) {
        // The identifier is set aside rather than deleted: a 401 is not proof that the row
        // is gone, and after a server-side mistake is fixed it would work again.
        setAsideIdentity()
        id.value = null
        await claiming(createOrAdopt)
        // Said out loud only once a replacement exists — «lost» describes what happened to
        // the old data, and there is nothing to say it to until the app works again.
        if (state.value === 'ready') state.value = 'lost'
        return
      }
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
        // An identifier already on the device needs no network to be used: a PWA precached
        // for the shelf can show its cached screens as this person. Only a device that has
        // no identity at all is actually stuck, because getting one is a request.
        const known = currentIdentity()
        if (isIdentifier(known)) {
          id.value = known
          state.value = 'ready'
          return
        }
        state.value = 'offline'
        return
      }
      await load()
    } finally {
      running = false
    }
  }

  // A connection that came back is the commonest recovery there is, and until now it took a
  // reload: nothing listened, so `offline` was terminal.
  window.addEventListener('online', () => {
    if (state.value === 'offline') void start()
  })

  return { actor, id, state, start, retry: start }
})
