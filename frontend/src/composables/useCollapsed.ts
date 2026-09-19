import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

/**
 * Whether the large title has scrolled away.
 *
 * An observer on a 1px sentinel, not a scroll listener: the browser reports the crossing, the
 * page does no work per frame. The line the sentinel crosses is given by the screen: the bottom
 * edge of a pinned row, or the top of the window where the row takes no room. Collapsing never
 * moves it — a row that shrank on collapse would pull the content up, bring the sentinel back
 * and flip itself open again — but other things do: the row can appear after mount, and a
 * turned phone changes the notch above it. Whenever the line moves, the observer is set up again
 * against the new one.
 *
 * Only a sentinel gone *above* that line counts. One below the fold is out of view too, and
 * without the check a screen opened scrolled to the bottom would claim a title it shows.
 */
export function useCollapsed(sentinel: Ref<HTMLElement | null>, line: Ref<number>): Ref<boolean> {
  const collapsed = ref(false)
  let observer: IntersectionObserver | undefined

  function connect(): void {
    observer?.disconnect()
    observer = undefined
    if (!sentinel.value || typeof IntersectionObserver === 'undefined') return

    const edge = line.value
    observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        const top = entry.rootBounds?.top ?? edge
        collapsed.value = !entry.isIntersecting && entry.boundingClientRect.top < top
      },
      { rootMargin: `-${String(edge)}px 0px 0px 0px` },
    )
    observer.observe(sentinel.value)
  }

  onMounted(connect)
  watch(line, connect)

  // Every navigation unmounts a screen; an observer left behind would outlive it.
  onBeforeUnmount(() => {
    observer?.disconnect()
  })

  return collapsed
}

/**
 * The height of an element, kept current: the pinned row grows with the notch above it, and
 * the notch moves when the phone is turned. Zero until mounted, and where the platform cannot
 * observe a size, the height it had on mount.
 */
export function useHeight(element: Ref<HTMLElement | null>): Ref<number> {
  const height = ref(0)
  let observer: ResizeObserver | undefined

  onMounted(() => {
    const target = element.value
    if (!target) return
    height.value = target.offsetHeight
    if (typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(() => {
      height.value = target.offsetHeight
    })
    observer.observe(target)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
  })

  return height
}
