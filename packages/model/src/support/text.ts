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
const EDGE = /[\s\p{Z}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u
const PICTOGRAPH = /\p{Extended_Pictographic}/u
// U+FE00–FE0F and the supplementary selectors: they choose how the character before is drawn.
const SELECTOR = /[\ufe00-\ufe0f\u{E0100}-\u{E01EF}]/u
// Tags spell a subdivision flag after 🏴: letters or digits of the subdivision, then U+E007F.
const TAG = /[\u{E0020}-\u{E007F}]/u
const FLAG_TAG = /[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]/u
const CANCEL_TAG = '\u{E007F}'
const BLACK_FLAG = '\u{1F3F4}'

/** Whether `chars[first..end]` is the tag spelling of a flag, right after a 🏴. */
function isFlag(chars: readonly string[], first: number, end: number): boolean {
  if (chars[first - 1] !== BLACK_FLAG || chars[end] !== CANCEL_TAG || end - first < 1) return false
  for (let at = first; at < end; at += 1) if (!FLAG_TAG.test(chars[at] ?? '')) return false
  return true
}

/**
 * The line with nothing invisible at its ends, keeping only what draws the last character: VS16
 * after an emoji makes ☕ an emoji, a tag sequence makes 🏴 Scotland (adversarial round 2, Б).
 * After a letter a selector draws nothing and goes; a run of tags that spells no flag goes whole.
 *
 * Linear on purpose: each run of tags is walked once. The first version looked back over the
 * whole run for every tag it cut, and a megabyte of tags held the event loop for eleven minutes
 * (adversarial round 3, А) — the length is also bounded before this runs, by the codec below.
 */
export function trimInvisibleEdges(text: string): string {
  const chars = Array.from(text)
  let start = 0
  let end = chars.length - 1
  // At the start nothing precedes, so nothing there can be part of a drawing.
  while (start <= end && EDGE.test(chars[start] ?? '')) start += 1

  while (end >= start) {
    const last = chars[end] ?? ''
    if (!EDGE.test(last)) break
    if (SELECTOR.test(last)) {
      if (end > start && PICTOGRAPH.test(chars[end - 1] ?? '')) break
      end -= 1
    } else if (TAG.test(last)) {
      let first = end
      while (first > start && TAG.test(chars[first - 1] ?? '')) first -= 1
      if (isFlag(chars, first, end)) break
      end = first - 1
    } else {
      end -= 1
    }
  }
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
  // Bounded before the trim, not only after it: `max` is checked on the trimmed line, and without
  // this the trim ran over the whole body (adversarial round 3, А). Twice the limit leaves room
  // for what a paste brings along at the ends.
  return z.codec(z.string().max(max * 2), visibleLine(max), {
    decode: trimInvisibleEdges,
    encode: (text) => text,
  })
}
