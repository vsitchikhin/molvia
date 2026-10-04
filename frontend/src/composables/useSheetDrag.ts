import { onBeforeUnmount, ref, watch } from 'vue'
import type { Ref } from 'vue'

/** How far a finger goes before a press becomes a drag — the platforms' own tap slop. */
const SLOP = 8
/** Past this share of its height, a sheet let go goes away (owner's decision В-4). */
const AWAY_SHARE = 0.25
/**
 * A flick: faster than this, downwards, over the last moments before the lift — px/ms. The number
 * the sheets of iOS and of the `vaul` library settle on; a platform convention, not a design token.
 */
const FLICK = 0.4
/**
 * How far back from the lift the flick is measured. Up to the lift, not up to the last move: a
 * finger at rest sends no `touchmove`, and a fast pull held still and then let go — a change of
 * mind — was read at the speed of the pull and closed the sheet (adversarial А, review Р-1).
 */
const FLICK_WINDOW = 100
/** Enough moves to reach back past the window at any rate a screen sends them. */
const SAMPLES = 32

/**
 * Where a finger moves the caret and selects — never the sheet (owner's decision В-6) — or drags a
 * thing of the sheet's own: the corners of a receipt (MOL-222, `data-drags`).
 */
const TYPING =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-drags]'

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
    // A second finger ends the pull and puts the sheet back: it is a pinch or a change of grip, not
    // a decision. The browser sends its `touchstart` before any move of two fingers, and wiping the
    // pull here without letting go froze the sheet where it was — then the first lift closed it
    // (adversarial Б).
    if (event.touches.length > 1) {
      letGo(false)
      return
    }
    start = null
    const element = target.value
    const touch = event.touches[0]
    if (!element || !touch) return
    if (element.scrollTop > 0 || !options.canStart(event)) return
    if (!(event.target instanceof Element)) return
    // A touch that came up from a sheet inside this one is that sheet's to pull (review Р-2).
    if (event.target.closest('dialog') !== element || event.target.closest(TYPING)) return
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
    if (samples.length > SAMPLES) samples.shift()
  }

  /**
   * Down faster than a flick over the window that ends at the lift: from the last move at least
   * the window before it — or the first move, for a pull shorter than that — to where the finger
   * rests, over the time up to the lift. A pause before the lift slows it to nothing.
   */
  function flicked(lift: number): boolean {
    const last = samples.at(-1)
    const from = samples.findLast((sample) => lift - sample.at >= FLICK_WINDOW) ?? samples[0]
    if (!last || !from || lift <= from.at) return false
    return (last.y - from.y) / (lift - from.at) > FLICK
  }

  function letGo(counts: boolean, lift = 0): void {
    const element = target.value
    if (!element || !dragging.value) {
      start = null
      return
    }
    const last = samples.at(-1)
    const offset = last ? Math.max(0, last.y - origin) : 0
    const away = counts && (offset > element.offsetHeight * AWAY_SHARE || flicked(lift))
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

  const ended = (event: TouchEvent) => {
    // Where the finger lifted counts as well: it may have gone on since the last move reported,
    // and the flick took that time without that way — a short flick just over the line read as
    // under it (adversarial Г).
    const lifted = event.changedTouches[0]
    if (dragging.value && lifted) samples.push({ y: lifted.clientY, at: event.timeStamp })
    // A finger lifted while another stays down would have ended the pull at its `touchstart`.
    letGo(event.touches.length === 0, event.timeStamp)
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
