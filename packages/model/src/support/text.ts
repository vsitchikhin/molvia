import { z } from 'zod'
import { ISSUE } from '#model/support/errors'

// Categories are listed rather than taken as \p{C}, which also matches Cn — unassigned —
// and shrinks with every Unicode version: the same name would then be valid in a browser
// with a newer ICU and rejected by the API. Format characters are not forbidden, because
// U+200D joins every composite emoji, but they do not count as content either.
const FORBIDDEN = /[\p{Cc}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u
const BLANK = /[\p{Z}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu

export function visibleLine(max: number): z.ZodType<string, string> {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => !FORBIDDEN.test(text) && text.replace(BLANK, '').length > 0, {
      error: ISSUE.TEXT_NOT_VISIBLE,
    })
}
