import { z } from 'zod'
import { ISSUE } from './errors'

// Categories are listed rather than taken as \p{C}, which also matches Cn — unassigned —
// and shrinks with every Unicode version: the same name would then be valid in a browser
// with a newer ICU and rejected by the API. Cs is here because a lone surrogate does not
// encode to UTF-8 and Postgres answers 22021, the same as it does to NUL; Co because a
// private-use character is drawn differently by every font, or not at all.
// Split in two for what a paste brings along — `pastedLine` below — and joined back into the one
// list the schema refuses: a second copy of either half in a screen drifted before (MOL-23, Р-19).
// A break of any kind: controls — the tab between the cells of a spreadsheet row, a line feed,
// NEL — and the line and paragraph separators.
const BREAK = String.raw`\p{Cc}\p{Zl}\p{Zp}`
// The embeddings, overrides and isolates a chat wraps pasted text in: they draw nothing.
const DIRECTION = String.raw`\u202a-\u202e\u2066-\u2069`
const FORBIDDEN = new RegExp(String.raw`[${BREAK}\p{Cs}\p{Co}${DIRECTION}]`, 'u')
const BREAKS = new RegExp(`[${BREAK}]+`, 'gu')
const DIRECTIONS = new RegExp(`[${DIRECTION}]`, 'gu')

/**
 * Text pasted into a one-line field, made the line it was meant to be: a break of any kind becomes
 * a space and the direction marks go. Everything `FORBIDDEN` refuses that a person cannot see to
 * remove by hand is taken care of here; what is left — a private-use glyph, a lone surrogate — is
 * for the form to explain.
 */
export function pastedLine(text: string): string {
  return text.replace(BREAKS, ' ').replace(DIRECTIONS, '')
}

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

/**
 * Whether a text draws nothing — by the measure `visibleLine` applies to a name: separators, what
 * `INVISIBLE` lists and lone marks do not count. For a screen asking «is this field empty» before
 * it sends anything, so a pasted U+200B is as empty there as it is here (MOL-23).
 */
export function drawsNothing(text: string): boolean {
  return text.trim().replace(BLANK, '').replace(MARK, '').length === 0
}

export function visibleLine(max: number): z.ZodType<string, string> {
  return (
    z
      .string()
      .trim()
      // Blank after the trim is the same verdict as blank after the refine, and names itself
      // the same way — a generic «too small» told the screen nothing (MOL-27, С-17).
      .min(1, { error: ISSUE.TEXT_NOT_VISIBLE })
      .max(max)
      .refine((text) => !FORBIDDEN.test(text) && !drawsNothing(text), {
        error: ISSUE.TEXT_NOT_VISIBLE,
      })
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

/** Control characters other than the line break, which a person typing a review never means. */
const CONTROL = /[^\P{Cc}\n]/gu

/**
 * What a review looks like, made into what `visibleText` accepts, before it is sent — on the
 * phone, by the measure the server applies (MOL-28, adversarial F5, R3). A tab pasted from a
 * note is a space, a line or paragraph separator a line break, direction marks and stray control
 * characters go, a line on which nothing draws is empty, and runs of empty lines fold to one.
 * Every character that draws is kept, so nothing the person wrote is lost.
 *
 * Here and not on the screen: what counts as blank is `isBlankLine`'s to say, and a second
 * list of it on the phone would drift the way `INVISIBLE` did twice.
 */
export function tidyText(text: string): string {
  const lines = text
    .replace(/\r\n?|[\u2028\u2029]/gu, '\n')
    .replaceAll('\t', ' ')
    .replace(DIRECTIONS, '')
    .replace(CONTROL, '')
    .split('\n')
    .map((line) => (isBlankLine(line) ? '' : line))
  return lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n')
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

// One class for the ends of an identity: what `.trim()` removes and what draws nothing, together.
// Two passes in turn missed an invisible character with a line break after it — the first pass
// looked for it at the end, the second made it the end (MOL-21, adversarial round 2, А).
const EDGE = /[\s\p{Z}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u
const PICTOGRAPH = /\p{Extended_Pictographic}/u
// U+FE00–FE0F and the supplementary selectors: they choose how the character before is drawn.
const SELECTOR = /[\ufe00-\ufe0f\u{E0100}-\u{E01EF}]/u
// Tags spell a subdivision flag after 🏴 and end with U+E007F.
const TAG = /[\u{E0020}-\u{E007F}]/u
const CANCEL_TAG = '\u{E007F}'
const BLACK_FLAG = '\u{1F3F4}'
const TAG_OFFSET = 0xe0000
/**
 * The subdivision flags that are drawn — England, Scotland, Wales, the whole RGI list today. A
 * tag spelling of the right shape and no flag draws the same black 🏴 and made a second place
 * (adversarial round 4, Б). A flag Unicode adds later is one more line here.
 */
const DRAWN_FLAGS: ReadonlySet<string> = new Set(['gbeng', 'gbsct', 'gbwls'])

/** Whether `chars[first..end]` spells a flag that is drawn, right after a 🏴. */
function isFlag(chars: readonly string[], first: number, end: number): boolean {
  if (chars[first - 1] !== BLACK_FLAG || chars[end] !== CANCEL_TAG) return false
  const spelled = chars
    .slice(first, end)
    .map((tag) => String.fromCodePoint((tag.codePointAt(0) ?? 0) - TAG_OFFSET))
    .join('')
  return DRAWN_FLAGS.has(spelled)
}

/**
 * The line with nothing invisible at its ends, keeping only what draws the last character: VS16
 * after an emoji makes ☕ an emoji, a tag sequence makes 🏴 Scotland (adversarial round 2, Б).
 * After a letter a selector draws nothing and goes; a run of tags that is no drawn flag goes whole.
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
