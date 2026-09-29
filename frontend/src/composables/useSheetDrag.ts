import { onBeforeUnmount, ref, watch } from 'vue'
import type { Ref } from 'vue'

/** How far a finger goes before a press becomes a drag — the platforms' own tap slop. */
const SLOP = 8
/** Past this share of its height, a sheet let go goes away (owner's decision В-4). */
const AWAY_SHARE = 0.25
/**
 * A flick: faster than this, downwards, over the last moments of the drag — px/ms. The number the
 * sheets of iOS and of the `vaul` library settle on; a platform convention, not a design token.
 */
const FLICK = 0.4
/** How far back the flick is measured from the lift. */
const FLICK_WINDOW = 100

/** Where a finger in a field moves the caret and selects — never the sheet (owner's decision В-6). */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

interface Sample {
  y: number
  at: number
}

/**
 * A sheet pulled down by its content goes away (MOL-80, the owner's request): the sixth way to
 * close it, and it closes the same way as the other five — `close`, a step back through history.
 *
 * The one written exception to «no gesture is intercepted» (MOL-17): the edge swipe and Android's
 * «back» are still the platform's, and so is every other move of a finger in the sheet. Taken only
 * when the content stands at its very top and the finger goes down more than sideways; a finger
 * that goes up, or sideways, or starts in a field, is left to the browser. Touch events, not
 * pointer events: once the browser starts a scroll it takes the pointer back (`pointercancel`),
 * and the sheet could no longer follow the finger — only a touch listener that is not passive can
 * stop the content springing instead. Listened to only while the sheet is open: a shut sheet stays
 * on many screens, and the shell holds no touch listener anywhere (e2e `navigation.spec.ts`).
 *
 * The sheet follows the finger and the scrim fades with it; let go past a quarter of its height,
 * or flicked, it slides the rest of the way and closes; otherwise it goes back up. With reduced
 * motion it still follows the finger — that is the finger, not an animation — and the rest is
 * instant, as its rise is (main.scss).
 */
export function useSheetDrag(
  target: Ref<HTMLElement | null>,
  active: Ref<boolean>,
  options: {
    /** Whether a touch that began at this moment may pull the sheet: it is up and not closing. */
    canStart: (event: TouchEvent) => boolean
    close: () => void
  },
): { dragging: Ref<boolean>; reset: () => void } {
  const dragging = ref(false)
  let start: { x: number; y: number } | null = null
  let origin = 0
  let samples: Sample[] = []

  function offsetTo(element: HTMLElement, offset: number): void {
    element.style.transform = `translateY(${String(offset)}px)`
    element.style.setProperty('--sheet-drag', String(offset / element.offsetHeight))
  }

  /** Back to how the stylesheet draws it — up when open, below the edge when shut. */
  function reset(): void {
    start = null
    samples = []
    dragging.value = false
    const element = target.value
    if (!element) return
    element.style.removeProperty('transform')
    element.style.removeProperty('--sheet-drag')
  }

  function began(event: TouchEvent): void {
    start = null
    const element = target.value
    const touch = event.touches[0]
    if (!element || !touch || event.touches.length > 1) return
    if (element.scrollTop > 0 || !options.canStart(event)) return
    if (event.target instanceof Element && event.target.closest(TYPING)) return
    start = { x: touch.clientX, y: touch.clientY }
  }

  function moved(event: TouchEvent): void {
    const element = target.value
    const touch = event.touches[0]
    if (!element || !start || !touch) return
    if (event.touches.length > 1) {
      letGo(false)
      return
    }
    const down = touch.clientY - start.y
    if (!dragging.value) {
      const across = Math.abs(touch.clientX - start.x)
      // Up, or sideways first: a scroll or nothing — the browser's.
      if (down < 0 || (across >= SLOP && across >= down)) {
        start = null
        return
      }
      // Down at the top has nothing to scroll: the spring is stopped before the browser starts it.
      if (down > SLOP / 2) event.preventDefault()
      if (down < SLOP || element.scrollTop > 0) return
      dragging.value = true
      origin = touch.clientY
    }
    event.preventDefault()
    const offset = Math.max(0, touch.clientY - origin)
    offsetTo(element, offset)
    samples.push({ y: touch.clientY, at: event.timeStamp })
    while (samples.length > 2 && event.timeStamp - (samples[0]?.at ?? 0) > FLICK_WINDOW) {
      samples.shift()
    }
  }

  function flicked(): boolean {
    const first = samples[0]
    const last = samples.at(-1)
    if (!first || !last || last.at <= first.at) return false
    return (last.y - first.y) / (last.at - first.at) > FLICK
  }

  function letGo(counts: boolean): void {
    const element = target.value
    if (!element || !dragging.value) {
      start = null
      return
    }
    const last = samples.at(-1)
    const offset = last ? Math.max(0, last.y - origin) : 0
    const away = counts && (offset > element.offsetHeight * AWAY_SHARE || flicked())
    start = null
    samples = []
    // The transition comes back with the class; the sheet slides from where the finger left it.
    dragging.value = false
    requestAnimationFrame(() => {
      if (away) {
        element.style.transform = 'translateY(100%)'
        element.style.setProperty('--sheet-drag', '1')
        options.close()
      } else {
        element.style.removeProperty('transform')
        element.style.removeProperty('--sheet-drag')
      }
    })
  }

  const ended = () => {
    letGo(true)
  }
  const cancelled = () => {
    letGo(false)
  }

  function listen(on: boolean): void {
    const element = target.value
    if (!element) return
    if (on) {
      element.addEventListener('touchstart', began, { passive: true })
      element.addEventListener('touchmove', moved, { passive: false })
      element.addEventListener('touchend', ended)
      element.addEventListener('touchcancel', cancelled)
    } else {
      element.removeEventListener('touchstart', began)
      element.removeEventListener('touchmove', moved)
      element.removeEventListener('touchend', ended)
      element.removeEventListener('touchcancel', cancelled)
    }
  }
  watch(active, listen)
  onBeforeUnmount(() => {
    listen(false)
  })

  return { dragging, reset }
}
