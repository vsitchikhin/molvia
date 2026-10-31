import type { StyleValue } from 'vue'

const letters = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * How wide a character of the figures' face is, a share of its size — Dram and Nunito at 800 with tabular
 * figures, measured in Chromium (adversarial В2 of MOL-321): a figure is 0.600, and a count of characters
 * at some 0.55 held only where spaces and commas pulled the share down — «֏125,403» was 0.578. Anything not
 * here counts as a capital letter, the widest a figure holds.
 */
const WIDTH: Readonly<Record<string, number>> = {
  ' ': 0.279,
  ' ': 0.279,
  ' ': 0.139,
  ',': 0.26,
  '.': 0.26,
  '-': 0.44,
  '−': 0.6,
  '+': 0.6,
  '%': 0.75,
  '/': 0.4,
  '≈': 0.661,
  '֏': 0.765,
  '₽': 0.661,
  $: 0.6,
  '€': 0.6,
  '₾': 0.773,
}
const FIGURE = 0.6
const OTHER = 0.78

/** The measures are of one engine: a little room for another's rounding and kerning. */
const ROOM = 1.03

/**
 * How wide a figure is in its own size, for `@include figure-fit` (MOL-321): CSS cannot measure text, and a
 * figure shrinks to its box by its width. Counted as the eye sees the characters — «֏» is one — each by its
 * width in the face.
 */
export function figureChars(text: string): StyleValue {
  let width = 0
  for (const { segment } of letters.segment(text.trim()))
    width += /^\d$/.test(segment) ? FIGURE : (WIDTH[segment] ?? OTHER)
  return { '--figure-width': String(Math.round(width * ROOM * 1000) / 1000) }
}
