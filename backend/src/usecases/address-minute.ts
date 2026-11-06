const MINUTE_MS = 60 * 1000

/**
 * Whether `count` more from `address` fit the rolling minute, and if they do, counted — the phone's
 * reports (MOL-144, Р-6) and the login's starts (MOL-359). In the process's memory, for a minute, and
 * nowhere else: the address is the limit's key and never written down — no log, no table. What was
 * refused is not counted, so the memory holds at most the minute's `perMinute`. **The minute is let go
 * by `forget` on the minute timer too** (MOL-241, adversarial А1): cleared only by the next request, the
 * last address before a quiet spell stayed until somebody else's came — on production before 0.2, for
 * days.
 */
export interface AddressMinute {
  (address: string, count: number, now: number): boolean
  /** Lets go of every address with nothing in the minute before `now` (MOL-241). */
  forget(now: number): void
}

export function addressMinute(perAddress: number, perMinute: number): AddressMinute {
  const taken = new Map<string, { readonly at: number; readonly count: number }[]>()
  const sum = (entries: readonly { readonly count: number }[]) =>
    entries.reduce((total, entry) => total + entry.count, 0)
  const forget = (now: number) => {
    for (const [address, entries] of taken) {
      const recent = entries.filter((entry) => now - entry.at < MINUTE_MS)
      if (recent.length === 0) taken.delete(address)
      else taken.set(address, recent)
    }
  }
  const limit = (address: string, count: number, now: number) => {
    forget(now)
    const mine = sum(taken.get(address) ?? [])
    const all = [...taken.values()].reduce((total, entries) => total + sum(entries), 0)
    if (mine + count > perAddress || all + count > perMinute) return false
    taken.set(address, [...(taken.get(address) ?? []), { at: now, count }])
    return true
  }
  return Object.assign(limit, { forget })
}
