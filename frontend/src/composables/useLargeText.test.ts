import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { useLargeText } from '@/composables/useLargeText'

describe('useLargeText (MOL-321)', () => {
  let rem = 16
  let resized: (() => void) | null = null

  function host() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: rem }) as DOMRect,
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback
        }
        observe(): void {
          // The test calls `resized` itself, as the browser would on a new size of the rem.
        }
        disconnect(): void {
          resized = null
        }
      },
    )
    return mount(defineComponent({ setup: () => (useLargeText(), () => h('div')) }))
  }

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    rem = 16
  })

  it('must not fire at the browser’s own size, nor a step under large', () => {
    rem = 17.6
    const view = host()
    expect(document.documentElement.hasAttribute('data-large-text')).toBe(false)
    view.unmount()
  })

  it('marks the root once the rem grows, and lets go when it shrinks back', () => {
    rem = 24
    const view = host()
    expect(document.documentElement.hasAttribute('data-large-text')).toBe(true)
    rem = 16
    resized?.()
    expect(document.documentElement.hasAttribute('data-large-text')).toBe(false)
    rem = 18
    resized?.()
    expect(document.documentElement.hasAttribute('data-large-text')).toBe(true)
    view.unmount()
    expect(document.documentElement.hasAttribute('data-large-text')).toBe(false)
  })
})
