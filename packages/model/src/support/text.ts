import { z } from 'zod'
import { ISSUE } from './errors'

// Categories are listed rather than taken as \p{C}, which also matches Cn — unassigned —
// and shrinks with every Unicode version: the same name would then be valid in a browser
// with a newer ICU and rejected by the API. Cs is here because a lone surrogate does not
// encode to UTF-8 and Postgres answers 22021, the same as it does to NUL; Co because a
// private-use character is drawn differently by every font, or not at all.
const FORBIDDEN = /[\p{Cc}\p{Cs}\p{Co}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u

// Not content, but not forbidden either: U+200D joins every composite emoji, and a mark
// after a letter is ordinary text — «Молокó», Armenian and Vietnamese diacritics. Both are
// dropped before asking whether anything is left, so a string of marks alone is not a name.
const BLANK = /[\p{Z}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu
const MARK = /\p{M}/gu

export function visibleLine(max: number): z.ZodType<string, string> {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (text) => !FORBIDDEN.test(text) && text.replace(BLANK, '').replace(MARK, '').length > 0,
      {
        error: ISSUE.TEXT_NOT_VISIBLE,
      },
    )
}
