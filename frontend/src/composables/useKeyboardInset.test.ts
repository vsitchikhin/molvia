import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { useKeyboardInset } from '@/composables/useKeyboardInset'

/** A visual viewport the test moves by hand, the way a keyboard opening would. */
function fakeViewport(height: number, offsetTop = 0, scale = 1) {
  const listeners = new Map<string, Set<() => void>>()
  const viewport = {
    height,
    offsetTop,
    scale,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener))
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener)
    }),
    fire(type: string) {
      for (const listener of listeners.get(type) ?? []) listener()
    },
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  }
  vi.stubGlobal('visualViewport', viewport)
  vi.stubGlobal('innerHeight', 800)
  return viewport
}

function host(active = false, use = useKeyboardInset) {
  const on = ref(active)
  const target = ref<HTMLElement | null>(null)
  const view = mount(
    defineComponent(() => {
      use(target, on)
      return () =>
        h('div', { ref: target }, [
          h('input', { 'data-field': '' }),
          h('input', { 'data-amount': '', inputmode: 'decimal' }),
          h('button', { 'data-button': '' }),
          h('input', { 'data-date': '', type: 'date' }),
          h('div', { 'data-block': '', tabindex: -1 }),
        ])
    }),
    { attachTo: document.body },
  )
  const style = () => (view.element as HTMLElement).style
  const inset = () => style().getPropertyValue('--keyboard-inset')
  const height = () => style().getPropertyValue('--viewport-height')
  return { on, view, inset, height }
}

/** The sheet's box and a field in it, as the layout would place them at a scroll of 100. */
function placed(
  view: ReturnType<typeof host>['view'],
  box: Box,
  field: Box,
  which = '[data-field]',
) {
  const sheet = view.element as HTMLElement
  const input = sheet.querySelector<HTMLElement>(which)
  if (!input) throw new Error(`no ${which} in the sheet`)
  sheet.scrollTop = 100
  sheet.getBoundingClientRect = () => rect(box)
  // The field moves up as the sheet's content scrolls down.
  input.getBoundingClientRect = () => {
    const moved = sheet.scrollTop - 100
    return rect({ top: field.top - moved, bottom: field.bottom - moved })
  }
  return { sheet, input }
}

interface Box {
  top: number
  bottom: number
}

function rect({ top, bottom }: Box): DOMRect {
  return DOMRect.fromRect({ x: 0, y: top, width: 390, height: bottom - top })
}

/**
 * The page as it lays out the two boxes `useKeyboardInset` reads: the ruler of `100dvh` and the
 * bottom of the box a fixed panel is pinned in. Changed by hand, the way Safari changes them.
 */
function fakeLayout(dvh: number, floor = dvh) {
  const layout = { dvh, floor }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.dataset.dvh === '') return rect({ top: 0, bottom: layout.dvh })
    if (this.dataset.floor === '') return rect({ top: layout.floor, bottom: layout.floor })
    // Anything else is not laid out, as in happy-dom itself.
    return rect({ top: 0, bottom: 0 })
  })
  return layout
}

/** `100dvh` as the page lays it out, the pinned box as tall. */
function fakeDvh(height: number) {
  return fakeLayout(height)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete document.documentElement.dataset.underKeys
  document.body.innerHTML = ''
  localStorage.clear()
  sessionStorage.clear()
})

