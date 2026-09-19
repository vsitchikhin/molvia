import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Ref } from 'vue'

/**
 * Whether the large title has scrolled away under the pinned row.
 *
 * An observer on a 1px sentinel, not a scroll listener: the browser reports the crossing, the
 * page does no work per frame. The line the sentinel crosses is the bottom edge of the pinned
 * row, measured once — its height never changes, which is the whole point: a row that shrank
 * on collapse would pull the content up, bring the sentinel back and flip itself open again.
 *
 * Only a sentinel gone *above* that line counts. One below the fold is out of view too, and
 * without the check a screen opened scrolled to the bottom would claim a title it shows.
 */
export function useCollapsed(
  sentinel: Ref<HTMLElement | null>,
  bar: Ref<HTMLElement | null>,
): Ref<boolean> {
  const collapsed = ref(false)
  let observer: IntersectionObserver | undefined

  onMounted(() => {
    if (!sentinel.value || typeof IntersectionObserver === 'undefined') return

    const line = bar.value?.offsetHeight ?? 0
    observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        const top = entry.rootBounds?.top ?? line
        collapsed.value = !entry.isIntersecting && entry.boundingClientRect.top < top
      },
      { rootMargin: `-${String(line)}px 0px 0px 0px` },
    )
    observer.observe(sentinel.value)
  })

  // Every navigation unmounts a screen; an observer left behind would outlive it.
  onBeforeUnmount(() => {
    observer?.disconnect()
  })

  return collapsed
}
