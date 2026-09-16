import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { Actor } from '@molvia/model'
import { api } from '@/api'

const KEY = 'molvia.actor'
const INVITE_KEY = 'molvia.invite'
const LOCK_KEY = 'molvia.actor.claiming'

/**
 * How long a tab may hold the claim before another one decides it is gone. A tab closed
 * mid-request would otherwise leave every other tab waiting forever, and «the app never
 * loads in the second window» is a bug nobody would connect to the first one.
 */
const LOCK_TIMEOUT_MS = 10_000

/**
 * What the identity is doing, so a screen can show the right one of four states.
 *
 * `lost` and `uninvited` are kept apart although both end in «you cannot use this yet»: one
 * means the data of this device is unreachable and a new identity has already been started,
 * the other that the app was opened without the link that carries the code. One sentence
 * would be wrong for whichever case it was not written for.
 */
export type IdentityState =
  'idle' | 'loading' | 'ready' | 'offline' | 'error' | 'lost' | 'uninvited'

/**
 * Storage throws rather than returning null in Safari's private mode, and the app has to
 * keep working in that session — the identity simply lives in memory and dies with the tab.
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    console.warn('[molvia] хранилище недоступно, личность живёт только в этой вкладке')
  }
}

function forget(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing to do: the value was never stored in the first place.
  }
}

/** The invite code travels in the link once; after that it lives on the device. */
function inviteCode(): string | null {
  const fromLink = new URLSearchParams(window.location.search).get('c')
  if (fromLink) write(INVITE_KEY, fromLink)
  return fromLink ?? read(INVITE_KEY)
}

function claimIsStale(): boolean {
  const claimed = Number(read(LOCK_KEY))
  return !claimed || Date.now() - claimed > LOCK_TIMEOUT_MS
}

/** Waits for the tab that is creating the identity to publish it, or gives up. */
async function identityFromAnotherTab(): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (id: string | null) => {
      window.removeEventListener('storage', onStorage)
      clearTimeout(timer)
      resolve(id)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY && event.newValue) done(event.newValue)
    }

    window.addEventListener('storage', onStorage)
    const timer = setTimeout(() => {
      done(read(KEY))
    }, LOCK_TIMEOUT_MS)
  })
}

export const useActorStore = defineStore('actor', () => {
  const actor = ref<Actor | null>(null)
  const id = ref<string | null>(read(KEY))
  const state = ref<IdentityState>('idle')

  function remember(created: Actor): void {
    actor.value = created
    id.value = created.id
    write(KEY, created.id)
    forget(LOCK_KEY)
  }

  async function create(): Promise<void> {
    const code = inviteCode()
    if (!code) {
      // Without a code the server refuses, and it is right to: the link people are given
      // carries it. Saying so here beats a 401 the screen cannot explain.
      state.value = 'uninvited'
      return
    }

    // One tab creates, the others wait: both would otherwise read an empty storage and
    // create an identity each, splitting one person's data in two without a trace.
    if (!claimIsStale()) {
      const fromOther = await identityFromAnotherTab()
      if (fromOther) {
        id.value = fromOther
        await load()
        return
      }
    }

    write(LOCK_KEY, String(Date.now()))
    try {
      remember(await api.createActor(code))
      state.value = 'ready'
    } catch (error) {
      forget(LOCK_KEY)
      fail(error)
    }
  }

  async function load(): Promise<void> {
    const stored = id.value
    if (!stored) return create()

    try {
      actor.value = await api.me()
      state.value = 'ready'
    } catch (error) {
      // The identity is gone — storage cleared, or the database recreated in development.
      // A new one is started, and MOL-8 Ш-8 tells the person instead of swallowing it.
      if (error instanceof ApiError && error.code === ERROR.NO_ACTOR) {
        forget(KEY)
        id.value = null
        await create()
        if (state.value === 'ready') state.value = 'lost'
        return
      }
      fail(error)
    }
  }

  function fail(error: unknown): void {
    state.value = navigator.onLine ? 'error' : 'offline'
    console.error('[molvia] личность не поднялась', error)
  }

  /** Called once before the app mounts; every screen after that reads `id`. */
  async function start(): Promise<void> {
    state.value = 'loading'
    if (!navigator.onLine) {
      state.value = 'offline'
      return
    }
    await load()
  }

  return { actor, id, state, start, retry: start }
})
