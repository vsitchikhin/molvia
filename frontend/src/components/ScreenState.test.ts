import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, watch, type VNodeArrayChildren } from 'vue'
import IconPlus from '~icons/mdi/plus'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import type { AppLocale } from '@/i18n/locale'
import ScreenState from '@/components/ScreenState.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'

type Props = Record<string, unknown>

function render(props: Props, slots: Record<string, () => unknown> = {}, locale: AppLocale = 'en') {
  return mount(ScreenState, {
    props: { title: 'Title', ...props } as never,
    slots,
    global: { plugins: [createAppI18n(locale)] },
  })
}

function refused(props: Props): boolean {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  render(props)
  const result = warn.mock.calls.some(([message]) => String(message).includes('Invalid prop'))
  warn.mockRestore()
  return result
}

describe('ScreenState', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('each kind draws its own circle', () => {
    it('empty: the icon the screen brought, in the tone it chose', () => {
      const view = render({ kind: 'empty', tone: 'accent', icon: IconPlus })
      expect(view.findComponent(IconPlus).exists()).toBe(true)
      expect(view.classes()).toContain('accent')
    })

    it('empty that is a success is green', () => {
      const view = render({ kind: 'empty', tone: 'good', icon: IconPlus })
      expect(view.classes()).toContain('good')
    })

    it('error: always the alert icon, always red', () => {
      const view = render({ kind: 'error' })
      expect(view.findComponent(IconAlert).exists()).toBe(true)
      expect(view.classes()).toContain('bad')
    })

    it.each(['good', 'warn'])('offline: the cloud, in %s', (tone) => {
      const view = render({ kind: 'offline', tone })
      expect(view.findComponent(IconCloudOff).exists()).toBe(true)
      expect(view.classes()).toContain(tone)
    })

    it('attention: the alert icon, yellow — something to know, not a failure', () => {
      const view = render({ kind: 'attention' })
      expect(view.findComponent(IconAlert).exists()).toBe(true)
      expect(view.classes()).toContain('warn')
    })
  })

  // «Offline is never red» is a rule of the handoff that nobody could check by eye across
  // twelve cards; here no combination of props produces it.
  it('never draws offline red, whatever it is given', () => {
    for (const tone of ['accent', 'good', 'warn', 'bad', undefined]) {
      const view = render({ kind: 'offline', tone })
      expect(view.classes()).not.toContain('bad')
    }
  })

  describe('refuses what the types cannot say', () => {
    it.each<[string, Props]>([
      ['offline in red', { kind: 'offline', tone: 'bad' }],
      ['offline with no tone', { kind: 'offline' }],
      ['offline in accent', { kind: 'offline', tone: 'accent' }],
      ['empty with no icon', { kind: 'empty', tone: 'accent' }],
      ['empty with no tone', { kind: 'empty', icon: IconPlus }],
      ['empty in yellow', { kind: 'empty', tone: 'warn', icon: IconPlus }],
      ['error with a tone', { kind: 'error', tone: 'good' }],
      ['error with an icon of its own', { kind: 'error', icon: IconPlus }],
      ['attention with a tone', { kind: 'attention', tone: 'good' }],
      ['offline with an icon of its own', { kind: 'offline', tone: 'good', icon: IconPlus }],
      ['a kind that does not exist', { kind: 'loading' }],
      // `in` walks the prototype: «toString» passed for a kind with a fixed tone (MOL-19, A5).
      ['a name off the prototype', { kind: 'toString' }],
    ])('%s', (_, props) => {
      expect(refused(props)).toBe(true)
    })

    it.each<[string, Props]>([
      ['empty', { kind: 'empty', tone: 'accent', icon: IconPlus }],
      ['error', { kind: 'error' }],
      ['offline', { kind: 'offline', tone: 'warn' }],
      ['attention', { kind: 'attention' }],
    ])('and accepts %s as the handoff draws it', (_, props) => {
      expect(refused(props)).toBe(false)
    })
  })

  describe('speaks to a screen reader', () => {
    it.each([
      ['error', { kind: 'error' }, 'alert'],
      ['attention', { kind: 'attention' }, 'alert'],
      // Inline is always polite: a notice drawn again on every screen would interrupt every move
      // (MOL-19, Р-9).
      ['attention inline', { kind: 'attention', inline: true }, 'status'],
      ['empty', { kind: 'empty', tone: 'accent', icon: IconPlus }, 'status'],
      ['offline', { kind: 'offline', tone: 'good' }, 'status'],
      // A notice drawn again over every screen: an alert would cut off the heading each move
      // has just focused (MOL-19, A3).
      ['inline error', { kind: 'error', inline: true }, 'status'],
    ])('%s is announced as %s', (_, props, role) => {
      expect(render(props).get('[role]').attributes('role')).toBe(role)
    })

    // Read out with its buttons, the card would announce «Try again» as if it were the news.
    it('keeps the buttons out of what it announces', () => {
      const view = render(
        { kind: 'error', body: 'Body' },
        { action: () => h('a', 'Take from recent') },
      )
      const region = view.get('[role]')
      expect(region.find('button').exists()).toBe(false)
      expect(region.find('a').exists()).toBe(false)
      expect(region.text()).toContain('Title')
      expect(region.text()).toContain('Body')
    })

    // The circle is decoration: the title and the text say what happened.
    it('hides the circle, and reads the title as a heading', () => {
      const view = render({ kind: 'error', title: 'The server did not answer' })
      expect(view.get('.circle').attributes('aria-hidden')).toBe('true')
      expect(view.get('h2').text()).toBe('The server did not answer')
    })
  })

  it('draws the title and the text it was given, as given', () => {
    const view = render({
      kind: 'offline',
      tone: 'good',
      title: ru.trip.offline.title,
      body: ru.trip.offline.body,
    })
    expect(view.get('.title').text()).toBe(ru.trip.offline.title)
    expect(view.get('.body').text()).toBe(ru.trip.offline.body)
  })

  // «Stale since yesterday» on the advice scaffold has a title only: its text names data
  // the scaffold does not have.
  it('leaves out the text when there is none', () => {
    expect(render({ kind: 'offline', tone: 'warn' }).find('.body').exists()).toBe(false)
  })

  // The handoff's fifth kind, arriving as a string: warned about, and drawn rather than thrown.
  it('draws a kind it does not know in a tone, instead of failing the screen', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const view = render({ kind: 'loading', tone: 'good' })
    expect(view.classes()).toContain('warn')
  })

  describe('«Try again»', () => {
    it('is offered by every error, and reported rather than acted on', async () => {
      const view = render({ kind: 'error' })
      const button = view.get('.action button')
      expect(button.text()).toBe(en.state.retry)

      await button.trigger('click')
      expect(view.emitted('retry')).toHaveLength(1)
    })

    it("reports the press and nothing else: what follows is the screen's", async () => {
      const view = render({ kind: 'error' })
      await view.get('.action button').trigger('click')
      expect(view.emitted('retry')).toHaveLength(1)
    })

    it('says it in Russian from the same dictionary', () => {
      expect(render({ kind: 'error' }, {}, 'ru').get('.action button').text()).toBe(ru.state.retry)
    })

    // The search's error has a second way out — «Take from recent» — under the retry.
    it('comes first when the screen brings an action of its own', () => {
      const view = render({ kind: 'error' }, { action: () => h('a', 'Take from recent') })
      const children = [...view.get('.action').element.children].map((child) => child.tagName)
      expect(children).toEqual(['BUTTON', 'A'])
    })

    it.each<[string, Props]>([
      ['empty', { kind: 'empty', tone: 'accent', icon: IconPlus }],
      ['offline', { kind: 'offline', tone: 'good' }],
      ['attention', { kind: 'attention' }],
    ])('is not offered by %s, where trying again is not the way out', (_, props) => {
      expect(render(props).find('.action').exists()).toBe(false)
    })
  })

  // A screen as the app draws one: its heading, its live region, and what it puts under them.
  // `said` is every addition to the region, in order — what a screen reader reads; `region` is
  // what the region holds now — what browse mode would still find there.
  function onScreen(children: () => VNodeArrayChildren) {
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
        return () => [h('h1', { tabindex: -1 }, 'Screen'), ...children()]
      },
    })
    const view = mount(Screen, {
      attachTo: document.body,
      global: { plugins: [createAppI18n('en')] },
    })
    return { view, said, region }
  }

  // Whatever takes the block away — «Try again», the connection coming back, a store that
  // recovered — a focus inside it must not fall to <body> (MOL-19, A2, B1). Taken away the way
  // a screen takes it: by `v-if`.
  describe('when it goes', () => {
    function withState() {
      const shown = ref(true)
      const screen = onScreen(() => [
        h('button', { class: 'elsewhere' }, 'Elsewhere'),
        shown.value ? h(ScreenState, { kind: 'error', title: 'Title' }) : null,
      ])
      return { ...screen, shown }
    }

    it('hands a focus inside it to the screen heading', async () => {
      const { view, shown } = withState()
      ;(view.get('.action button').element as HTMLButtonElement).focus()

      shown.value = false
      await nextTick()
      expect(document.activeElement).toBe(view.get('h1').element)
      view.unmount()
    })

    it('leaves a focus elsewhere where it is', async () => {
      const { view, shown } = withState()
      const elsewhere = view.get('.elsewhere').element as HTMLButtonElement
      elsewhere.focus()

      shown.value = false
      await nextTick()
      expect(document.activeElement).toBe(elsewhere)
      view.unmount()
    })
  })

  // Inside the app the polite words go to its live region, which exists before them: a region
  // born with its words is often not read (MOL-19, П-2, C2). The region's own timing is the
  // announcer's test; here the words are waited for.
  describe('inside the app', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    async function settle(): Promise<void> {
      await nextTick()
      vi.advanceTimersByTime(200)
      await nextTick()
    }

    function hosted(props: Props, title = ref('Title'), shown = ref(true)) {
      return onScreen(() => [
        shown.value ? h(ScreenState, { title: title.value, ...props } as never) : null,
      ])
    }

    it('hands a polite state to the region, and carries no role of its own', async () => {
      const { view, said } = hosted({ kind: 'offline', tone: 'warn', body: 'Body' })
      await settle()
      expect(said).toEqual(['Title. Body'])
      expect(view.find('.state [role]').exists()).toBe(false)
      view.unmount()
    })

    it('says it again when the words change, and takes the old words back', async () => {
      const title = ref('Title')
      const { view, said, region } = hosted({ kind: 'offline', tone: 'warn' }, title)
      await settle()
      title.value = 'Other'
      await settle()
      expect(said).toEqual(['Title', 'Other'])
      expect(region).toEqual(['Other'])
      view.unmount()
    })

    // «Try again» failing the same way is still an answer (MOL-19, C1).
    it('says the same words again when the block comes back with them', async () => {
      const shown = ref(true)
      const { view, said } = hosted({ kind: 'offline', tone: 'warn' }, ref('Title'), shown)
      await settle()
      shown.value = false
      await settle()
      shown.value = true
      await settle()
      expect(said).toEqual(['Title', 'Title'])
      view.unmount()
    })

    // The region is hidden but read in browse mode: it must not keep a state that is gone (C3).
    it('takes its words back when it goes', async () => {
      const shown = ref(true)
      const { view, region } = hosted({ kind: 'offline', tone: 'warn' }, ref('Title'), shown)
      await settle()
      expect(region).toEqual(['Title'])
      shown.value = false
      await settle()
      expect(region).toEqual([])
      view.unmount()
    })

    it('keeps an alert its own: an alert inserted is read', async () => {
      const { view, said } = hosted({ kind: 'error' })
      await settle()
      expect(said).toEqual([])
      expect(view.get('.state [role]').attributes('role')).toBe('alert')
      view.unmount()
    })
  })

  it('puts the action at the end, and draws no empty row without one', () => {
    const withAction = render(
      { kind: 'empty', tone: 'accent', icon: IconPlus },
      { action: () => h('button', 'Find an item') },
    )
    expect(withAction.element.lastElementChild?.className).toBe('action')
    expect(withAction.get('.action').text()).toBe('Find an item')

    // The rating saved offline: nothing to do, nothing offered.
    expect(render({ kind: 'offline', tone: 'good' }).find('.action').exists()).toBe(false)
  })

  it('puts what the default slot brings under the text, before the action', () => {
    const view = render(
      { kind: 'attention', body: 'Body' },
      { default: () => h('p', 'Extra'), action: () => h('button', 'Act') },
    )
    const order = [...view.element.children].map((child) => child.className)
    expect(order.slice(-2)).toEqual(['extra', 'action'])
  })

  it('takes the free height unless it is asked to stay inline', () => {
    expect(render({ kind: 'error' }).classes()).not.toContain('inline')
    expect(render({ kind: 'error', inline: true }).classes()).toContain('inline')
  })
})