describe('useKeyboardInset', () => {
  it('lifts the sheet by what the keyboard covers', async () => {
    const viewport = fakeViewport(800)
    const { on, inset } = host()
    on.value = true
    await nextTick()
    expect(inset()).toBe('0px')

    viewport.height = 500
    viewport.fire('resize')
    expect(inset()).toBe('300px')
  })

  // Safari on the owner's iPhone, «Где вы?» opened again (MOL-151, М-2): the keys come over a window
  // of 699; then the window shrinks to 369 with no event of the visual viewport and its offset still
  // 0, and only 300 ms later is the visible part reported 330 down. Lifted by `100dvh` the sheet went
  // over the top of the screen for those 300 ms; lifted from the pinned box, it never moves.
  it('lifts from the box it is pinned in, through the moment Safari has shrunk it unsaid', async () => {
    const viewport = fakeViewport(699)
    const layout = fakeLayout(699)
    const { on, inset, height } = host()
    on.value = true
    await nextTick()
    viewport.height = 369
    viewport.fire('resize')
    expect(inset()).toBe('330px')
    expect(height()).toBe('369px')
    layout.floor = 369
    window.dispatchEvent(new Event('scroll'))
    expect(inset()).toBe('0px')
    expect(height()).toBe('369px')
    viewport.offsetTop = 330
    viewport.fire('scroll')
    expect(inset()).toBe('0px')
    expect(height()).toBe('369px')
  })

  // Measured on the owner's iPhone, Safari (MOL-135): the window shrinks to the visible part under
  // the keyboard, `100dvh` stays 699, and the visible part is reported 304px down. Nothing is to be
  // lifted, and the sheet is a share of 395 — of 699 its top went 178px off the screen.
  it('takes what Safari leaves visible when it shrinks the window itself', async () => {
    const viewport = fakeViewport(699)
    const layout = fakeDvh(699)
    vi.stubGlobal('innerHeight', 699)
    const { on, inset, height } = host()
    on.value = true
    await nextTick()
    expect(height()).toBe('699px')
    vi.stubGlobal('innerHeight', 395)
    layout.floor = 395
    viewport.height = 395
    viewport.offsetTop = 304
    viewport.fire('resize')
    expect(inset()).toBe('0px')
    expect(height()).toBe('395px')
  })

  // The installed app on the owner's iPhone (hotfix-bottom-menu): the same keyboard over the same
  // visual viewport, and the window read 796 once and 720 the next time. Lifted by the window, the
  // sheet stood 76px lower the second time, its end under the glass bar over the keys. The pinned
  // box lay at 674 in both, as logged (`xx16zh`): the lift `100dvh` gave there, 247.
  it('lifts from the pinned box, not by the window Safari moves with the keyboard', async () => {
    const viewport = fakeViewport(797)
    const layout = fakeDvh(797)
    vi.stubGlobal('innerHeight', 797)
    const { on, inset, height } = host()
    on.value = true
    await nextTick()
    expect(inset()).toBe('0px')
    vi.stubGlobal('innerHeight', 796)
    layout.floor = 674
    viewport.height = 427
    viewport.offsetTop = 123
    viewport.fire('resize')
    expect(inset()).toBe('247px')
    vi.stubGlobal('innerHeight', 720)
    viewport.fire('scroll')
    expect(inset()).toBe('247px')
    expect(height()).toBe('427px')
  })

  // Safari with its bar folded, the page scrolled (hotfix-bottom-menu): the window read 535 of a
  // `100dvh` of 699, and the lift of zero left the sheet's last 100px under the keys. The pinned box
  // lay at 495, as logged (`poa2mh`).
  it('lifts in Safari with its bar folded, the window shrunk short of the keys', async () => {
    const viewport = fakeViewport(739)
    fakeLayout(699, 495)
    vi.stubGlobal('innerHeight', 535)
    viewport.height = 395
    viewport.offsetTop = 204
    const { on, inset } = host()
    on.value = true
    await nextTick()
    expect(inset()).toBe('100px')
  })

  // Safari draws nothing fixed below the top of the keys, and through their glass the page showed
  // between the sheet and the keyboard (hotfix-bottom-menu): the page is hidden while they are up.
  it('tells the page the keys are up under the sheet, and takes it back', async () => {
    const viewport = fakeViewport(699)
    fakeDvh(699)
    vi.stubGlobal('innerHeight', 699)
    const under = () => document.documentElement.dataset.underKeys
    const { on } = host()
    on.value = true
    await nextTick()
    expect(under()).toBeUndefined()
    viewport.height = 395
    viewport.offsetTop = 304
    viewport.fire('resize')
    expect(under()).toBe('')
    viewport.height = 699
    viewport.offsetTop = 0
    viewport.fire('resize')
    expect(under()).toBeUndefined()
    viewport.height = 395
    viewport.fire('resize')
    on.value = false
    await nextTick()
    expect(under()).toBeUndefined()
  })

  // A browser's own bars come and go by less than a keyboard: that is no keyboard.
  it('must not fire: the visible part a bar shorter than the window', async () => {
    const viewport = fakeViewport(739)
    fakeDvh(739)
    const { on } = host()
    on.value = true
    await nextTick()
    viewport.height = 739 - 150
    viewport.fire('resize')
    expect(document.documentElement.dataset.underKeys).toBeUndefined()
  })

  it('must not fire: with no keyboard the sheet takes its share of the whole screen', async () => {
    fakeViewport(800)
    const { on, inset, height } = host()
    on.value = true
    await nextTick()
    expect(inset()).toBe('0px')
    expect(height()).toBe('800px')
  })

  // Chrome on Android shrinks the window with the keyboard (`interactive-widget`), and `dvh` with
  // it: nothing is covered, and the share is of the same height as before.
  it('must not fire: a window that shrank with the keyboard', async () => {
    const viewport = fakeViewport(800)
    const { on, inset, height } = host()
    on.value = true
    await nextTick()
    vi.stubGlobal('innerHeight', 500)
    viewport.height = 500
    viewport.fire('resize')
    expect(inset()).toBe('0px')
    expect(height()).toBe('500px')
  })

  it('must not fire: listens to nothing while the sheet is shut', async () => {
    const viewport = fakeViewport(500)
    const { inset } = host()
    await nextTick()
    expect(viewport.count()).toBe(0)
    expect(inset()).toBe('')
  })

  it('lets go when the sheet closes', async () => {
    const viewport = fakeViewport(500, 100)
    const { on, inset, height } = host(true)
    await nextTick()
    expect(inset()).toBe('300px')
    on.value = false
    await nextTick()
    expect(viewport.count()).toBe(0)
    expect(inset()).toBe('')
    expect(height()).toBe('')
  })

  it('lets go when the screen goes away with the sheet open', async () => {
    const viewport = fakeViewport(500)
    const { on, view } = host()
    on.value = true
    await nextTick()
    view.unmount()
    expect(viewport.count()).toBe(0)
  })

  it('does nothing where the browser has no visual viewport', async () => {
    vi.stubGlobal('visualViewport', undefined)
    const { on, inset } = host()
    on.value = true
    await nextTick()
    expect(inset()).toBe('')
  })

  // Pinched in, the visual viewport shrinks as it does under a keyboard (adversarial П-8).
  it('must not fire: a pinch-zoom is not a keyboard', async () => {
    const viewport = fakeViewport(400, 100, 2)
    const { on, inset, height } = host()
    on.value = true
    await nextTick()
    expect(inset()).toBe('0px')
    expect(document.documentElement.dataset.underKeys).toBeUndefined()
    // Not the pinched viewport's height: the sheet keeps its share of the screen.
    expect(height()).toBe('')
    viewport.scale = 1
    viewport.height = 500
    viewport.offsetTop = 0
    viewport.fire('resize')
    expect(inset()).toBe('300px')
  })
})

