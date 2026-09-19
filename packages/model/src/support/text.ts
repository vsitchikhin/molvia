import { z } from 'zod'
import { ISSUE } from './errors'

// Categories are listed rather than taken as \p{C}, which also matches Cn — unassigned —
// and shrinks with every Unicode version: the same name would then be valid in a browser
// with a newer ICU and rejected by the API. Cs is here because a lone surrogate does not
// encode to UTF-8 and Postgres answers 22021, the same as it does to NUL; Co because a
// private-use character is drawn differently by every font, or not at all.
const FORBIDDEN = /[\p{Cc}\p{Cs}\p{Co}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u

/**
 * What draws nothing, as the body of a character class — the one definition both sides of an
 * item use: `visibleLine` strips it before asking whether a name has content, and
 * `toSearchKey` strips it from the key. Two copies drifted once (MOL-12, the Hangul fillers)
 * and again in MOL-27, when U+13441 joined the name's list only and «𓑁!» became a name whose
 * key its own schema refused — a 500 from «Предложить товар».
 *
 * U+2800, U+13441 and U+1D159 are assigned glyphs that draw an empty cell. Unicode has no
 * property for «draws nothing», so the list is knowingly incomplete: a character found later
 * is added here, once, and reaches both sides. It shapes the stored key, so an addition after
 * the first key is stored needs a migration (CLAUDE.md, «The tables are frozen»).
 */
export const INVISIBLE = String.raw`\p{Cf}\p{Default_Ignorable_Code_Point}\u2800\u{13441}\u{1D159}`

// Not content, but not forbidden either: U+200D joins every composite emoji, and a mark
// after a letter is ordinary text — «Молокó», Armenian and Vietnamese diacritics. Both are
// dropped before asking whether anything is left, so a string of marks alone is not a name.
const BLANK = new RegExp(`[\\p{Z}${INVISIBLE}]`, 'gu')
const MARK = /\p{M}/gu

export function visibleLine(max: number): z.ZodType<string, string> {
  return (
    z
      .string()
      .trim()
      // Blank after the trim is the same verdict as blank after the refine, and names itself
      // the same way — a generic «too small» told the screen nothing (MOL-27, С-17).
      .min(1, { error: ISSUE.TEXT_NOT_VISIBLE })
      .max(max)
      .refine(
        (text) => !FORBIDDEN.test(text) && text.replace(BLANK, '').replace(MARK, '').length > 0,
        {
          error: ISSUE.TEXT_NOT_VISIBLE,
        },
      )
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
      // Whitespace at the ends first — linear, and it cannot change what the text says — so
      // that padding never decides the answer: a review of spaces is «nothing visible» at any
      // length, and 500 letters followed by 501 spaces is 500 letters.
      .trim()
      // Then the length, before anything is split or folded: otherwise a body of any size
      // reaches the normalisation whole, and four hundred thousand empty lines held the event
      // loop for a minute. Twice the bound leaves room for `\r\n` endings and invisible edge
      // lines around a review that fits; past it the text is too long whatever it holds.
      // `abort`, because zod runs the later checks too.
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
