import { z } from 'zod'
import { ISSUE } from './errors'

// A letter or a digit has to survive, once the characters that render as nothing are
// dropped: a blocklist of invisible ones needs extending at every discovery, and some of
// them are letters by category — U+3164 HANGUL FILLER passes \p{L} and shows nothing.
// Controls, format characters and line separators are refused outright, NUL among them:
// Postgres `text` cannot store it, and that is the error class INT8_MAX exists for.
const BLANK = /[\p{Default_Ignorable_Code_Point}\u2800]/gu
const MEANINGFUL = /[\p{L}\p{N}]/u
const FORBIDDEN = /[\p{C}\p{Zl}\p{Zp}]/u

export function visibleLine(max: number): z.ZodType<string, string> {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => !FORBIDDEN.test(text) && MEANINGFUL.test(text.replace(BLANK, '')), {
      error: ISSUE.TEXT_NOT_VISIBLE,
    })
}