// Lifted and made lower, the sheet may leave the field being typed in under its edge: its own
// content scrolls to it, just far enough, and the window never does (MOL-135, Р-4).
describe('useKeyboardInset keeps the focused field in sight', () => {
  async function typing(field: Box, box: Box = { top: 300, bottom: 500 }) {
    const viewport = fakeViewport(800)
    const view = host()
    const { sheet, input } = placed(view.view, box, field)
    view.on.value = true
    await nextTick()
    input.focus()
    viewport.height = 500
    viewport.fire('resize')
    return { sheet, input, viewport }
  }

  it('scrolls the sheet by what the field reaches under its edge', async () => {
    const { sheet } = await typing({ top: 481, bottom: 521 })
    expect(sheet.scrollTop).toBe(121)
  })

  it('scrolls one pixel for a field one pixel under the edge', async () => {
    const { sheet } = await typing({ top: 461, bottom: 501 })
    expect(sheet.scrollTop).toBe(101)
  })

  // A scroll lands on whole pixels: 21.4 scrolled as 21 left the field 0.4px under the edge.
  it('scrolls a fraction under the edge by the whole pixel above it', async () => {
    const { sheet } = await typing({ top: 481.4, bottom: 521.4 })
    expect(sheet.scrollTop).toBe(122)
  })

  it('must not fire: a field whose end is the sheet’s edge', async () => {
    const { sheet } = await typing({ top: 460, bottom: 500 })
    expect(sheet.scrollTop).toBe(100)
  })

  it('must not fire: a field a pixel inside the edge', async () => {
    const { sheet } = await typing({ top: 459, bottom: 499 })
    expect(sheet.scrollTop).toBe(100)
  })

  it('scrolls back to a field above the sheet’s top', async () => {
    const { sheet } = await typing({ top: 270, bottom: 310 })
    expect(sheet.scrollTop).toBe(70)
  })

  // Its top first: the label and where typing starts, not the end of a field lower than the sheet.
  it('brings the top of a field under the edge to the sheet’s top, and no further', async () => {
    const { sheet } = await typing({ top: 330, bottom: 560 })
    expect(sheet.scrollTop).toBe(130)
  })

  // The browser keeps the caret of a field taller than the sheet in sight as it is typed.
  it('must not fire: a field over both edges of the sheet', async () => {
    const { sheet } = await typing({ top: 250, bottom: 560 })
    expect(sheet.scrollTop).toBe(100)
  })

  // Done once more, it moves nothing: two answers for one field flipped the sheet between them
  // on every event of the viewport (adversarial А3).
  it('must not fire: the sheet moved again with the field already in sight', async () => {
    const { sheet, viewport } = await typing({ top: 481, bottom: 521 })
    expect(sheet.scrollTop).toBe(121)
    viewport.height = 499
    viewport.fire('resize')
    expect(sheet.scrollTop).toBe(121)
  })

  // What the person scrolled to is theirs: an event that changed neither the lift nor the height
  // is no reason to take the sheet from under the finger (review С-1).
  it('must not fire: an event of the viewport that moved nothing', async () => {
    const { sheet, viewport } = await typing({ top: 481, bottom: 521 })
    sheet.scrollTop = 400
    viewport.fire('resize')
    viewport.fire('scroll')
    expect(sheet.scrollTop).toBe(400)
  })

  // A focus the browser brings into sight itself; heard on `focusin`, the sheet moved first and
  // the browser's own scroll found nothing left to do (adversarial А).
  it('must not fire: a focus alone, the keyboard already up', async () => {
    fakeViewport(500)
    const view = host()
    const { sheet, input } = placed(view.view, { top: 300, bottom: 500 }, { top: 510, bottom: 550 })
    view.on.value = true
    await nextTick()
    input.focus()
    expect(sheet.scrollTop).toBe(100)
  })

  // The result of a check is focused for a screen reader, and read from its top (adversarial А).
  it('must not fire: a block focused to be read, not typed in', async () => {
    const viewport = fakeViewport(800)
    const view = host()
    const { sheet, input: block } = placed(
      view.view,
      { top: 300, bottom: 500 },
      { top: 510, bottom: 550 },
      '[data-block]',
    )
    view.on.value = true
    await nextTick()
    block.focus()
    viewport.height = 500
    viewport.fire('resize')
    expect(sheet.scrollTop).toBe(100)
  })

  it('must not fire: the focus outside the sheet', async () => {
    const outside = document.createElement('input')
    document.body.append(outside)
    const viewport = fakeViewport(800)
    const view = host()
    const { sheet } = placed(view.view, { top: 300, bottom: 500 }, { top: 510, bottom: 550 })
    view.on.value = true
    await nextTick()
    outside.focus()
    viewport.height = 500
    viewport.fire('resize')
    expect(sheet.scrollTop).toBe(100)
  })

  // A pinch is not a keyboard, by either way into the sheet (review С-3, adversarial В).
  it('must not fire: pinched in', async () => {
    const viewport = fakeViewport(800)
    const view = host()
    const { sheet, input } = placed(view.view, { top: 300, bottom: 500 }, { top: 510, bottom: 550 })
    view.on.value = true
    await nextTick()
    viewport.scale = 2
    input.focus()
    viewport.height = 400
    viewport.fire('resize')
    expect(sheet.scrollTop).toBe(100)
    viewport.scale = 1
    viewport.height = 500
    viewport.fire('resize')
    expect(sheet.scrollTop).toBe(150)
  })

  it('must not fire: the sheet shut', async () => {
    const view = host()
    const { sheet, input } = placed(view.view, { top: 300, bottom: 500 }, { top: 510, bottom: 550 })
    fakeViewport(500)
    await nextTick()
    input.focus()
    expect(sheet.scrollTop).toBe(100)
  })
})

