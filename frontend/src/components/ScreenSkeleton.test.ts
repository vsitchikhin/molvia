import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, watch } from 'vue'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import type { AppLocale } from '@/i18n/locale'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'

function render(groups: unknown, locale: AppLocale = 'en', slot?: () => unknown) {
  return mount(ScreenSkeleton, {
    props: { groups: groups as number[] },
    slots: slot ? { default: slot } : {},
    global: { plugins: [createAppI18n(locale)] },
  })
}

describe('ScreenSkeleton', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('draws one pair of bars per group, the line as wide as the screen asked', () => {
    const view = render([72, 54, 84, 46])
    expect(view.findAll('.group')).toHaveLength(4)
    expect(view.findAll('.line').map((line) => line.attributes('style'))).toEqual([
      'width: 72%;',
      'width: 54%;',
      'width: 84%;',
      'width: 46%;',
    ])
    expect(view.findAll('.sub')).toHaveLength(4)
  })

  // The width of the second bar is the block's, not the screen's: every screen of the
  // handoff draws it at 38 %, and a prop for it would only be a way to drift.
  it('gives the second bar no width of its own to set', () => {
    const view = render([40])
    expect(view.get('.sub').attributes('style')).toBeUndefined()
  })

  // Not inside aria-busy: a busy region holds its announcements until it is cleared, and a
  // skeleton is removed rather than cleared.
  it('tells a screen reader it is loading, and hides the bars from it', () => {
    const view = render([40, 78])
    expect(view.find('[aria-busy]').exists()).toBe(false)
    expect(view.get('[role="status"]').text()).toBe(en.state.loading)
    expect(view.get('.bars').attributes('aria-hidden')).toBe('true')
  })

  // Inside a screen «Loading…» goes to the screen's live region, which exists before it: a
  // region born with its words is often not read (MOL-19, П-2).
  it("inside a screen, says it in the screen's live region and carries no role", async () => {
    const said: string[] = []
    const Screen = defineComponent({
      setup() {
        const announcement = provideAnnouncer()
        watch(announcement, (value) => {
          if (value) said.push(value)
        })
        return () => h(ScreenSkeleton, { groups: [40] })
      },
    })
    const view = mount(Screen, { global: { plugins: [createAppI18n('en')] } })
    await flushPromises()
    expect(said).toEqual([en.state.loading])
    expect(view.find('[role]').exists()).toBe(false)
  })

  it('says it in Russian from the same dictionary', () => {
    const view = render([40], 'ru')
    expect(view.get('[role="status"]').text()).toBe(ru.state.loading)
  })

  // The rating card ends in five squares, which are not a pair of bars: they come through the
  // slot, after the bars and hidden with them.
  it('puts what the screen adds after the bars, hidden with them', () => {
    const view = render([58, 90], 'en', () => h('div', { class: 'scale' }))
    const bars = view.get('.bars')
    expect(bars.element.lastElementChild?.className).toBe('scale')
  })

  it.each([
    ['nothing to draw', []],
    ['a width of zero', [0]],
    ['a width past the whole', [101]],
    ['not a number', ['72']],
  ])('refuses %s', (_, groups) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(groups)
    expect(warn.mock.calls.some(([message]) => String(message).includes('Invalid prop'))).toBe(true)
  })

  it('accepts the edges of the scale', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render([0.5, 100])
    expect(warn).not.toHaveBeenCalled()
  })
})
