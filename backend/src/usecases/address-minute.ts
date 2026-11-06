import { monotonic } from '@/clock'

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
  (address: string, count: number): boolean
  /**
   * The same, and what was taken handed back as a way to give back exactly it (MOL-359, adversarial
   * А2, Б2): a login's start the database failed made no request and is no start of the address's. It
   * gives back its own place, never a newer start's, and nothing once the minute has let it go.
   */
  take(address: string, count: number): (() => void) | null
  /** Lets go of every address with nothing in the minute before now (MOL-241). */
  forget(): void
}

export function addressMinute(
  perAddress: number,
  perMinute: number,
  clock: () => number = monotonic,
): AddressMinute {
  const taken = new Map<string, { readonly at: number; readonly count: number }[]>()
  const sum = (entries: readonly { readonly count: number }[]) =>
    entries.reduce((total, entry) => total + entry.count, 0)
  const forget = () => {
    const now = clock()
    for (const [address, entries] of taken) {
      const recent = entries.filter((entry) => now - entry.at < MINUTE_MS)
      if (recent.length === 0) taken.delete(address)
      else taken.set(address, recent)
    }
  }
  const take = (address: string, count: number) => {
    forget()
    const mine = sum(taken.get(address) ?? [])
    const all = [...taken.values()].reduce((total, entries) => total + sum(entries), 0)
    if (mine + count > perAddress || all + count > perMinute) return null
    const entry = { at: clock(), count }
    taken.set(address, [...(taken.get(address) ?? []), entry])
    return () => {
      const rest = (taken.get(address) ?? []).filter((kept) => kept !== entry)
      if (rest.length === 0) taken.delete(address)
      else taken.set(address, rest)
    }
  }
  const limit = (address: string, count: number) => take(address, count) !== null
  return Object.assign(limit, { take, forget })
}
