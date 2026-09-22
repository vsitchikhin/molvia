import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { ActorView } from '@molvia/model'
import { api } from '@/api'
import {
  IDENTITY_KEY,
  commitRestore,
  currentIdentity,
  isIdentifier,
  lostIdentities,
  rememberIdentity,
  setAsideIdentity,
} from '@/stores/identity'
import { forget, read, write } from '@/stores/storage'

/** Only used where `navigator.locks` is missing: Firefox before 96, older WebViews. */
const CLAIM_KEY = 'molvia.actor.claiming'
/** How stale a claim has to look before another tab decides the one holding it is gone. */
const CLAIM_STALE_MS = 15_000
/** How often the holder proves it is still alive, so a slow request is not mistaken for death. */
const CLAIM_HEARTBEAT_MS = 5_000

/**
 * What the identity is doing, so a screen can show the right one of four states.
 *
 * `uninvited` went with the invite door (MOL-52): there is no code to be missing any more, so
 * the state had become one nothing could reach. `lost` stays and still means its own thing —
 * the data of this device is unreachable and a new identity has already been started. MOL-56
 * rewrites what is left of these under «the session ended, sign in again».
 */
export type IdentityState = 'idle' | 'loading' | 'ready' | 'offline' | 'error' | 'lost'

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
 *
 * **The fallback narrows the race, it does not close it.** Two tabs starting in the same
 * millisecond both read an empty claim and both proceed — «read, then write» over storage
 * cannot be made atomic. That is accepted because the path exists only for browsers without
 * Web Locks, and saying so here is cheaper than rediscovering it (М-26).
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
  const actor = ref<ActorView | null>(null)
  const id = ref<string | null>(currentIdentity())
  const state = ref<IdentityState>('idle')
  /** Identifiers that can still be brought back. A ref, so a screen sees it change (М-23). */
  const lost = ref<string[]>(lostIdentities())
  /** Set when a restore was attempted and the server refused the old identifier too. */
  const restoreFailed = ref(false)
  /** True while `start` is in flight, so a retry button cannot queue a second one. */
  let running = false

  function settle(loaded: ActorView): void {
    actor.value = loaded
    id.value = loaded.id
    // The success path writes back too: a tab that adopted an identifier from another one
    // would otherwise hold it only in memory, and storage and memory would disagree.
    rememberIdentity(loaded.id)
    lost.value = lostIdentities()
  }

  function setAside(stale: string): void {
    setAsideIdentity(stale)
    lost.value = lostIdentities()
  }

  function fail(error: unknown): void {
    state.value = navigator.onLine ? 'error' : 'offline'
    console.error('[molvia] личность не поднялась', error)
  }

  async function create(): Promise<void> {
    try {
      settle(await api.devLogin())
      state.value = 'ready'
    } catch (error) {
      // Nothing to explain away any more: until MOL-54 the only way to an identity is the
      // development seam, and a server that does not carry it — production — answers 404 like
      // any other failure. The person is told the app is broken, which is the truth there.
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
        setAside(adopted)
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
      setAside(stale)
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

  /**
   * Brings a set-aside identifier back — **asking first, writing after**.
   *
   * The earlier version wrote storage before it knew anything: it claimed the old key, then
   * called `start()`, which bails out while another attempt is in flight. A press landing in
   * that window spent the only copy for nothing — the button disappeared, the identifier was
   * gone, and every later request went out signed with a key the server had already refused
   * (Р-1, С-11). Now nothing moves until the server has agreed.
   */
  async function restore(): Promise<void> {
    if (running) return
    const candidate = lost.value.at(-1) ?? null
    if (!isIdentifier(candidate)) return

    running = true
    restoreFailed.value = false
    state.value = 'loading'
    try {
      // Asked about explicitly, so neither storage nor the in-memory identity is touched
      // until the answer is in.
      const restored = await api.me(candidate)

      commitRestore(candidate)
      settle(restored)
      state.value = 'ready'
    } catch (error) {
      if (isMissingActor(error)) {
        // The server does not know it either. Nothing is changed and nothing is thrown
        // away: this is the case where a person would otherwise lose the identity they are
        // using now to chase one that no longer exists.
        restoreFailed.value = true
        state.value = 'lost'
        return
      }
      fail(error)
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

  return { actor, id, state, lost, restoreFailed, start, retry: start, restore }
})
