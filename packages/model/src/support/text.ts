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
// U+2800, U+13441 and U+1D159 are assigned glyphs that draw an empty cell. Unicode has no
// property for «draws nothing», so this list is knowingly incomplete: a character found
// later is added here, not worked around.
const BLANK = /[\p{Z}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800\u{13441}\u{1D159}]/gu
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

/**
 * A line is blank when nothing on it draws — by the same measure `visibleLine` applies to a
 * whole name, not by `\s`: a line of U+2800, a zero-width space or a lone combining mark is as
 * empty on the card as a line of spaces, and a rule that knew only `\s` let twenty of them in.
 */
function isBlankLine(line: string): boolean {
  // A forbidden character is not «nothing»: U+202E is `Cf` and would count as blank, and a
  // line of it at an edge was dropped in silence while the same character inside a line is
  // refused. The rule must not depend on where the character stands.
  if (FORBIDDEN.test(line)) return false
  return line.replace(BLANK, '').replace(MARK, '').replace(/\s/gu, '').length === 0
}

/**
 * Blank lines at either end go the way `trim` sends spaces: they would only pad the card.
 * One slice over indices, not `shift()` in a loop — that moved the whole array per line, and
 * four hundred thousand empty lines at the head held the event loop for a minute.
 */
function withoutBlankEdges(text: string): string {
  const lines = text.split('\n')
  let first = 0
  let last = lines.length
  while (first < last && isBlankLine(lines[first] ?? '')) first += 1
  while (last > first && isBlankLine(lines[last - 1] ?? '')) last -= 1
  return lines.slice(first, last).join('\n')
}

function hasBlankRun(text: string): boolean {
  let run = 0
  for (const line of text.split('\n')) {
    run = isBlankLine(line) ? run + 1 : 0
    if (run > 1) return true
  }
  return false
}

/**
 * `visibleLine` that may break into lines — for a review, typed into a three-row textarea.
 *
 * `\n` is the only control character let through, and every line ending becomes it first:
 * the same review typed on Windows and on a phone is then one string, and a lone `\r` —
 * which draws nothing and moves the caret back over the text — cannot slip in as an ending.
 * One empty line between paragraphs is writing; two are a gap the screen would show as a
 * hole in the card, so a run of them is refused rather than silently squeezed.
 */
export function visibleText(max: number): z.ZodType<string, string> {
  return (
    z
      .string()
      // The length as sent, before anything is folded or dropped: otherwise a body of any size
      // reaches the normalisation whole and is measured only after it. Twice the bound leaves
      // room for `\r\n` endings and padding around a review that fits; nothing longer can.
      // `abort`, because zod runs the checks after a failed one too.
      .max(2 * max, { abort: true })
      .overwrite((text) => withoutBlankEdges(text.replace(/\r\n?/g, '\n')))
      .trim()
      // Nothing left after the edges went: the text had nothing visible, and says so by name.
      .min(1, { error: ISSUE.TEXT_NOT_VISIBLE })
      .max(max)
      .refine(
        (text) => {
          const flat = text.replaceAll('\n', '')
          return !FORBIDDEN.test(flat) && !hasBlankRun(text) && !isBlankLine(flat)
        },
        {
          error: ISSUE.TEXT_NOT_VISIBLE,
        },
      )
  )
}
