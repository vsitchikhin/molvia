import type { StyleValue } from 'vue'

const letters = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * A capital Latin letter and a minus are wider than a figure: «−999,99 RSD» was 0.568 of its size a character
 * against `figure-fit`'s 0.56, and stood 3 px past its card (adversarial Б3 of MOL-321). Counted a little more,
 * they keep the share under it — 0.539 there — and a sum of figures alone is counted as before.
 */
const WIDE = /^[A-Z−-]$/u
const WIDE_WEIGHT = 1.15

/**
 * How many characters a figure is, for `@include figure-fit` (MOL-321): CSS cannot count them, and a figure
 * shrinks to its box by its length. Counted as the eye sees them — «֏» is one, as is «≈» — the wide ones a
 * little more.
 */
export function figureChars(text: string): StyleValue {
  let count = 0
  for (const { segment } of letters.segment(text.trim()))
    count += WIDE.test(segment) ? WIDE_WEIGHT : 1
  return { '--figure-chars': String(Math.round(count * 100) / 100) }
}
