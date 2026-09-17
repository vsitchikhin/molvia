import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { Actor } from '@molvia/model'
import { api } from '@/api'
import {
  IDENTITY_KEY,
  currentIdentity,
  forget,
  forgetInviteCode,
  inviteCode,
  isIdentifier,
  lostIdentity,
  read,
  rememberIdentity,
  restoreIdentity,
  setAsideIdentity,
  takeInviteCodeFromUrl,
  write,
} from '@/stores/identity'

/** Only used where `navigator.locks` is missing: Firefox before 96, older WebViews. */
const CLAIM_KEY = 'molvia.actor.claiming'
/** How stale a claim has to look before another tab decides the one holding it is gone. */
const CLAIM_STALE_MS = 15_000
/** How often the holder proves it is still alive, so a slow request is not mistaken for death. */
const CLAIM_HEARTBEAT_MS = 5_000

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
 * closed mid-request, which no timeout can imitate. The fallback is for browsers without it,
 * and it keeps a claim **that is refreshed while the work runs**: a fixed deadline could not
 * tell a tab waiting on a slow first request from a tab that died, and gave up on both.
 */
async function claiming<T>(run: () => Promise<T>): Promise<T> {
  // The DOM types promise `navigator.locks` is always there; Firefox before 96 and older
  // WebViews say otherwise, and a phone at a shelf is exactly where an old WebView turns
  // up. Read through a record rather than through the typed property, so the check is
  // honest instead of being argued away as unnecessary.
  const locks = (navigator as unknown as Record<string, unknown>).locks as LockManager | undefined
  if (locks) return locks.request(IDENTITY_KEY, run)

  // Storage may be blocked outright, and reaching for it throws — every access goes through
  // the guarded helpers for that reason. Unguarded, this line rejected `start()` for the
  // whole class of browsers this fallback exists for, leaving a blank screen (Н-1).
  const claimed = Number(read(CLAIM_KEY))
  if (claimed && Date.now() - claimed < CLAIM_STALE_MS) {
    // Waited, and that is all: whether the other tab succeeded is for the runner to see —
    // it re-reads the identity before creating one, so a published identifier is adopted
    // instead of being duplicated.
    await waitForAnotherTab()
  }

  write(CLAIM_KEY, String(Date.now()))
  const heartbeat = setInterval(() => {
    write(CLAIM_KEY, String(Date.now()))
  }, CLAIM_HEARTBEAT_MS)

  try {
    return await run()
  } finally {
    clearInterval(heartbeat)
    forget(CLAIM_KEY)
  }
}

/** Resolves when another tab publishes an identifier, or when its claim goes stale. */
async function waitForAnotherTab(): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (published: boolean) => {
      window.removeEventListener('storage', onStorage)
      clearInterval(watch)
      resolve(published)
    }
    const onStorage = (event: StorageEvent) => {
      // Whatever arrives here becomes this device's identity, so it has to look like one.
      if (event.key === IDENTITY_KEY && isIdentifier(event.newValue)) done(true)
    }

    window.addEventListener('storage', onStorage)
    // Watched rather than timed out once: the holder refreshes its claim while it works, so
    // «still alive» and «gone» are told apart by whether the stamp moves.
    const watch = setInterval(() => {
      const claimed = Number(read(CLAIM_KEY))
      if (!claimed || Date.now() - claimed > CLAIM_STALE_MS) done(isIdentifier(read(IDENTITY_KEY)))
    }, CLAIM_HEARTBEAT_MS)
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
        setAsideIdentity(adopted)
        id.value = null
      }
    }

    return create()
  }

  /** The 401 path: set the old identifier aside and replace it, both under the claim. */
  async function replace(stale: string): Promise<void> {
    await claiming(async () => {
      // Inside the claim, and only clearing the stored key if it still holds this value:
      // two tabs meeting the same 401 would otherwise have the slower one delete the
      // identifier the faster one had just created (С-9).
      setAsideIdentity(stale)
      id.value = null
      await createOrAdopt()
    })

    // Said out loud only once a replacement exists — «lost» describes what happened to the
    // old data, and there is nothing to say it to until the app works again.
    if (state.value === 'ready') state.value = 'lost'
  }

  async function load(): Promise<void> {
    const stored = id.value
    if (!stored) return claiming(createOrAdopt)

    try {
      settle(await api.me())
      state.value = 'ready'
    } catch (error) {
      if (isMissingActor(error)) return replace(stored)
      fail(error)
    }
  }

  /** Called once after the app mounts, and again by the retry control. */
  async function start(): Promise<void> {
    if (running) return
    running = true
    state.value = 'loading'
    try {
      // Scrubbed on every start, not only while creating an identity: a device that already
      // has one, opened from the same link again, kept the code in its address bar (М-20).
      takeInviteCodeFromUrl()

      if (!navigator.onLine) {
        // An identifier already on the device is usable without a network — a PWA precached
        // for the shelf shows its cached screens as this person — but it has not been
        // checked, and saying «ready» would promise an entity nothing has fetched. The
        // state stays «offline», which is both true and the one the offline text belongs to.
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

  /** Puts a set-aside identifier back and checks it, for when the server was at fault. */
  async function restore(): Promise<void> {
    const restored = restoreIdentity()
    if (!restored) return

    id.value = restored
    actor.value = null
    await start()
  }

  const recoverable = () => isIdentifier(lostIdentity())

  // A connection that came back is the commonest recovery there is, and until now it took a
  // reload. `error` is listened for too: `navigator.onLine` is true on a captive portal and
  // on wifi with no route out, so the commonest way to lose the network lands there (Н-3).
  window.addEventListener('online', () => {
    if (state.value === 'offline' || state.value === 'error') void start()
  })

  return { actor, id, state, start, retry: start, restore, recoverable }
})
