import { z } from 'zod'
import { ISSUE } from './errors'

// trim() removes none of these, so a name of two zero-width spaces used to be a name.
const INVISIBLE = /^[\s\u00ad\u180e\u200b-\u200f\u2060\ufeff]*$/
const CONTROL = /[\n\r\t]/

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
