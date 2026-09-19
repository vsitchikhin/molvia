import { onBeforeUnmount, onMounted, watch } from 'vue'
import type { Ref } from 'vue'

/**
 * Keeps a sheet above the on-screen keyboard. The sheet exists for that: the numeric keyboard is
 * lower than the letter one, and the whole sheet — the unit price line included — has to fit
 * over it (MOL-18, handoff `03`).
 *
 * iOS does not shrink the layout when the keyboard opens, only the visual viewport, so a panel
 * pinned to the bottom of the window ends up under the keys. What the keyboard covers is the gap
 * between the bottom of the window and the bottom of the visual viewport; the sheet is lifted by
 * it through `--keyboard-inset`. Chrome on Android is told to shrink the layout instead
 * (`interactive-widget` in index.html), and there the gap is zero.
 *
 * Window events, not touches: nothing is taken from the browser's gestures. Listened to only
 * while the sheet is open.
 */
export function useKeyboardInset(target: Ref<HTMLElement | null>, active: Ref<boolean>): void {
  function measure(): void {
    const element = target.value
    const viewport = window.visualViewport
    if (!element || !viewport) return
    const covered = window.innerHeight - viewport.height - viewport.offsetTop
    element.style.setProperty('--keyboard-inset', `${String(Math.max(0, Math.round(covered)))}px`)
  }

  function start(): void {
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    measure()
  }

  function stop(): void {
    window.visualViewport?.removeEventListener('resize', measure)
    window.visualViewport?.removeEventListener('scroll', measure)
    target.value?.style.removeProperty('--keyboard-inset')
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