// A pinned footer covers the sheet's end: what is under it is not in sight, and the sheet's own
// `scroll-padding` says how far that is — the browser's focus goes by the same (MOL-182).
describe('useKeyboardInset keeps the focused field above a pinned footer', () => {
  function footed(footer = 60) {
    const edge = ref(footer)
    const view = host(false, (target, on) => {
      useKeyboardInset(target, on, edge)
    })
    const sheet = view.view.element as HTMLElement
    sheet.style.scrollPaddingBottom = `${String(footer)}px`
    return { ...view, edge, sheet }
  }

  async function typing(field: Box, which = '[data-field]') {
    const viewport = fakeViewport(800)
    const view = footed()
    const { input } = placed(view.view, { top: 300, bottom: 500 }, field, which)
    view.on.value = true
    await nextTick()
    input.focus()
    return { ...view, input, viewport }
  }

  it('scrolls a field under the footer to the footer’s top', async () => {
    const { sheet, viewport } = await typing({ top: 421, bottom: 461 })
    viewport.height = 500
    viewport.fire('resize')
    expect(sheet.scrollTop).toBe(121)
  })

  it('must not fire: a field whose end is the footer’s top', async () => {
    const { sheet, viewport } = await typing({ top: 400, bottom: 440 })
    viewport.height = 500
    viewport.fire('resize')
    expect(sheet.scrollTop).toBe(100)
  })

  // An error or «Вернуть» come into the footer move its top up as a lower sheet would.
  it('brings the field back above a footer that grew over it', async () => {
    const { sheet, edge } = await typing({ top: 390, bottom: 430 })
    expect(sheet.scrollTop).toBe(100)
    sheet.style.scrollPaddingBottom = '80px'
    edge.value = 80
    await nextTick()
    expect(sheet.scrollTop).toBe(110)
  })

  it('must not fire: a footer that grew with no field typed in', async () => {
    const { sheet, edge } = await typing({ top: 390, bottom: 430 }, '[data-button]')
    sheet.style.scrollPaddingBottom = '80px'
    edge.value = 80
    await nextTick()
    expect(sheet.scrollTop).toBe(100)
  })

  it('must not fire: a footer that grew in a shut sheet', async () => {
    const { sheet, edge, on } = await typing({ top: 390, bottom: 430 })
    on.value = false
    await nextTick()
    sheet.style.scrollPaddingBottom = '80px'
    edge.value = 80
    await nextTick()
    expect(sheet.scrollTop).toBe(100)
  })
})

