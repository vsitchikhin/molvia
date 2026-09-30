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
 * The field being typed in is kept in sight inside the sheet: once the sheet is lifted or made
 * lower, a field near its end may be left under its edge, and the sheet's own content scrolls to
 * it — never the window. Only then: a focus the browser brings into sight itself, and an event of
 * the viewport that moved nothing is no reason to take the sheet from under the finger (review
 * С-1). Only a field typed in: a block focused for a screen reader — the result of a check — is
 * read from its top, which the browser's own focus already shows (adversarial А).
 *
 * Window events, not touches: nothing is taken from the browser's gestures. Listened to only
 * while the sheet is open.
 */
export function useKeyboardInset(target: Ref<HTMLElement | null>, active: Ref<boolean>): void {
  // What the sheet was last set to: a field is revealed only when this changes.
  let placed = ''

  function measure(): void {
    const element = target.value
    const viewport = window.visualViewport
    if (!element || !viewport) return
    // Pinched in, the visual viewport shrinks and moves as it does under a keyboard; that is not a
    // keyboard, and the sheet stays where it is (adversarial П-8).
    if (viewport.scale > 1) {
      element.style.setProperty('--keyboard-inset', '0px')
      element.style.removeProperty('--viewport-height')
      placed = ''
      return
    }
    // Below zero where Safari has shrunk the window to the visible part and still reports the
    // viewport scrolled down it (MOL-135): the keys cover nothing of this window, and that is zero.
    const covered = pixels(window.innerHeight - viewport.height - viewport.offsetTop)
    const height = pixels(viewport.height)
    element.style.setProperty('--keyboard-inset', covered)
    element.style.setProperty('--viewport-height', height)
    if (`${covered} ${height}` === placed) return
    placed = `${covered} ${height}`
    reveal(element)
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
    target.value?.style.removeProperty('--viewport-height')
    placed = ''
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

/** What a person types into — a button, a radio or a block focused to be read is not one. */
const NOT_TYPED = [
  'button',
  'submit',
  'reset',
  'checkbox',
  'radio',
  'range',
  'color',
  'file',
  'image',
]
const TYPED_IN = [
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  `input:not(${NOT_TYPED.map((type) => `[type="${type}"]`).join(', ')})`,
].join(', ')

/**
 * Scrolls the sheet — not the window — just far enough for the field typed in to be seen, its top
 * first. A field taller than the sheet is left where it is: the browser keeps its caret in sight.
 * Done once more, it moves nothing (adversarial А3).
 */
function reveal(sheet: HTMLElement): void {
  const field = document.activeElement
  if (!(field instanceof HTMLElement) || !sheet.contains(field) || !field.matches(TYPED_IN)) return
  const box = sheet.getBoundingClientRect()
  const place = field.getBoundingClientRect()
  const above = box.top - place.top
  const below = place.bottom - box.bottom
  if (above > 0 && below > 0) return
  // A scroll lands on whole pixels, a field does not: rounded outwards, or a fraction stays under
  // the edge — and rounded so that the field's top never goes past the sheet's.
  if (above > 0) sheet.scrollTop -= Math.ceil(above)
  else if (below > 0) sheet.scrollTop += Math.min(Math.ceil(below), Math.floor(-above))
}

function pixels(value: number): string {
  return `${String(Math.max(0, Math.round(value)))}px`
}
