/**
 * Who this device is, and the only place anything reads it from. The client needs the
 * identifier at request time, the store owns its lifecycle, and the two used to reach for
 * storage separately — so a device that could not write kept a perfectly good identifier in
 * memory and sent every request without it (adversarial О-3).
 *
 * Storage is a cache of these values, not the values themselves: `stores/storage.ts` holds
 * the guarded access, and nothing outside this module needs it.
 */
import { read, readList, write, writeList } from '@/stores/storage'

const KEY = 'molvia.actor'
/** Identifiers the server stopped recognising. A list: a second loss must not erase the first. */
const LOST_KEY = 'molvia.actor.lost'
/** How many are worth keeping — enough for a week of mistakes, not a log. */
const LOST_LIMIT = 5

/** What this device is right now. `null` until the first visit succeeds. */
let current: string | null = null

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

/** Identifiers set aside, newest last. */
export function lostIdentities(): string[] {
  return readList(LOST_KEY).filter((value) => isIdentifier(value))
}

/**
 * Sets an identifier aside instead of deleting it. A 401 is not proof that the row is gone
 * — a database restored from the wrong backup, an API pointed at the wrong place, a proxy
 * in front of it — and after such a mistake is fixed the identifier would work again, if
 * anything still held it (О-2).
 *
 * Appended to a list rather than written over the previous one: two resets in a week used
 * to leave only the second identity recoverable, and the first — the one with the real
 * trips behind it — gone for good (Р-2).
 *
 * The stored key is cleared **only if it still holds this value**. Two tabs that both meet
 * a 401 would otherwise race: the slower would delete the identifier the faster had just
 * created, and the person would end the session with a third one (С-9).
 */
export function setAsideIdentity(id: string): void {
  const kept = lostIdentities().filter((value) => value !== id)
  writeList(LOST_KEY, [...kept, id].slice(-LOST_LIMIT))

  if (current === id) current = null
  if (read(KEY) === id) forgetStoredIdentity(id)
}

function forgetStoredIdentity(id: string): void {
  if (read(KEY) === id) write(KEY, '')
  // An empty string is what `read` treats as absent, and writing it is safer than removing
  // the key: a shelf that refused the write leaves the old value, and a half-forgotten
  // identity is better than one silently resurrected on the next read.
}

/**
 * Makes a set-aside identifier the current one. Called **only after** the server has agreed
 * that it is alive: the previous identity is set aside in its place, so nothing is thrown
 * away by a restore that turns out to be wrong (Р-1, С-11).
 */
export function commitRestore(id: string): void {
  const previous = currentIdentity()
  if (previous && previous !== id) {
    const kept = lostIdentities().filter((value) => value !== previous)
    writeList(LOST_KEY, [...kept, previous].slice(-LOST_LIMIT))
  }

  writeList(
    LOST_KEY,
    lostIdentities().filter((value) => value !== id),
  )
  current = id
  write(KEY, id)
}

export const IDENTITY_KEY = KEY
