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

export function read(key: string): string | null {
  for (const shelf of shelves()) {
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

export function forget(key: string): void {
  for (const shelf of shelves()) {
    try {
      shelf.removeItem(key)
    } catch {
      // Nothing to do: the value was never stored in the first place.
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
