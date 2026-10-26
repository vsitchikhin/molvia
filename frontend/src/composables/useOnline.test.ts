import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOnline } from '@/composables/useOnline'

function mounted() {
  let online = { value: true }
  const view = mount(
    defineComponent({
      setup() {
        online = useOnline()
        return () => h('i')
      },
    }),
  )
  return { view, online: () => online.value }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useOnline', () => {
  it("follows the window's `online` and `offline`", () => {
    const flag = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const { view, online } = mounted()
    expect(online()).toBe(true)
    flag.mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    expect(online()).toBe(false)
    flag.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    expect(online()).toBe(true)
    view.unmount()
  })

  // MOL-192, adversarial А1, А1′: an iOS PWA frozen in the background misses both events.
  it('reads the browser again when the app comes back into view, either way', () => {
    const flag = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const { view, online } = mounted()
    flag.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(online()).toBe(false)
    flag.mockReturnValue(true)
    window.dispatchEvent(new Event('pageshow'))
    expect(online()).toBe(true)
    view.unmount()
    // Gone with its component: nothing listens any more.
    flag.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(online()).toBe(true)
  })
})
