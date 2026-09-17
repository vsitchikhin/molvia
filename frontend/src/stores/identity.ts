/**
 * Where the identifier lives while the app is running, and the only place anything reads it
 * from. The client needs it at request time, the store owns its lifecycle, and the two used
 * to reach for `localStorage` separately — so a device that could not write storage kept a
 * perfectly good identifier in memory and sent every request without it (adversarial О-3).
 *
 * Storage is a cache of this value, not the value itself.
 */

const KEY = 'molvia.actor'
const INVITE_KEY = 'molvia.invite'
/** Kept when an identifier stops being recognised, so a server-side mistake is recoverable. */
const LOST_KEY = 'molvia.actor.lost'

/** What this device is right now. `null` until the first visit succeeds. */
let current: string | null = null

/**
 * The invite code, in memory, for the same reason the identifier is: when storage refuses
 * every write, a code that arrived in the link has nowhere to be kept — and reading it back
 * a moment later returns nothing. The device would then be told it needs an invite while
 * holding one, and could never create an identity at all.
 */
let invite: string | null = null

/**
 * Storage throws rather than returning null in Safari's private mode, and reaching for the
 * property itself throws when storage is blocked outright — disabled cookies, an embedded
 * WebView, a corporate policy. **Every** access goes through here for that reason: one
 * unguarded `localStorage.getItem` was enough to make the app reject on start and sit on a
 * blank screen for the whole class of browsers the fallback path exists for (Н-1).
 *
 * `sessionStorage` is tried second: it survives a reload in the same tab, which is the
 * difference between one identity per launch and one per session (О-7).
 */
function stores(): Storage[] {
  const found: Storage[] = []
  try {
    found.push(window.localStorage)
  } catch {
    // Blocked entirely — nothing to add.
  }
  try {
    found.push(window.sessionStorage)
  } catch {
    // Same.
  }
  return found
}

export function read(key: string): string | null {
  for (const store of stores()) {
    try {
      const value = store.getItem(key)
      if (value) return value
    } catch {
      // Try the next one.
    }
  }
  return null
}

export function write(key: string, value: string): boolean {
  let written = false
  for (const store of stores()) {
    try {
      store.setItem(key, value)
      written = true
    } catch {
      // Try the next one.
    }
  }
  return written
}

export function forget(key: string): void {
  for (const store of stores()) {
    try {
      store.removeItem(key)
    } catch {
      // Nothing to do: the value was never stored in the first place.
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A value only becomes this device's identity if it could be one (О-8). */
export function isIdentifier(value: string | null): value is string {
  return value !== null && UUID.test(value)
}

/** Read by the API client on every request — memory first, storage only to seed it. */
export function currentIdentity(): string | null {
  if (current === null) {
    const stored = read(KEY)
    if (isIdentifier(stored)) current = stored
  }
  return current
}

/** Returns whether the value outlived this tab: false means storage refused it. */
export function rememberIdentity(id: string): boolean {
  current = id
  return write(KEY, id)
}

/**
 * Sets aside an identifier the server stopped recognising instead of deleting it. A 401 is
 * not proof that the row is gone — a database restored from the wrong backup, an API
 * pointed at the wrong place, a proxy in front of it — and after such a mistake is fixed
 * the identifier would work again, if anything still held it (О-2).
 *
 * The stored key is cleared **only if it still holds the value being set aside**. Two tabs
 * that both meet a 401 would otherwise race: the slower one would delete the identifier the
 * faster one had already created, and the person would end the session with a third one and
 * the second unreachable (С-9).
 */
export function setAsideIdentity(id: string): void {
  write(LOST_KEY, id)
  if (current === id) current = null
  if (read(KEY) === id) forget(KEY)
}

export function lostIdentity(): string | null {
  return read(LOST_KEY)
}

/** Puts a set-aside identifier back, so «recoverable» is something a person can act on. */
export function restoreIdentity(): string | null {
  const id = lostIdentity()
  if (!isIdentifier(id)) return null

  current = id
  write(KEY, id)
  forget(LOST_KEY)
  return id
}

/**
 * The invite code travels in the link once and then lives on the device. The query is
 * scrubbed on every start rather than only while creating an identity: a device that
 * already has one, opened from the same link again, used to keep `?c=` in the address bar —
 * and from there it goes into history, into screenshots, into the `start_url` of an
 * installed PWA and into every `Referer` the page sends (О-17, М-20).
 */
export function takeInviteCodeFromUrl(): void {
  const url = new URL(window.location.href)
  const fromLink = url.searchParams.get('c')
  if (!fromLink) return

  invite = fromLink
  write(INVITE_KEY, fromLink)
  url.searchParams.delete('c')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

export function inviteCode(): string | null {
  takeInviteCodeFromUrl()
  invite ??= read(INVITE_KEY)
  return invite
}

/** A code the door refused is worse than no code: it turns every retry into the same 401. */
export function forgetInviteCode(): void {
  invite = null
  forget(INVITE_KEY)
}

export const IDENTITY_KEY = KEY
