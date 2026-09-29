import { onBeforeUnmount, onMounted, watch } from 'vue'
import type { Ref } from 'vue'

/**
 * Keeps a sheet above the on-screen keyboard. The sheet exists for that: the numeric keyboard is
 * lower than the letter one, and the whole sheet — the unit price line included — has to fit
 * over it (MOL-18, handoff `03`).
 *
 * Where the browser shrinks only the visual viewport when the keyboard opens, not the layout —
 * iOS may — a panel pinned to the bottom of the window ends up under the keys. What they cover is
 * the gap between the bottom of the window and the bottom of the visual viewport; the sheet is
 * lifted by it through `--keyboard-inset`. Chrome on Android is told to shrink the layout instead
 * (`interactive-widget` in index.html), and there the gap is zero.
 *
 * The sheet's height is a share of what is visible, and that is the visual viewport's own height
 * (`--viewport-height`), never worked out from the window. Safari on the owner's iPhone shrank the
 * window to the visible part under the keyboard (699 → 395), left `100dvh` at 699 and reported the
 * visible part 304px down: the lift came out right at zero, while a share of `100dvh` put the
 * sheet's top 178px off the screen with the sum it was opened for (MOL-135).
 *
 * The field being typed in is kept in sight inside the sheet: once the sheet is lifted and made
 * lower, a field near its end may be left under its edge, and the sheet's own content scrolls to
 * it — never the window.
 *
 * Window events and the focus, not touches: nothing is taken from the browser's gestures.
 * Listened to only while the sheet is open.
 */
export function useKeyboardInset(target: Ref<HTMLElement | null>, active: Ref<boolean>): void {
  function measure(): void {
    const element = target.value
    const viewport = window.visualViewport
    if (!element || !viewport) return
    // Pinched in, the visual viewport shrinks and moves as it does under a keyboard; that is not a
    // keyboard, and the sheet stays where it is (adversarial П-8).
    if (viewport.scale > 1) {
      element.style.setProperty('--keyboard-inset', '0px')
      element.style.removeProperty('--viewport-height')
      return
    }
    const covered = window.innerHeight - viewport.height - viewport.offsetTop
    element.style.setProperty('--keyboard-inset', pixels(covered))
    element.style.setProperty('--viewport-height', pixels(viewport.height))
    reveal()
  }

  // Scrolls the sheet — not the window — just far enough for the focused field in it to be seen.
  function reveal(): void {
    const element = target.value
    const field = document.activeElement
    if (!element || !(field instanceof HTMLElement) || !element.contains(field)) return
    const box = element.getBoundingClientRect()
    const place = field.getBoundingClientRect()
    if (place.bottom > box.bottom) element.scrollTop += place.bottom - box.bottom
    else if (place.top < box.top) element.scrollTop -= box.top - place.top
  }

  function start(): void {
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    target.value?.addEventListener('focusin', reveal)
    measure()
  }

  function stop(): void {
    window.visualViewport?.removeEventListener('resize', measure)
    window.visualViewport?.removeEventListener('scroll', measure)
    target.value?.removeEventListener('focusin', reveal)
    target.value?.style.removeProperty('--keyboard-inset')
    target.value?.style.removeProperty('--viewport-height')
  }

  // After the render, so the sheet being measured is in the page.
  watch(
    active,
    (on) => {
      if (on) start()
      else stop()
    },
    { flush: 'post' },
  )
  onMounted(() => {
    if (active.value) start()
  })
  onBeforeUnmount(stop)
}

function pixels(value: number): string {
  return `${String(Math.max(0, Math.round(value)))}px`
}
