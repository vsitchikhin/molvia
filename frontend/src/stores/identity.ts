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
 * Storage throws rather than returning null in Safari's private mode, and both reads and
 * writes can fail. `sessionStorage` is tried second: it survives a reload in the same tab,
 * which is the difference between one identity per launch and one per session (О-7).
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

function read(key: string): string | null {
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

function write(key: string, value: string): boolean {
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

function forget(key: string): void {
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
 */
export function setAsideIdentity(): void {
  const id = currentIdentity()
  if (id) write(LOST_KEY, id)
  current = null
  forget(KEY)
}

export function lostIdentity(): string | null {
  return read(LOST_KEY)
}

/**
 * The invite code travels in the link once and then lives on the device. It is scrubbed
 * from the address bar straight away: the query lands in history, in screenshots, in the
 * `start_url` of an installed PWA and in every `Referer` the page sends (О-17).
 */
export function inviteCode(): string | null {
  const url = new URL(window.location.href)
  const fromLink = url.searchParams.get('c')

  if (fromLink) {
    write(INVITE_KEY, fromLink)
    url.searchParams.delete('c')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    return fromLink
  }

  return read(INVITE_KEY)
}

/** A code the door refused is worse than no code: it turns every retry into the same 401. */
export function forgetInviteCode(): void {
  forget(INVITE_KEY)
}

export const IDENTITY_KEY = KEY
