import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import IconUnanswered from '~icons/mdi/alert-circle-outline'
import IconOffline from '~icons/mdi/cloud-off-outline'
import StatusStrip from '@/components/StatusStrip.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'

describe('StatusStrip', () => {
  it('draws the words it was given, as given', () => {
    const view = mount(StatusStrip, {
      props: { kind: 'offline', text: 'Без связи · графики на 14:05' },
    })
    expect(view.get('.words').text()).toBe('Без связи · графики на 14:05')
    expect(view.get('.icon').attributes('aria-hidden')).toBe('true')
  })

  // The cloud says «no connection»; the server not answering is another thing, and its glyph is
  // the frame's 6h (owner's В-1 «а»).
  it.each([
    ['offline', IconOffline],
    ['unanswered', IconUnanswered],
  ] as const)('draws %s with its own glyph', (kind, icon) => {
    const view = mount(StatusStrip, { props: { kind, text: 'Words' } })
    expect(view.classes()).toContain(kind)
    expect(view.get('.icon path').attributes('d')).toBe(mount(icon).get('path').attributes('d'))
  })

  describe('its action', () => {
    const action = { action: () => h('button', 'Повторить') }

    it('is drawn when the server did not answer', () => {
      const view = mount(StatusStrip, {
        props: { kind: 'unanswered', text: 'Список на вчера — сервер не ответил' },
        slots: action,
      })
      expect(view.get('.action').text()).toBe('Повторить')
    })

    // Without a connection there is nothing to try (К-5): the slot is not drawn whatever is given.
    it('is never drawn offline', () => {
      const view = mount(StatusStrip, {
        props: { kind: 'offline', text: 'Без связи' },
        slots: action,
      })
      expect(view.find('.action').exists()).toBe(false)
      expect(view.find('button').exists()).toBe(false)
    })

    it('leaves no empty place when none is given', () => {
      const view = mount(StatusStrip, { props: { kind: 'unanswered', text: 'Words' } })
      expect(view.find('.action').exists()).toBe(false)
    })
  })

  describe('its words out loud', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    // A screen with the app's region, as App.vue gives it: what was added, and what stands now.
    function inApp(
      text: () => string,
      shown: () => boolean,
      attempt: () => number = () => 0,
      drawn: () => number = () => 0,
    ) {
      const said: string[] = []
      const region: string[] = []
      const Screen = defineComponent({
        setup() {
          const announcements = provideAnnouncer()
          watch(announcements, (now, before) => {
            for (const added of now.filter((a) => !before.some((b) => b.id === a.id))) {
              said.push(added.text)
            }
            region.splice(0, region.length, ...now.map((a) => a.text))
          })
          // `data-drawn` draws the strip anew with the same words, as a screen does on any change.
          return () =>
            shown()
              ? h(StatusStrip, {
                  kind: 'unanswered',
                  text: text(),
                  attempt: attempt(),
                  'data-drawn': drawn(),
                })
              : null
        },
      })
      return { view: mount(Screen), said, region }
    }

    // К-14: a polite word to the one region, never a role of its own beside it (MOL-19).
    it('speaks through the app’s region, with no role of its own', async () => {
      const { view, said } = inApp(
        () => 'Без связи · графики на 14:05',
        () => true,
      )
      await vi.runOnlyPendingTimersAsync()
      expect(said).toEqual(['Без связи · графики на 14:05'])
      expect(view.get('.strip').attributes('role')).toBeUndefined()
      expect(view.get('.strip').attributes('aria-live')).toBeUndefined()
    })

    it('says new words, and takes back the old ones', async () => {
      const text = ref('Без связи · графики на 14:05')
      const { said, region } = inApp(
        () => text.value,
        () => true,
      )
      await vi.runOnlyPendingTimersAsync()
      text.value = 'Без связи · графики на 14:20'
      await nextTick()
      await vi.runOnlyPendingTimersAsync()
      expect(said).toEqual(['Без связи · графики на 14:05', 'Без связи · графики на 14:20'])
      expect(region).toEqual(['Без связи · графики на 14:20'])
    })

    // Drawn again with the same words — anything else on the screen changed — it says nothing new.
    it('says the same words once while nothing new happened', async () => {
      const drawn = ref(0)
      const { view, said } = inApp(
        () => 'Список на вчера — сервер не ответил',
        () => true,
        () => 1,
        () => drawn.value,
      )
      await vi.runOnlyPendingTimersAsync()
      drawn.value++
      await nextTick()
      expect(view.get('.strip').attributes('data-drawn')).toBe('1')
      await vi.runOnlyPendingTimersAsync()
      expect(said).toEqual(['Список на вчера — сервер не ответил'])
    })

    // «Повторить» failed the same way: the same words, and still an answer (C1) — a new attempt
    // says them again (adversarial А4, review С-7).
    it('says the same words again for a new attempt', async () => {
      const attempt = ref(1)
      const { said, region } = inApp(
        () => 'Список на вчера — сервер не ответил',
        () => true,
        () => attempt.value,
      )
      await vi.runOnlyPendingTimersAsync()
      attempt.value++
      await nextTick()
      await vi.runOnlyPendingTimersAsync()
      expect(said).toEqual([
        'Список на вчера — сервер не ответил',
        'Список на вчера — сервер не ответил',
      ])
      expect(region).toHaveLength(1)
    })

    it('takes its words back when it goes', async () => {
      const shown = ref(true)
      const { region } = inApp(
        () => 'Без связи · графики на 14:05',
        () => shown.value,
      )
      await vi.runOnlyPendingTimersAsync()
      expect(region).toHaveLength(1)
      shown.value = false
      await nextTick()
      expect(region).toEqual([])
    })

    // A component mounted on its own, out of the app: no region to speak to, so it is one itself.
    it('is a status of its own outside the app', () => {
      const view = mount(StatusStrip, { props: { kind: 'offline', text: 'Без связи' } })
      expect(view.attributes('role')).toBe('status')
    })
  })
})
