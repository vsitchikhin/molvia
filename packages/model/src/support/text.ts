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

// One class for the ends of an identity: what `.trim()` removes and what draws nothing, together.
// Two passes in turn missed an invisible character with a line break after it — the first pass
// looked for it at the end, the second made it the end (MOL-21, adversarial round 2, А).
const EDGE = /[\s\p{Z}\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/u
const PICTOGRAPH = /\p{Extended_Pictographic}/u
// U+FE00–FE0F and the supplementary selectors: they choose how the character before is drawn.
const SELECTOR = /[︀-️\u{E0100}-\u{E01EF}]/u
// Tags spell a subdivision flag after 🏴 and end with U+E007F.
const TAG = /[\u{E0020}-\u{E007F}]/u
const BLACK_FLAG = '\u{1F3F4}'

/**
 * Whether the last characters, invisible themselves, are part of how the one before them is
 * drawn: VS16 makes ☕ an emoji, a tag sequence makes 🏴 Scotland. Cutting those changes what the
 * person typed (adversarial round 2, Б). After a letter a selector draws nothing and goes.
 */
function drawsTheEnd(chars: readonly string[], end: number): boolean {
  let at = end
  const last = chars[at]
  if (last === undefined) return false
  if (SELECTOR.test(last)) return at > 0 && PICTOGRAPH.test(chars[at - 1] ?? '')
  if (!TAG.test(last)) return false
  while (at > 0 && TAG.test(chars[at] ?? '')) at -= 1
  return chars[at] === BLACK_FLAG
}

/** The line with nothing invisible at its ends, keeping only what draws the last character. */
export function trimInvisibleEdges(text: string): string {
  const chars = Array.from(text)
  let start = 0
  let end = chars.length - 1
  // At the start nothing precedes, so nothing there can be part of a drawing.
  while (start <= end && EDGE.test(chars[start] ?? '')) start += 1
  while (end >= start && EDGE.test(chars[end] ?? '') && !drawsTheEnd(chars, end)) end -= 1
  return chars.slice(start, end + 1).join('')
}

/**
 * A line with nothing invisible at its ends, not only no spaces. `.trim()` knows `\s`; a name
 * pasted from a map or a messenger can end in a word joiner, a soft hyphen or a braille blank,
 * which draw nothing and still make a second «Ереван Сити» nobody can tell from the first
 * (MOL-21, adversarial Д). For names that are an identity — a place — where a character no one
 * can see must not be one.
 */
export function visibleIdentityLine(
  max: number,
): z.ZodCodec<z.ZodString, z.ZodType<string, string>> {
  return z.codec(z.string(), visibleLine(max), {
    decode: trimInvisibleEdges,
    encode: (text) => text,
  })
}
