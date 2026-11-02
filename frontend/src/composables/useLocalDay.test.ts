import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { useLocalDay } from '@/composables/useLocalDay'

// The screen's day as a component holds it, drawn so a test reads what the screen would.
const Screen = defineComponent(() => {
  const today = useLocalDay()
  return () => h('p', today.value)
})

describe('useLocalDay (MOL-121; MOL-329, adversarial А4)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('moves at midnight with the screen in view, no event needed — and on to the next one', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 9, 30, 23, 59, 58))
    const view = mount(Screen)
    expect(view.text()).toBe('2026-10-30')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(view.text()).toBe('2026-10-30')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(view.text()).toBe('2026-10-31')
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000)
    expect(view.text()).toBe('2026-11-01')
    view.unmount()
  })

  it('asks again as the app comes back into view: a timer of a page put away may not have fired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 30, 23, 50))
    const view = mount(Screen)
    vi.setSystemTime(new Date(2026, 9, 31, 7, 30))
    document.dispatchEvent(new Event('visibilitychange'))
    await view.vm.$nextTick()
    expect(view.text()).toBe('2026-10-31')
    view.unmount()
  })

  it('a screen taken away leaves no timer behind', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 9, 30, 12))
    const view = mount(Screen)
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
