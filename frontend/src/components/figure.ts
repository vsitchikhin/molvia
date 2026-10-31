import type { StyleValue } from 'vue'

const letters = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * How many characters a figure is, for `@include figure-fit` (MOL-321): CSS cannot count them, and a figure
 * shrinks to its box by its length. Counted as the eye sees them — «֏» is one, as is «≈».
 */
export function figureChars(text: string): StyleValue {
  return { '--figure-chars': String([...letters.segment(text.trim())].length) }
}
