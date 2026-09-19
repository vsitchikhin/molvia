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
      return () => h('div', { ref: target })
    }),
  )
  const inset = () => (view.element as HTMLElement).style.getPropertyValue('--keyboard-inset')
  return { on, view, inset }
}

afterEach(() => {
  vi.unstubAllGlobals()
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

  // iOS scrolls the visual viewport up to keep the field in sight; what is covered shrinks by it.
  it('counts the visual viewport scrolled inside the window', async () => {
    const viewport = fakeViewport(500, 100)
    const { on, inset } = host()
    on.value = true
    await nextTick()
    expect(inset()).toBe('200px')
    viewport.offsetTop = 300
    viewport.fire('scroll')
    expect(inset()).toBe('0px')
  })

  it('must not fire: listens to nothing while the sheet is shut', async () => {
    const viewport = fakeViewport(500)
    const { inset } = host()
    await nextTick()
    expect(viewport.count()).toBe(0)
    expect(inset()).toBe('')
  })

  it('lets go when the sheet closes', async () => {
    const viewport = fakeViewport(500)
    const { on, inset } = host(true)
    await nextTick()
    expect(inset()).toBe('300px')
    on.value = false
    await nextTick()
    expect(viewport.count()).toBe(0)
    expect(inset()).toBe('')
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
    const { on, inset } = host()
    on.value = true
    await nextTick()
    expect(inset()).toBe('0px')
    viewport.scale = 1
    viewport.height = 500
    viewport.offsetTop = 0
    viewport.fire('resize')
    expect(inset()).toBe('300px')
  })
})