// The first keyboard of a page came 300–800 ms after the focus on the owner's iPhone, the page drew
// nothing meanwhile, and iOS slid the last picture up with the keys — the sheet in it still the
// screen's share, its top off the screen (MOL-151, М-1). The height they left is remembered and
// taken before they come.
describe('useKeyboardInset takes the height the keys left last time', () => {
  const KEY = 'molvia.keyboard'
  const AMOUNT = 'decimal 699x390'

  // A page of its own for every test: whether a keyboard came up yet is the page's.
  let fresh: typeof useKeyboardInset

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }))
    vi.resetModules()
    ;({ useKeyboardInset: fresh } = await import('@/composables/useKeyboardInset'))
  })

  async function opened(kept: Record<string, unknown> | string | null = { [AMOUNT]: 395 }) {
    if (kept !== null)
      localStorage.setItem(KEY, typeof kept === 'string' ? kept : JSON.stringify(kept))
    const viewport = fakeViewport(699)
    vi.stubGlobal('innerHeight', 699)
    const layout = fakeLayout(699)
    const view = host(false, fresh)
    view.on.value = true
    await nextTick()
    const field = (which: string) => {
      const found = (view.view.element as HTMLElement).querySelector<HTMLElement>(which)
      if (!found) throw new Error(`no ${which}`)
      return found
    }
    return { ...view, viewport, layout, field }
  }

  // Safari, the first «+ Трата» after a reload (`tbp9pb`): the focus, 724 ms of nothing, then the
  // keys with the window shrunk to 395 and the visible part said to be 304 down.
  function keysCome({ viewport, layout }: Awaited<ReturnType<typeof opened>>) {
    vi.stubGlobal('innerHeight', 395)
    layout.floor = 395
    viewport.height = 395
    viewport.offsetTop = 304
    viewport.fire('resize')
  }

  it('takes the remembered height at the focus, before the keys, and keeps it as they come', async () => {
    const sheet = await opened()
    expect(sheet.height()).toBe('699px')
    sheet.field('[data-amount]').focus()
    expect(sheet.height()).toBe('395px')
    expect(sheet.inset()).toBe('0px')
    vi.advanceTimersByTime(724)
    expect(sheet.height()).toBe('395px')
    keysCome(sheet)
    expect(sheet.height()).toBe('395px')
    expect(sheet.inset()).toBe('0px')
  })

  // A later keyboard came 128–263 ms after the focus with no frame of the page or one, and that frame
  // is what iOS slides up: made lower it lands in place (adversarial У2). The price is that frame.
  it('takes the remembered height again for a field tapped after the keys went down', async () => {
    const sheet = await opened()
    sheet.field('[data-amount]').focus()
    keysCome(sheet)
    sheet.field('[data-amount]').blur()
    vi.stubGlobal('innerHeight', 699)
    sheet.layout.floor = 699
    sheet.viewport.height = 699
    sheet.viewport.offsetTop = 0
    sheet.viewport.fire('resize')
    expect(sheet.height()).toBe('699px')
    sheet.field('[data-amount]').focus()
    expect(sheet.height()).toBe('395px')
  })

  // A select and a date bring a picker, not keys: nothing is remembered for them, nothing
  // foreseen (adversarial У1).
  it('must not fire: a date focused with the keys still up is not remembered', async () => {
    const sheet = await opened(null)
    sheet.field('[data-field]').focus()
    sheet.viewport.height = 369
    sheet.viewport.fire('resize')
    sheet.field('[data-date]').focus()
    window.dispatchEvent(new Event('scroll'))
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ 'input 699x390': 369 })
  })

  it('must not fire: a date focused takes no remembered height', async () => {
    const sheet = await opened({ 'date 699x390': 369 })
    sheet.field('[data-date]').focus()
    expect(sheet.height()).toBe('699px')
  })

  it('remembers what the keys left, by their kind and the window', async () => {
    const sheet = await opened(null)
    sheet.field('[data-amount]').focus()
    expect(sheet.height()).toBe('699px')
    keysCome(sheet)
    expect(sheet.height()).toBe('395px')
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ [AMOUNT]: 395 })
  })

  it('keeps what other keys and windows left beside it', async () => {
    const sheet = await opened({ 'text 699x390': 340 })
    sheet.field('[data-amount]').focus()
    keysCome(sheet)
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({
      'text 699x390': 340,
      [AMOUNT]: 395,
    })
  })

  // A hardware keyboard raises nothing: the sheet does not stay short for it.
  it('lets the height go when the keys have not come in 1500 ms', async () => {
    const sheet = await opened()
    sheet.field('[data-amount]').focus()
    vi.advanceTimersByTime(1499)
    expect(sheet.height()).toBe('395px')
    vi.advanceTimersByTime(1)
    expect(sheet.height()).toBe('699px')
  })

  it('lets the height go when the focus leaves before the keys come', async () => {
    const sheet = await opened()
    sheet.field('[data-amount]').focus()
    sheet.field('[data-amount]').blur()
    expect(sheet.height()).toBe('699px')
  })

  // An event of the viewport with no keys in it — a bar of Safari coming and going — is not them.
  it('must not fire: an event without the keys takes the foreseen height away', async () => {
    const sheet = await opened()
    sheet.field('[data-amount]').focus()
    sheet.viewport.height = 650
    sheet.viewport.fire('resize')
    expect(sheet.height()).toBe('395px')
  })

  it('must not fire: nothing remembered', async () => {
    const sheet = await opened(null)
    sheet.field('[data-amount]').focus()
    expect(sheet.height()).toBe('699px')
  })

  it('must not fire: a mouse, not a finger', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const sheet = await opened()
    sheet.field('[data-amount]').focus()
    expect(sheet.height()).toBe('699px')
  })

  it('must not fire: a button focused, not a field', async () => {
    const sheet = await opened()
    sheet.field('[data-button]').focus()
    expect(sheet.height()).toBe('699px')
  })

  it('must not fire: other keys remembered, not these', async () => {
    const sheet = await opened({ 'numeric 699x390': 395 })
    sheet.field('[data-amount]').focus()
    expect(sheet.height()).toBe('699px')
  })

  it('must not fire: the phone turned, another window', async () => {
    const sheet = await opened({ 'decimal 699x844': 395 })
    sheet.field('[data-amount]').focus()
    expect(sheet.height()).toBe('699px')
  })

  it('must not fire: a remembered height not below the window', async () => {
    const sheet = await opened({ [AMOUNT]: 699 })
    sheet.field('[data-amount]').focus()
    expect(sheet.height()).toBe('699px')
  })

  it('must not fire: what is kept is not a list of heights', async () => {
    const sheet = await opened('not json')
    sheet.field('[data-amount]').focus()
    expect(sheet.height()).toBe('699px')
  })

  it('must not fire: pinched in', async () => {
    const sheet = await opened()
    sheet.viewport.scale = 2
    sheet.viewport.fire('resize')
    sheet.field('[data-amount]').focus()
    expect(sheet.height()).toBe('')
  })

  // A field tapped with the keys already up is measured as it is, not foreseen.
  it('must not fire: the keys already up', async () => {
    const sheet = await opened({ [AMOUNT]: 300 })
    keysCome(sheet)
    sheet.field('[data-amount]').focus()
    expect(sheet.height()).toBe('395px')
  })

  // Chrome on Android shrinks the window and `dvh` with the keys: they cover nothing, and there is
  // nothing to remember.
  it('must not fire: a window that shrank with the keys is not remembered', async () => {
    const sheet = await opened(null)
    sheet.field('[data-amount]').focus()
    sheet.layout.dvh = 400
    sheet.layout.floor = 400
    sheet.viewport.height = 400
    sheet.viewport.fire('resize')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('must not fire: the sheet shut lets the foreseen height go', async () => {
    const sheet = await opened()
    sheet.field('[data-amount]').focus()
    sheet.on.value = false
    await nextTick()
    expect(sheet.height()).toBe('')
    vi.advanceTimersByTime(1500)
    expect(sheet.height()).toBe('')
  })
})
