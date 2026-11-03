import type { StyleValue } from 'vue'

const letters = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

type Widths = Readonly<{ figure: number; other: number; chars: Readonly<Record<string, number>> }>

type Face = 'display' | 'text' | 'strong'

/**
 * «≈» and «₽» are in none of our faces' subsets — Onest's, Nunito's or Dram's — so the phone's own fallback draws them,
 * and its width is not ours to measure: CI's image stood «≈ 1 433 318 ₽» past its tile by the faces' widths (self-review
 * 10, №1). The widest likely fallback's: DejaVu Sans draws «≈» at 0.838 of its size; «₽» is taken at 0.72.
 */
const FALLBACK_APPROX = 0.84
const FALLBACK_ROUBLE = 0.72

/**
 * How wide a character is, a share of its size, with tabular figures (adversarial В2, Г2 of MOL-321). A count of
 * characters at some 0.55 held only where spaces and commas pulled the share down — «֏125,403» was 0.578 — so a
 * figure is measured by what it is made of. Anything not listed counts as a capital, the widest a figure holds.
 *
 * `display` is the figures' face, Dram and Nunito at 800 — a card's answer (`--text-figure`); `text` the words'
 * face, Dram and Onest at 600 — a sum in a row, `figure-fit(1em)`: its figure is 0.673, 12 % wider; `strong` the same
 * face at 700 — a tile's figure.
 */
const FACES: Readonly<Record<Face, Widths>> = {
  display: {
    figure: 0.6,
    other: 0.78,
    chars: {
      ' ': 0.279,
      ' ': 0.279,
      ' ': 0.139,
      ',': 0.26,
      '.': 0.26,
      '-': 0.44,
      '−': 0.6,
      '+': 0.6,
      '%': 0.96,
      '/': 0.4,
      '≈': FALLBACK_APPROX,
      '֏': 0.765,
      '₽': FALLBACK_ROUBLE,
      $: 0.6,
      '€': 0.6,
      '₾': 0.773,
    },
  },
  text: {
    figure: 0.673,
    other: 0.8,
    chars: {
      ' ': 0.278,
      ' ': 0.278,
      ' ': 0.139,
      ',': 0.313,
      '.': 0.313,
      '-': 0.44,
      '−': 0.578,
      '+': 0.673,
      '%': 0.804,
      '/': 0.4,
      '≈': FALLBACK_APPROX,
      '֏': 0.747,
      '₽': FALLBACK_ROUBLE,
      $: 0.673,
      '€': 0.709,
      '₾': 0.75,
    },
  },
  // The words' face at 700, a tile's figure (measured 01.11.2026): its figures are 600's, its comma, «≈» and «₽» a little
  // wider — CI's Chromium stood «≈ 1 433 318 ₽» 2.3 px into its tile by the table of 600 (round 9).
  strong: {
    figure: 0.673,
    other: 0.8,
    chars: {
      ' ': 0.282,
      '\u00a0': 0.282,
      '\u202f': 0.141,
      ',': 0.335,
      '.': 0.321,
      '-': 0.45,
      '−': 0.592,
      '+': 0.673,
      '%': 0.82,
      '/': 0.41,
      '≈': FALLBACK_APPROX,
      '֏': 0.765,
      '₽': FALLBACK_ROUBLE,
      $: 0.673,
      '€': 0.724,
      '₾': 0.761,
    },
  },
}

/** The measures are of one engine: room for another's rounding and kerning — CI's Chromium sets every character on a
 *  whole pixel, and 3 % left a bold sum of fourteen 2.3 px past its tile (round 9). */
const ROOM = 1.05

/**
 * How wide a figure is in its own size, for `@include figure-fit` (MOL-321): CSS cannot measure text, and a
 * figure shrinks to its box by its width. Counted as the eye sees the characters — «֏» is one — each by its
 * width in the face the figure is set in.
 */
export function figureChars(text: string, face: Face = 'display'): StyleValue {
  return widthStyle(figureWidth(text, face))
}

/** The same width as a number, a share of the figure's size, for a figure that stands with something else. */
export function figureWidth(text: string, face: Face = 'display'): number {
  const { figure, other, chars } = FACES[face]
  let width = 0
  for (const { segment } of letters.segment(text.trim()))
    width += /^\d$/.test(segment) ? figure : (chars[segment] ?? other)
  return width
}

/** `--figure-width` of a width counted, with its room. */
export function widthStyle(width: number): StyleValue {
  return { '--figure-width': String(Math.round(width * ROOM * 1000) / 1000) }
}

/**
 * A phrase that holds a sum, cut around it, so the sum can stand as a piece of its own — whole, shrunk by
 * `figure-fit` — in the words around it (MOL-334, В-6 «а»): «В Ереван Сити брали по 125 403,50 ֏/кг» broke inside
 * the sum at 200 %. The first time the sum stands; a phrase without it is all words.
 */
export function aroundFigure(
  phrase: string,
  figure: string,
): { before: string; figure: string; after: string } {
  const at = figure === '' ? -1 : phrase.indexOf(figure)
  if (at < 0) return { before: phrase, figure: '', after: '' }
  return { before: phrase.slice(0, at), figure, after: phrase.slice(at + figure.length) }
}
