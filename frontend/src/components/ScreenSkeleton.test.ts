import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, watch } from 'vue'
import type { AppLocale } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'

function render(groups: unknown, locale: AppLocale = 'en', slot?: () => unknown) {
  return mount(ScreenSkeleton, {
    props: groups === undefined ? {} : { groups: groups as number[] },
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
    expect(view.findAll('.text').map((line) => line.attributes('style'))).toEqual([
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

  // Inside the app «Loading…» goes to its live region, which exists before it, and leaves it
  // with the skeleton — left behind it would be read under the answer (MOL-19, П-2, C3).
  it('inside the app, says it in the live region, carries no role, and takes it back', async () => {
    vi.useFakeTimers()
    const shown = ref(true)
    const region = ref<string[]>([])
    const Screen = defineComponent({
      setup() {
        const announcements = provideAnnouncer()
        watch(announcements, (now) => {
          region.value = now.map((announcement) => announcement.text)
        })
        return () => (shown.value ? h(ScreenSkeleton, { groups: [40] }) : null)
      },
    })
    const view = mount(Screen, { global: { plugins: [createAppI18n('en')] } })
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(region.value).toEqual([en.state.loading])
    expect(view.find('[role]').exists()).toBe(false)

    shown.value = false
    await nextTick()
    expect(region.value).toEqual([])
    vi.useRealTimers()
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

  // Ф-13 (MOL-178): the groups of before stand in a card, where a bar of `border` is seen — on the
  // page's ground, the bars of `surface-2` were 1.06:1. The screens that pass them change nothing.
  it('draws the groups of before in a card, as the kit’s paragraphs', () => {
    const view = render([72, 54])
    const card = view.get('.bars > .skeleton-lines > .card')
    expect(card.findAll('.group')).toHaveLength(2)
  })

  // The shape of the answer is the screen's, in the order it will stand: the kit's parts and what is
  // the screen's own between them, all in the one frame that breathes and is hidden.
  it('with no groups, draws only what the screen puts in it, in its order', () => {
    const view = render(undefined, 'en', () => [
      h(SkeletonPart, { kind: 'caption', width: 30 }),
      h('div', { class: 'ring' }),
      h(SkeletonPart, { kind: 'rows', count: 2 }),
    ])
    const parts = [...view.get('.bars').element.children].map((child) => child.className)
    expect(parts).toEqual([
      expect.stringContaining('caption'),
      'ring',
      expect.stringContaining('skeleton-rows'),
    ])
    expect(view.find('.skeleton-lines').exists()).toBe(false)
    expect(view.get('[role="status"]').text()).toBe(en.state.loading)
  })

  // A frame with no shape says «Loading…» over nothing — the invisible skeleton of Н-5 — and once
  // `groups` stopped being required nothing said so (adversarial А4).
  it('warns when it has nothing to draw, and draws no empty card for no groups', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const view = render(undefined)
    expect(warn.mock.calls.some(([message]) => String(message).includes('nothing to draw'))).toBe(
      true,
    )
    expect(view.get('.bars').element.children).toHaveLength(0)
    warn.mockClear()
    const none = render([])
    expect(none.find('.card').exists()).toBe(false)
    expect(warn.mock.calls.some(([message]) => String(message).includes('nothing to draw'))).toBe(
      true,
    )
  })

  // Passed is not drawn: a slot of `<SkeletonPart v-if="known">`, or of a list that came empty, is a
  // slot all the same, and the frame said «Loading…» over nothing with no word (adversarial Б4).
  it('warns of a slot that draws nothing, as of no slot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const slot of [() => null, () => []]) {
      warn.mockClear()
      const view = render(undefined, 'en', slot)
      expect(view.get('.bars').element.children).toHaveLength(0)
      expect(warn.mock.calls.some(([message]) => String(message).includes('nothing to draw'))).toBe(
        true,
      )
    }
  })

  it('says nothing of a frame with a shape', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render([40])
    render(undefined, 'en', () => h(SkeletonPart, { kind: 'field' }))
    expect(warn).not.toHaveBeenCalled()
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
