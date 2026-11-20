import { api } from '@/api'
import { read, write } from '@/stores/storage'

/** The moment this device last tapped it: a repeat within a day is the same person, as the login's (MOL-68). */
const KEY = 'molvia.rf-card'
const DAY_MS = 24 * 60 * 60 * 1000

/** Whether this device tapped within the day before `now`; a moment from the future is no repeat. */
export function tappedWithinDay(kept: string | null, now: number): boolean {
  const at = Number(kept)
  return Number.isFinite(at) && at <= now && now - at < DAY_MS
}

/**
 * A tap of «У меня только карта РФ» counted (MOL-277, Р-8): by the day, nobody named — how many come to pay with such a
 * card alone decides whether to look for a way. The device says its own repeat within a day; the server knows the
 * account's too. Sent once a tap, never retried: a count lost is a count, not a person's data.
 */
export function useRfCardTap(): () => void {
  return () => {
    const now = Date.now()
    const again = tappedWithinDay(read(KEY), now)
    write(KEY, String(now))
    api.rfCardTap(again).catch(() => undefined)
  }
}
