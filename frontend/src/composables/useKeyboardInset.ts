import { onBeforeUnmount, onMounted, watch } from 'vue'
import type { Ref } from 'vue'
import { read, write } from '@/stores/storage'

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
 * The lift is counted from the box a fixed panel is pinned in, read where it lies (`pinnedBottom`),
 * less the visible height — never from `innerHeight`, which Safari moves on its own with the keyboard
 * up: in the installed app on the owner's iPhone it read 796 and, the next time the same keyboard
 * rose, 720, and the sheet's end stood under the glass bar of «∧ ∨ ✓» over the keys
 * (hotfix-bottom-menu). Nor from `100dvh` any more, which that hotfix chose: Safari shrinks the box
 * under the keys a moment before it says how far the visible part moved, and for 300 ms the sheet
 * was lifted by the keys over a window already above them — off the top of the screen, every time
 * but the first a sheet was opened (MOL-151, М-2). The box less the visible height gives the lift
 * `100dvh` gave in every state logged on the phone where that was right, and zero in that one.
 * The window's own events are heard as well: that shrink comes with no event of the visual viewport.
 *
 * The first keyboard of a page comes late on an iPhone — 300 to 800 ms against 50 to 160 after — and
 * until it is up the page draws nothing: iOS slides the last picture up with the keys, the sheet in
 * it still the screen's share, its top off the screen until the first new frame (MOL-151, М-1). So
 * the height the keys left visible is remembered on the device, by the kind of keys and the window,
 * and a field of the sheet focused before they come takes it at once: the picture iOS slides is
 * already right. On a touch screen only, and let go if the keys have not come in `KEYBOARD_LATE` or
 * the focus leaves first. The very first keyboard on a phone has nothing to go by — the price.
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
 * The edge is where the sheet's `scroll-padding` says, the browser's own focus going by the same:
 * a pinned footer covers the sheet's end, and a field under it is no field in sight (MOL-182). A
 * footer that grows (`edge`) — an error, «Вернуть» — moves that edge up as a lower sheet would, and
 * the field typed in is brought back above it.
 *
 * Window events, not touches: nothing is taken from the browser's gestures. Listened to only
 * while the sheet is open.
 */
