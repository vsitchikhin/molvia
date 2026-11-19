// The time a screenshot of a bank's app prints beside a line (MOL-409, Ж2…Л1), as the model read it.

/** Two screenshots' times are two operations only an hour apart or more (Ж2: there and back are hours). */
export const TIME_APART_MINUTES = 60

/**
 * Digits the model confuses in the apps' fonts — measured on receipts, 5↔6 (MOL-290) — at most two a
 * time, as a receipt's figure (К1): times that differ only so are a doubt, never two operations.
 */
const GLYPH_SWAPS: ReadonlySet<string> = new Set(['56', '65'])
const GLYPH_SWAPS_PER_TIME = 2

/**
 * «14:35», «9:10 AM», «9:40 p.m.» → «HH:MM» on the 24-hour clock, AM / PM read (И2); null for none and
 * for a time that cannot be — «16:66», «25:10», «13:10 PM» is a misreading, not evidence (Л1).
 */
export function printedClock(printed: string | null): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*([ap])?\.?\s*m?\.?/i.exec((printed ?? '').trim())
  if (!m) return null
  const [, hourText = '', minuteText = '', half] = m
  const hour = Number(hourText)
  if (Number(minuteText) > 59 || hour > (half ? 12 : 23) || (half && hour === 0)) return null
  const hours = (hour % (half ? 12 : 24)) + (half?.toLowerCase() === 'p' ? 12 : 0)
  return `${String(hours).padStart(2, '0')}:${minuteText}`
}

const minutesOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3))

/** The printed times differ only by confused digits, as printed — before the 24-hour clock (К2). */
function glyphsApart(a: string, b: string): boolean {
  const [x, y] = [a.trim(), b.trim()]
  if (x.length !== y.length) return false
  const pairs: string[] = []
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) pairs.push(`${x[i] ?? ''}${y[i] ?? ''}`)
  return (
    pairs.length > 0 &&
    pairs.length <= GLYPH_SWAPS_PER_TIME &&
    pairs.every((p) => GLYPH_SWAPS.has(p))
  )
}

/** `same` — one time; `apart` — another operation; null — the times cannot tell (a doubt). */
export function printedTimesSay(a: string | null, b: string | null): 'same' | 'apart' | null {
  const [x, y] = [printedClock(a), printedClock(b)]
  if (x === null || y === null || a === null || b === null) return null
  if (x === y) return 'same'
  return Math.abs(minutesOf(x) - minutesOf(y)) >= TIME_APART_MINUTES && !glyphsApart(a, b)
    ? 'apart'
    : null
}
