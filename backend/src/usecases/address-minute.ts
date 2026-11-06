const MINUTE_MS = 60 * 1000

/**
 * A clock that never steps back (MOL-359, adversarial А1). The machine's wall clock does, at a
 * correction of NTP: stepped back by ten minutes, it held an address for eleven and its IP in memory
 * as long, against «через минуту» and the privacy page's «на пару минут»; stepped forward, it gave five
 * more starts in the same second.
 */
const monotonic = (): number => performance.now()

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
   * Gives back the latest `count` the address took (MOL-359, adversarial А2): a login's start that made
   * no request — the database refused it or failed — is no start of the address's.
   */
  giveBack(address: string, count: number): void
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
  const giveBack = (address: string, count: number) => {
    const entries = taken.get(address) ?? []
    const last = entries.findLastIndex((entry) => entry.count === count)
    if (last === -1) return
    const rest = entries.filter((_, index) => index !== last)
    if (rest.length === 0) taken.delete(address)
    else taken.set(address, rest)
  }
  const limit = (address: string, count: number) => {
    forget()
    const mine = sum(taken.get(address) ?? [])
    const all = [...taken.values()].reduce((total, entries) => total + sum(entries), 0)
    if (mine + count > perAddress || all + count > perMinute) return false
    taken.set(address, [...(taken.get(address) ?? []), { at: clock(), count }])
    return true
  }
  return Object.assign(limit, { giveBack, forget })
}