export function useKeyboardInset(
  target: Ref<HTMLElement | null>,
  active: Ref<boolean>,
  edge?: Ref<number>,
): void {
  // What the sheet was last set to: a field is revealed only when this changes.
  let placed = ''
  // The height the keys left visible last time, set before they come (MOL-151), and the timer that
  // lets it go if they never do.
  let foreseen: number | null = null
  let late: ReturnType<typeof setTimeout> | undefined
  // Which focus of the sheet is the last: a field left within two frames is not brought back.
  let focusing = 0

  function measure(): void {
    const element = target.value
    const viewport = window.visualViewport
    if (!element || !viewport) return
    // Pinched in, the visual viewport shrinks and moves as it does under a keyboard; that is not a
    // keyboard, and the sheet stays where it is (adversarial П-8).
    if (viewport.scale > 1) {
      element.style.setProperty('--keyboard-inset', '0px')
      element.style.removeProperty('--viewport-height')
      underKeys(false)
      placed = ''
      return
    }
    const whole = windowHeight()
    const keys = whole - viewport.height > KEYBOARD
    underKeys(keys)
    if (keys) {
      forget()
      const field = typedIn(element)
      if (field && keyed(field)) remember(field, whole, viewport.height)
    } else if (foreseen !== null) {
      place(element, 0, foreseen)
      return
    }
    // Never below zero: a visible part taller than what is left of the box over the keys — Safari's
    // window shrunk a moment before it said so — leaves nothing for the keys to cover.
    place(element, pinnedBottom() - viewport.height, viewport.height)
  }

  function place(element: HTMLElement, covered: number, height: number): void {
    const lift = pixels(covered)
    const tall = pixels(height)
    element.style.setProperty('--keyboard-inset', lift)
    element.style.setProperty('--viewport-height', tall)
    if (`${lift} ${tall}` === placed) return
    placed = `${lift} ${tall}`
    reveal(element)
  }

  // A field of the sheet focused with no keys up yet, on a touch screen: the sheet takes the height
  // they left the last time at once, so the picture iOS slides up with them is already right. On
  // every such focus, not only the page's first: a later keyboard came 128 to 263 ms after the focus
  // with no frame of the page or with one (MOL-151, adversarial У2). With none, iOS slides what was
  // drawn before the focus, which nothing here can change; with one, that frame is what it slides —
  // made lower, it lands in place, while left tall its top went off the screen. The price is that one
  // frame: the sheet's top lower for the 15–36 ms before the keys (adversarial А6, the round-2 note).
  function foresee(): void {
    const element = target.value
    const viewport = window.visualViewport
    const field = element && typedIn(element)
    if (!field || !keyed(field) || !viewport || viewport.scale > 1 || !touch()) return
    const whole = windowHeight()
    if (whole - viewport.height > KEYBOARD) return
    const height = recall(field, whole)
    if (height === null) return
    foreseen = height
    clearTimeout(late)
    late = setTimeout(() => {
      foreseen = null
      measure()
    }, KEYBOARD_LATE)
    measure()
  }

  // A field focused under a pinned footer — Tab, or «∨» over the iOS keys stepping to the next field —
  // is brought above it once the browser's own scroll is done: WebKit does not always honour
  // `scroll-padding` there (CI, Linux), and the field stayed under the footer (MOL-182). Two frames,
  // so the browser moves first; a field it already showed is not moved again. Without a footer the
  // browser's scroll is the whole answer (adversarial А of MOL-135).
  function focused(): void {
    const element = target.value
    if (!element || !typedIn(element) || footerEdge(element) === 0) return
    const current = ++focusing
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (current === focusing && active.value && target.value) reveal(target.value)
      })
    })
  }

  // The focus left before the keys came: the sheet is the screen's share again.
  function letGo(): void {
    if (foreseen === null) return
    forget()
    measure()
  }

  function forget(): void {
    foreseen = null
    clearTimeout(late)
  }

  function start(): void {
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    // Safari shrinks the window under the keys with no event of the visual viewport, a scroll of
    // the window alone (MOL-151, М-2).
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, { passive: true })
    target.value?.addEventListener('focusin', foresee)
    target.value?.addEventListener('focusin', focused)
    target.value?.addEventListener('focusout', letGo)
    measure()
    foresee()
  }

  function stop(): void {
    window.visualViewport?.removeEventListener('resize', measure)
    window.visualViewport?.removeEventListener('scroll', measure)
    window.removeEventListener('resize', measure)
    window.removeEventListener('scroll', measure)
    target.value?.removeEventListener('focusin', foresee)
    target.value?.removeEventListener('focusin', focused)
    target.value?.removeEventListener('focusout', letGo)
    target.value?.style.removeProperty('--keyboard-inset')
    target.value?.style.removeProperty('--viewport-height')
    underKeys(false)
    forget()
    placed = ''
  }

  if (edge) {
    watch(
      edge,
      () => {
        if (active.value && target.value) reveal(target.value)
      },
      { flush: 'post' },
    )
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

/** The field of the sheet being typed in, if any. */
export function typedIn(sheet: HTMLElement): HTMLElement | null {
  const field = document.activeElement
  return field instanceof HTMLElement && sheet.contains(field) && field.matches(TYPED_IN)
    ? field
    : null
}

/**
 * Scrolls the sheet — not the window — just far enough for the field typed in to be seen, its top
 * first, between the edges its `scroll-padding` leaves: a pinned footer covers the end (MOL-182).
 * A field taller than that is left where it is: the browser keeps its caret in sight. Done once
 * more, it moves nothing (adversarial А3).
 */
function reveal(sheet: HTMLElement): void {
  const field = typedIn(sheet)
  if (!field) return
  const box = sheet.getBoundingClientRect()
  const top = box.top + padding(getComputedStyle(sheet).scrollPaddingTop)
  const bottom = box.bottom - footerEdge(sheet)
  const place = field.getBoundingClientRect()
  const above = top - place.top
  const below = place.bottom - bottom
  if (above > 0 && below > 0) return
  // A scroll lands on whole pixels, a field does not: rounded outwards, or a fraction stays under
  // the edge — and rounded so that the field's top never goes past the sheet's.
  if (above > 0) sheet.scrollTop -= Math.ceil(above)
  else if (below > 0) sheet.scrollTop += Math.min(Math.ceil(below), Math.floor(-above))
}

/** How far a pinned footer covers the sheet's end: its `scroll-padding-bottom`. */
function footerEdge(sheet: HTMLElement): number {
  return padding(getComputedStyle(sheet).scrollPaddingBottom)
}

/** A `scroll-padding` in pixels; `auto`, or nothing laid out, is none. */
function padding(value: string): number {
  const pixels = Number.parseFloat(value)
  return Number.isFinite(pixels) ? pixels : 0
}

/**
 * Less than any on-screen keyboard and more than a browser's own bars coming and going: the
 * visible part this much shorter than the window is a keyboard.
 */
const KEYBOARD = 150

/**
 * What brings the keys up: a select and a date bring a picker of their own, and a height remembered
 * for them is no keyboard's — a tap on «День» made the sheet short for 1.5 s and then jumped
 * (adversarial У1). They are still kept in sight like any field typed in.
 */
const PICKED = [
  'select',
  ...['date', 'time', 'datetime-local', 'month', 'week'].map((type) => `input[type="${type}"]`),
].join(', ')

function keyed(field: HTMLElement): boolean {
  return !field.matches(PICKED)
}

/**
 * How long a height foreseen for the keys waits for them. The first keyboard of a page came after
 * 815 ms at worst on the owner's iPhone (MOL-151); a hardware keyboard never comes, and the sheet
 * must not stay short for it.
 */
const KEYBOARD_LATE = 1500

/**
 * The heights the keys left visible, by the kind of keys and the window: the numeric keyboard is
 * lower than the letter one, and a turned phone is another window. Says nothing about the person.
 */
const MEMORY = 'molvia.keyboard'

function memoryKey(field: HTMLElement, whole: number): string {
  const kind = field.getAttribute('inputmode') ?? field.getAttribute('type') ?? field.localName
  return `${kind} ${String(Math.round(whole))}x${String(window.innerWidth)}`
}

function memory(): Record<string, unknown> {
  try {
    const kept: unknown = JSON.parse(read(MEMORY) ?? '{}')
    return typeof kept === 'object' && kept !== null ? (kept as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function recall(field: HTMLElement, whole: number): number | null {
  const height = memory()[memoryKey(field, whole)]
  return typeof height === 'number' && height > 0 && height < whole ? height : null
}

function remember(field: HTMLElement, whole: number, height: number): void {
  const kept = memory()
  const key = memoryKey(field, whole)
  const rounded = Math.round(height)
  if (kept[key] === rounded) return
  write(MEMORY, JSON.stringify({ ...kept, [key]: rounded }))
}

function touch(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}

/**
 * Tells the page the keys are up under an open sheet (`data-under-keys` on the root; main.scss).
 * Safari ends everything fixed — the sheet, its scrim — at the top of the keyboard, and on iOS 26
 * and later its bar of «∧ ∨ ✓», the address bar floating over the keys and the keys themselves are
 * glass with clear room between them: what shows through is the page itself, and a fixed layer
 * cannot be drawn there to cover it. The page under a modal sheet takes nothing anyway, so it is
 * hidden instead, and the canvas takes the sheet's colour (hotfix-bottom-menu, the owner's
 * screenshots, Safari and the installed app).
 */
function underKeys(on: boolean): void {
  const root = document.documentElement
  if (on) root.dataset.underKeys = ''
  else delete root.dataset.underKeys
}

// A box as tall as `100dvh`, read by its height: a length in `dvh` has no reading of its own in a
// script. One for the app, put back if the page's body was replaced. It tells the keys are up, and
// which window a remembered height is of; the lift is the pinned box's (`pinnedBottom`).
let ruler: HTMLElement | null = null

function windowHeight(): number {
  if (!ruler?.isConnected) {
    ruler = document.createElement('div')
    ruler.setAttribute('aria-hidden', 'true')
    ruler.dataset.dvh = ''
    ruler.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:100dvh;visibility:hidden;pointer-events:none'
    document.body.append(ruler)
  }
  // Where nothing is laid out — the component tests — the box has no height, and the window's is
  // the one there is.
  return ruler.getBoundingClientRect().height || window.innerHeight
}

// The bottom of the box a fixed panel is pinned in, read where it lies. Safari shrinks that box under
// the keys a moment before it says how far the visible part moved (MOL-151, М-2): counted from
// `100dvh`, the sheet was lifted by the keys over a window already above them and flew off the top
// for 300 ms. In every state logged on the iPhone — Safari, its bar folded, the installed app —
// the box less the visible height is the lift `100dvh` gave where it was right.
let floor: HTMLElement | null = null

function pinnedBottom(): number {
  if (!floor?.isConnected) {
    floor = document.createElement('div')
    floor.setAttribute('aria-hidden', 'true')
    floor.dataset.floor = ''
    floor.style.cssText =
      'position:fixed;bottom:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none'
    document.body.append(floor)
  }
  // Where nothing is laid out — the component tests — the window's height stands in.
  return floor.getBoundingClientRect().top || window.innerHeight
}

function pixels(value: number): string {
  return `${String(Math.max(0, Math.round(value)))}px`
}
