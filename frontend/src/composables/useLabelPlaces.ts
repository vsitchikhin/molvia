import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

/** The least room between two labels of a chart, in pixels: closer, they read as one word. */
export const LABEL_SPACE_PX = 8

/** A label laid from its anchor's start, or back from its end, rather than centred on it. */
export type LabelEdge = 'start' | 'end'

/** A label's box in its field, measured, in pixels from the field's top left. */
export interface LabelBox {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/**
 * Where a label `width` wide stands on its anchor — a point, `from` = `to`, or a column from `from` to `to` — in a field
 * `field` wide: centred on it, and laid from the anchor's start or back from its end only where centred it would stand
 * past the field (MOL-161 review 2, MOL-404): measured, since a threshold in thousandths knows neither width.
 */
export function laidOn(
  from: number,
  to: number,
  width: number,
  field: number,
): { left: number; right: number; edge: LabelEdge | null } {
  const centred = (from + to) / 2 - width / 2
  if (centred < 0) return { left: from, right: from + width, edge: 'start' }
  if (centred + width > field) return { left: to - width, right: to, edge: 'end' }
  return { left: centred, right: centred + width, edge: null }
}

/** Two labels stand apart: the least room between them across or one over the other (MOL-404, adversarial Б1). */
export function apart(a: LabelBox, b: LabelBox): boolean {
  return (
    a.right + LABEL_SPACE_PX <= b.left ||
    b.right + LABEL_SPACE_PX <= a.left ||
    a.bottom + LABEL_SPACE_PX <= b.top ||
    b.bottom + LABEL_SPACE_PX <= a.top
  )
}

/**
 * The places of a chart's labels, measured by `place` (MOL-404, review №8; the line of the rate's since MOL-161): again
 * whenever the field's size or a source changes, and once the face has come, since the fallback face is narrower or
 * wider. Which label gives way is the chart's own rule, in `place`; a label given way keeps its width (`visibility`)
 * and its edge, so measuring again finds the same, and a place unchanged is not written, so nothing loops.
 */
export function useLabelPlaces<T>(
  field: Ref<HTMLElement | null>,
  place: () => T,
  empty: T,
  sources: readonly WatchSource[],
): Ref<T> {
  const places = ref(empty) as Ref<T>
  let observer: ResizeObserver | undefined

  function measure(): void {
    const next = place()
    if (JSON.stringify(next) !== JSON.stringify(places.value)) places.value = next
  }

  function observe(): void {
    observer?.disconnect()
    measure()
    if (!field.value || typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(measure)
    observer.observe(field.value)
  }

  watch([field, ...sources], observe, { flush: 'post', immediate: true })
  onMounted(() => {
    // Not every engine has it: happy-dom of the component tests has not.
    if ('fonts' in document) void document.fonts.ready.then(measure)
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
  })

  return places
}
