import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function host(active = false) {
  const on = ref(active)
  const target = ref<HTMLElement | null>(null)
  const view = mount(
    defineComponent(() => {
      useKeyboardInset(target, on)
      return () => h('div', { ref: target }, [h('input', { 'data-field': '' })])
    }),
    { attachTo: document.body },
  )
  const style = () => (view.element as HTMLElement).style
  const inset = () => style().getPropertyValue('--keyboard-inset')
  const height = () => style().getPropertyValue('--viewport-height')
  return { on, view, inset, height }
}

/** The sheet's box and a field in it, as the layout would place them at a scroll of 100. */
function placed(view: ReturnType<typeof host>['view'], box: Box, field: Box) {
  const sheet = view.element as HTMLElement
  const input = sheet.querySelector<HTMLElement>('[data-field]')
  if (!input) throw new Error('no field in the sheet')
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

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
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

  // iOS scrolls the visual viewport up to keep the field in sight; what is covered shrinks by it,
  // and what is visible is the visual viewport, wherever it stands (MOL-135).
  it('counts the visual viewport scrolled inside the window', async () => {
    const viewport = fakeViewport(500, 100)
    const { on, inset, height } = host()
    on.value = true
    await nextTick()
    expect(inset()).toBe('200px')
    expect(height()).toBe('500px')
    viewport.offsetTop = 300
    viewport.fire('scroll')
    expect(inset()).toBe('0px')
    expect(height()).toBe('500px')
  })

  // Measured on the owner's iPhone, Safari (MOL-135): the window shrinks to the visible part under
  // the keyboard, `100dvh` stays 699, and the visible part is reported 304px down. Nothing is to be
  // lifted, and the sheet is a share of 395 — of 699 its top went 178px off the screen.
  it('takes what Safari leaves visible when it shrinks the window itself', async () => {
    const viewport = fakeViewport(699)
    vi.stubGlobal('innerHeight', 699)
    const { on, inset, height } = host()
    on.value = true
    await nextTick()
    expect(height()).toBe('699px')
    vi.stubGlobal('innerHeight', 395)
    viewport.height = 395
    viewport.offsetTop = 304
    viewport.fire('resize')
    expect(inset()).toBe('0px')
    expect(height()).toBe('395px')
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
    expect(inset()).toBe('200px')
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

  it('reveals a field as it takes the focus, the keyboard already up', async () => {
    const viewport = fakeViewport(500)
    const view = host()
    const { sheet, input } = placed(view.view, { top: 300, bottom: 500 }, { top: 510, bottom: 550 })
    view.on.value = true
    await nextTick()
    expect(sheet.scrollTop).toBe(100)
    input.focus()
    expect(sheet.scrollTop).toBe(150)
    expect(viewport.count()).toBe(2)
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

  it('must not fire: pinched in', async () => {
    const viewport = fakeViewport(800)
    const view = host()
    const { sheet, input } = placed(view.view, { top: 300, bottom: 500 }, { top: 510, bottom: 550 })
    view.on.value = true
    await nextTick()
    viewport.scale = 2
    input.focus()
    sheet.scrollTop = 100
    viewport.fire('resize')
    expect(sheet.scrollTop).toBe(100)
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
