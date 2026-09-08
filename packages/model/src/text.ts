import { z } from 'zod'
import { ISSUE } from './errors'

// Characters that occupy a name without showing in it. `trim()` removes none of them, so
// two zero-width spaces used to be a valid product name — a catalogue row invisible in
// the list it appears in.
const INVISIBLE = /^[\s\u00ad\u180e\u200b-\u200f\u2060\ufeff]*$/
const CONTROL = /[\n\r\t]/

/**
 * A line a person will read: at least one character that actually shows, and no line
 * break. Length is per field, because a name and a review are not the same thing.
 */
export function visibleLine(max: number): z.ZodType<string> {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => !INVISIBLE.test(text) && !CONTROL.test(text), {
      error: ISSUE.TEXT_NOT_VISIBLE,
    })
}
