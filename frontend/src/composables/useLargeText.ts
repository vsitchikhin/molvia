import { onBeforeUnmount, onMounted } from 'vue'

/** A text this much larger than the browser's 16 px is large: Android's smallest step up is 115 %. */
const LARGE_REM_PX = 17.6

/**
 * `data-large-text` on the root while the text is large (MOL-321): what CSS cannot ask — the size of a rem
 * in pixels — read off a box one rem wide, again whenever it changes. A width in rem tells the box, not the
 * text: a narrow button is narrow at 100 % too. Only a word broken with a hyphen goes by it today — Safari
 * knows no `hyphenate-limit-chars`, and at 100 % it hyphenated «по-купки» at a line's end.
 */
export function useLargeText(): void {
  let probe: HTMLElement | null = null
  let observer: ResizeObserver | null = null
  function mark(): void {
    const large = (probe?.getBoundingClientRect().width ?? 0) > LARGE_REM_PX
    document.documentElement.toggleAttribute('data-large-text', large)
  }
  onMounted(() => {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:absolute;width:1rem;height:0;visibility:hidden;pointer-events:none'
    document.body.append(probe)
    mark()
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(mark)
      observer.observe(probe)
    }
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    probe?.remove()
    document.documentElement.removeAttribute('data-large-text')
  })
}
