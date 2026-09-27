import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

/** What the back button says: where it leads, the word «Back», or nothing beside the chevron. */
export type BackLabelFit = 'full' | 'short' | 'none'

/**
 * The ladder iOS uses (MOL-75, owner's decision В-1): the parent's title whole, else «Back»,
 * else the chevron alone — never a fragment. «Trip…» reads as «Trip», which is not where
 * the chevron leads, and «Н…» reads as nothing. `room` is what the button leaves for its
 * label; the other two are the widths of the labels as drawn.
 */
export function backLabelFit(room: number, full: number, short: number): BackLabelFit {
  if (full <= room) return 'full'
  if (short <= room) return 'short'
  return 'none'
}

/** The elements the label is measured by. Everything but the column arrives with the chevron. */
export interface BackLabelParts {
  /** The row's leading column: the button may take all of it and no more. */
  column: Ref<HTMLElement | null>
  button: Ref<HTMLElement | null>
  /** What stands before the label in the button, and does not give way. */
  chevron: Ref<Element | null>
  /** Both labels drawn unseen in the button's type, so a width is known before it is shown. */
  full: Ref<HTMLElement | null>
  short: Ref<HTMLElement | null>
}

/**
 * Which label fits, kept current. The column narrows when the small title comes into the row
 * and widens when it leaves (MOL-75, В-2), a turned phone moves it, a font that loads late or
 * another language changes the labels — every one of those is a change of size, so a single
 * observer on the column and the two samples hears them all. Its callbacks come after layout
 * and before paint, so the label a narrowed column cannot hold is never drawn.
 *
 * Where the platform cannot observe a size the label stays whole, and the ellipsis on it keeps
 * it inside its column.
 */
export function useBackLabel(parts: BackLabelParts): Ref<BackLabelFit> {
  const fit = ref<BackLabelFit>('full')
  let observer: ResizeObserver | undefined

  function measure(): void {
    const { column, button, chevron, full, short } = parts
    if (!column.value || !button.value || !chevron.value || !full.value || !short.value) return
    const gap = Number.parseFloat(getComputedStyle(button.value).columnGap) || 0
    const lead =
      chevron.value.getBoundingClientRect().right - button.value.getBoundingClientRect().left + gap
    fit.value = backLabelFit(
      column.value.clientWidth - lead,
      full.value.offsetWidth,
      short.value.offsetWidth,
    )
  }

  function connect(): void {
    observer?.disconnect()
    observer = undefined
    fit.value = 'full'
    const { column, full, short } = parts
    if (!column.value || !full.value || !short.value) return
    measure()
    if (typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(measure)
    for (const target of [column.value, full.value, short.value]) observer.observe(target)
  }

  onMounted(connect)
  // The chevron comes and goes with the parent: a section has none, and the same frame may
  // later draw a screen that has.
  watch([parts.column, parts.full, parts.short], connect, { flush: 'post' })

  onBeforeUnmount(() => {
    observer?.disconnect()
  })

  return fit
}
