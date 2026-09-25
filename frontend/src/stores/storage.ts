/**
 * Every touch of browser storage in this app goes through here, and nothing else in
 * `src/` is allowed to reach for `window.localStorage` directly.
 *
 * Two reasons, both learned the hard way. Reaching for the property itself throws when
 * storage is blocked outright — disabled cookies, an embedded WebView, a corporate policy —
 * so one unguarded access was enough to reject the whole start and leave a blank screen.
 * And writes throw in Safari's private mode while reads keep working, so «it is stored»
 * and «it is remembered» are different questions everywhere they are asked.
 *
 * `sessionStorage` is the second shelf rather than a fallback of last resort: it survives a
 * reload in the same tab, which is the difference between one identity per launch and one
 * per session on a device that cannot write to disk at all.
 */

function shelves(): Storage[] {
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

/**
 * `ownFirst` asks this window's own shelf before the shared one. What a draft is for is the
 * window that is editing it, and two windows write one key: without this a reload of the one
 * editing the city came back holding the other one's currency, and «the answer may have been
 * lost» could be overwritten by a neighbour that never sent anything (MOL-65, review 3).
 * The shared shelf still answers when the window has nothing of its own — a new launch.
 */
export function read(key: string, ownFirst = false): string | null {
  const order = shelves()
  for (const shelf of ownFirst ? order.reverse() : order) {
    try {
      const value = shelf.getItem(key)
      if (value) return value
    } catch {
      // Try the next one.
    }
  }
  return null
}

/** Returns whether the value outlived this tab: false means every shelf refused it. */
export function write(key: string, value: string): boolean {
  let written = false
  for (const shelf of shelves()) {
    try {
      shelf.setItem(key, value)
      written = true
    } catch {
      // Try the next one.
    }
  }
  return written
}

/**
 * Writes to every shelf, and says whether **every** one took it. `write` is content with any
 * shelf — right for a value that only has to outlive the tab. It is wrong for one that is read
 * back to decide what to do: `read` prefers the first shelf, and a `localStorage` that refused
 * the write still answers with what it held before, while `sessionStorage` moved on. The trip
 * queue read its own past that way and sent one purchase in a loop (MOL-24, adversarial Б3).
 *
 * What a refusing shelf keeps is `salvage`'s to say, from what it held: the part of its past that
 * is still true. All of it — nothing is touched, as nothing can be written anyway; a part — the
 * key is removed, which needs no quota, and the part written back into the room that freed; none
 * — the key is removed. Without `salvage` the past is removed. Left alone, a past that is no
 * longer true is read back at the next launch (review Р-13); removed whole, a past that still is
 * goes with it (adversarial Г1).
 */
export function writeEverywhere(
  key: string,
  value: string,
  salvage?: (past: string) => string | null,
): boolean {
  const found = shelves()
  // None at all — storage blocked outright — is «nowhere», not «everywhere»: the loop below
  // would otherwise report a value kept on a device that refuses to keep anything.
  let everywhere = found.length > 0
  for (const shelf of found) {
    try {
      shelf.setItem(key, value)
    } catch {
      everywhere = false
      keepWhatIsTrue(shelf, key, salvage)
    }
  }
  return everywhere
}

function keepWhatIsTrue(
  shelf: Storage,
  key: string,
  salvage: ((past: string) => string | null) | undefined,
): void {
  try {
    const past = shelf.getItem(key)
    if (past === null) return
    const kept = salvage ? salvage(past) : null
    if (kept === past) return
    shelf.removeItem(key)
    if (kept !== null) shelf.setItem(key, kept)
  } catch {
    // Nothing more to do: this shelf refuses everything.
  }
}

export function forget(key: string): void {
  for (const shelf of shelves()) {
    try {
      shelf.removeItem(key)
    } catch {
      // Nothing to do: the value was never stored in the first place.
    }
  }
}

/**
 * Removes every key that `match` accepts, from every shelf — the one sweep that does not name
 * its keys one by one (MOL-57). Keys are collected before any is removed: `Storage.key(i)` shifts
 * under a removal, and walking it while deleting skips every other key.
 */
export function forgetWhere(match: (key: string) => boolean): void {
  for (const shelf of shelves()) {
    try {
      const keys: string[] = []
      for (let index = 0; index < shelf.length; index += 1) {
        const key = shelf.key(index)
        if (key !== null && match(key)) keys.push(key)
      }
      for (const key of keys) shelf.removeItem(key)
    } catch {
      // A shelf that refuses to be read holds nothing this app could have written.
    }
  }
}

/**
 * Rewrites one key on every shelf that holds it, each from its own value: `change` answers what
 * that shelf should keep, `null` for nothing. Each shelf separately, because two shelves may hold
 * different values under one key — the shared one and this window's own (MOL-57).
 */
export function reshape(key: string, change: (value: string) => string | null): void {
  for (const shelf of shelves()) {
    try {
      const value = shelf.getItem(key)
      if (value === null) continue
      const kept = change(value)
      if (kept === null) shelf.removeItem(key)
      else if (kept !== value) shelf.setItem(key, kept)
    } catch {
      // Nothing to do: this shelf refuses to be read or written.
    }
  }
}

/** A list, kept as JSON, for the one thing there can be more than one of: lost identities. */
export function readList(key: string): string[] {
  const raw = read(key)
  if (!raw) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    // Written by an older version as a bare string, or corrupted by something else. One
    // value is still better than none: it is somebody's data behind it.
    return [raw]
  }
}

export function writeList(key: string, values: readonly string[]): void {
  if (values.length === 0) {
    forget(key)
    return
  }
  write(key, JSON.stringify(values))
}
