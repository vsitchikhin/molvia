import type { StyleValue } from 'vue'

const letters = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

type Widths = Readonly<{ figure: number; other: number; chars: Readonly<Record<string, number>> }>

/**
 * How wide a character is, a share of its size, with tabular figures (adversarial В2, Г2 of MOL-321). A count of
 * characters at some 0.55 held only where spaces and commas pulled the share down — «֏125,403» was 0.578 — so a
 * figure is measured by what it is made of. Anything not listed counts as a capital, the widest a figure holds.
 *
 * `display` is the figures' face, Dram and Nunito at 800 — a card's answer (`--text-figure`); `text` the words'
 * face, Dram and Onest at 600 — a sum in a row, `figure-fit(1em)`: its figure is 0.673, 12 % wider.
 */
const FACES: Readonly<Record<'display' | 'text', Widths>> = {
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
      '≈': 0.661,
      '֏': 0.765,
      '₽': 0.661,
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
      '≈': 0.633,
      '֏': 0.747,
      '₽': 0.633,
      $: 0.673,
      '€': 0.709,
      '₾': 0.75,
    },
  },
}

/** The measures are of one engine: a little room for another's rounding and kerning. */
const ROOM = 1.03

/**
 * How wide a figure is in its own size, for `@include figure-fit` (MOL-321): CSS cannot measure text, and a
 * figure shrinks to its box by its width. Counted as the eye sees the characters — «֏» is one — each by its
 * width in the face the figure is set in.
 */
export function figureChars(text: string, face: 'display' | 'text' = 'display'): StyleValue {
  const { figure, other, chars } = FACES[face]
  let width = 0
  for (const { segment } of letters.segment(text.trim()))
    width += /^\d$/.test(segment) ? figure : (chars[segment] ?? other)
  return { '--figure-width': String(Math.round(width * ROOM * 1000) / 1000) }
}
